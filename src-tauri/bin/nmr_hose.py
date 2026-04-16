import os
import sqlite3
import statistics
import sys
from collections import defaultdict

from rdkit import Chem, RDLogger
from rdkit.Chem import rdchem

NMR_HOSE_DB_FILENAME = "nmr_hose_db.sqlite"
HOSE_DEPTHS = tuple(range(2, 7))
PROTON_SPECTROMETER_MHZ = 400.0
HETERO_ATOMIC_NUMS = {7, 8, 9, 15, 16, 17, 35, 53}

# Canonical solvent names used as keys in the HOSE database.
POOLED_SOLVENT = "*"

HOSE_DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS hose_stats (
    nucleus TEXT NOT NULL,
    solvent TEXT NOT NULL,
    depth INTEGER NOT NULL,
    code TEXT NOT NULL,
    n INTEGER NOT NULL,
    median REAL NOT NULL,
    mad REAL NOT NULL,
    min REAL NOT NULL,
    max REAL NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS hose_stats_lookup_idx
    ON hose_stats (nucleus, solvent, depth, code);
CREATE TABLE IF NOT EXISTS hose_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


def _normalize_solvent(raw: str) -> str:
    """Map NMRShiftDB2 solvent strings to canonical short names."""
    r = raw.lower()
    if "cdcl3" in r or "chloroform" in r:
        return "CDCl3"
    if "dmso" in r or "dimethylsulphoxide" in r or "dimethylsulfoxide" in r:
        return "DMSO-d6"
    if "d2o" in r or "deuteriumoxide" in r or "deuterium oxide" in r:
        return "D2O"
    if "acetone" in r:
        return "acetone-d6"
    if "benzene" in r and "d6" in r:
        return "C6D6"
    if "methanol" in r or "cd3od" in r:
        return "MeOD"
    if "acetonitrile" in r or "cd3cn" in r:
        return "CD3CN"
    if "pyridine" in r:
        return "pyridine-d5"
    return "other"


def _parse_solvent_prop(value: str) -> dict[int, str]:
    """Parse NMRShiftDB2 Solvent field into {spectrum_index: canonical_solvent}.

    The field may contain one or more lines of the form ``0:Chloroform-D1 (CDCl3)``
    where the leading integer is the spectrum index.  If no index prefix is
    present, index 0 is assumed.
    """
    result: dict[int, str] = {}
    for line in value.strip().splitlines():
        line = line.strip()
        if not line:
            continue
        if line[0].isdigit() and ":" in line:
            idx_str, _, rest = line.partition(":")
            try:
                result[int(idx_str.strip())] = _normalize_solvent(rest.strip())
            except ValueError:
                pass
        else:
            result.setdefault(0, _normalize_solvent(line))
    return result


def _hybridization_token(atom) -> str:
    hyb = str(atom.GetHybridization())
    if hyb.endswith("SP"):
        return "1"
    if hyb.endswith("SP2"):
        return "2"
    if hyb.endswith("SP3"):
        return "3"
    return "o"


def _bond_token(bond) -> str:
    if bond is None:
        return ""
    if bond.GetIsAromatic():
        return ":"
    bond_order = int(round(bond.GetBondTypeAsDouble()))
    if bond_order == 1:
        return "-"
    if bond_order == 2:
        return "="
    if bond_order == 3:
        return "#"
    return "~"


def _atom_token(atom, bond=None) -> str:
    return (
        f"{_bond_token(bond)}{atom.GetSymbol()}"
        f"[h{int(atom.GetTotalNumHs())}]"
        f"[c{atom.GetFormalCharge()}]"
        f"[a{int(atom.GetIsAromatic())}]"
        f"[r{int(atom.IsInRing())}]"
        f"[x{_hybridization_token(atom)}]"
    )


def _branch_signature(mol, atom_idx: int, parent_idx: int, depth: int, visited: frozenset[int]) -> str:
    atom = mol.GetAtomWithIdx(atom_idx)
    bond = mol.GetBondBetweenAtoms(parent_idx, atom_idx)
    token = _atom_token(atom, bond)
    if depth <= 0:
        return token

    next_visited = visited | frozenset([atom_idx])
    children = []
    for neighbor in atom.GetNeighbors():
        nbr_idx = neighbor.GetIdx()
        if nbr_idx in next_visited:
            continue
        children.append(_branch_signature(mol, nbr_idx, atom_idx, depth - 1, next_visited))
    if not children:
        return token
    children.sort()
    return f"{token}({','.join(children)})"


def hose_code(mol, atom_idx: int, depth: int) -> str:
    root = _atom_token(mol.GetAtomWithIdx(atom_idx))
    if depth <= 0:
        return root
    visited = frozenset([atom_idx])
    branches = []
    atom = mol.GetAtomWithIdx(atom_idx)
    for neighbor in atom.GetNeighbors():
        branches.append(_branch_signature(mol, neighbor.GetIdx(), atom_idx, depth - 1, visited))
    branches.sort()
    return f"{root}|{'|'.join(branches)}"


def _cached_hose_code(
    mol,
    atom_idx: int,
    depth: int,
    hose_code_cache: dict[tuple[int, int], str] | None = None,
) -> str:
    if hose_code_cache is None:
        return hose_code(mol, atom_idx, depth)
    key = (atom_idx, depth)
    cached = hose_code_cache.get(key)
    if cached is not None:
        return cached
    cached = hose_code(mol, atom_idx, depth)
    hose_code_cache[key] = cached
    return cached


def _median_absolute_deviation(values: list[float]) -> float:
    if not values:
        return 0.0
    median = statistics.median(values)
    deviations = [abs(value - median) for value in values]
    return statistics.median(deviations)


def _stats(values: list[float]) -> dict:
    sorted_values = sorted(values)
    return {
        "n": len(sorted_values),
        "median": round(float(statistics.median(sorted_values)), 3),
        "mad": round(float(_median_absolute_deviation(sorted_values)), 3),
        "min": round(float(sorted_values[0]), 3),
        "max": round(float(sorted_values[-1]), 3),
    }


def _parse_spectrum_prop(value: str) -> dict[int, float]:
    result = {}
    for token in value.split("|"):
        token = token.strip()
        if not token:
            continue
        parts = token.split(";")
        if len(parts) < 3:
            continue
        try:
            shift = float(parts[0])
            atom_idx = int(parts[2])
        except (ValueError, IndexError):
            continue
        result[atom_idx] = shift
    return result


def _prepare_heavy_mol(orig_mol):
    work = Chem.Mol(orig_mol)
    for idx, atom in enumerate(work.GetAtoms()):
        atom.SetIntProp("orig_idx", idx)
    heavy = Chem.RemoveHs(work)
    heavy_map = {}
    for idx, atom in enumerate(heavy.GetAtoms()):
        if atom.HasProp("orig_idx"):
            heavy_map[atom.GetIntProp("orig_idx")] = idx
    return heavy, heavy_map


def _collect_shift_examples_from_supplier(supplier) -> dict:
    # code_values[nucleus][solvent][depth_str] → defaultdict(list)
    # POOLED_SOLVENT ("*") accumulates every measurement regardless of solvent.
    def _make_depth_dict():
        return {str(d): defaultdict(list) for d in HOSE_DEPTHS}

    code_values: dict[str, dict[str, dict]] = {
        "1H": {POOLED_SOLVENT: _make_depth_dict()},
        "13C": {POOLED_SOLVENT: _make_depth_dict()},
    }

    def _ensure_solvent(nucleus: str, solvent: str) -> None:
        if solvent not in code_values[nucleus]:
            code_values[nucleus][solvent] = _make_depth_dict()

    def _add_shift(nucleus: str, solvent: str, depth: int, code: str, shift: float) -> None:
        code_values[nucleus][POOLED_SOLVENT][str(depth)][code].append(shift)
        if solvent != POOLED_SOLVENT:
            _ensure_solvent(nucleus, solvent)
            code_values[nucleus][solvent][str(depth)][code].append(shift)

    for orig_mol in supplier:
        if orig_mol is None:
            continue
        try:
            Chem.SanitizeMol(orig_mol)
        except Exception:
            continue

        heavy_mol, heavy_map = _prepare_heavy_mol(orig_mol)
        hose_code_cache: dict[tuple[int, int], str] = {}

        # Build {spectrum_index: solvent} from the Solvent SDF property.
        # NMRShiftDB2 often records a single solvent entry (index 0) even when
        # the 1H spectrum is at a higher index.  Compute a dominant_solvent as
        # fallback for any spectrum whose index has no explicit solvent entry.
        solvent_map: dict[int, str] = {}
        dominant_solvent = POOLED_SOLVENT
        if orig_mol.HasProp("Solvent"):
            solvent_map = _parse_solvent_prop(orig_mol.GetProp("Solvent"))
            known = [s for s in solvent_map.values() if s != "other"]
            if known:
                # Use the most common named solvent as the per-molecule default.
                dominant_solvent = max(set(known), key=known.count)

        prop_names = tuple(orig_mol.GetPropNames())
        carbon_props = [prop for prop in prop_names if prop.startswith("Spectrum 13C")]
        proton_props = [prop for prop in prop_names if prop.startswith("Spectrum 1H")]

        # Collect ALL 13C spectra for this molecule.
        for prop in carbon_props:
            parts = prop.split()
            spec_idx = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
            solvent = solvent_map.get(spec_idx, dominant_solvent)
            parsed = _parse_spectrum_prop(orig_mol.GetProp(prop))
            if not parsed:
                continue
            for orig_idx, shift in parsed.items():
                heavy_idx = heavy_map.get(orig_idx)
                if heavy_idx is None:
                    continue
                atom = heavy_mol.GetAtomWithIdx(heavy_idx)
                if atom.GetAtomicNum() != 6:
                    continue
                for depth in HOSE_DEPTHS:
                    _add_shift(
                        "13C",
                        solvent,
                        depth,
                        _cached_hose_code(heavy_mol, heavy_idx, depth, hose_code_cache),
                        shift,
                    )

        # Collect ALL 1H spectra for this molecule.
        for prop in proton_props:
            parts = prop.split()
            spec_idx = int(parts[2]) if len(parts) > 2 and parts[2].isdigit() else 0
            solvent = solvent_map.get(spec_idx, dominant_solvent)
            parsed = _parse_spectrum_prop(orig_mol.GetProp(prop))
            if not parsed:
                continue
            heavy_site_shifts: dict[int, list[float]] = defaultdict(list)
            for atom_idx, shift in parsed.items():
                if atom_idx >= orig_mol.GetNumAtoms():
                    continue
                atom = orig_mol.GetAtomWithIdx(atom_idx)
                if atom.GetAtomicNum() != 1 or atom.GetDegree() == 0:
                    continue
                heavy_orig_idx = atom.GetNeighbors()[0].GetIdx()
                heavy_idx = heavy_map.get(heavy_orig_idx)
                if heavy_idx is None:
                    continue
                heavy_site_shifts[heavy_idx].append(shift)
            for heavy_idx, shifts in heavy_site_shifts.items():
                site_shift = float(sum(shifts) / len(shifts))
                for depth in HOSE_DEPTHS:
                    _add_shift(
                        "1H",
                        solvent,
                        depth,
                        _cached_hose_code(heavy_mol, heavy_idx, depth, hose_code_cache),
                        site_shift,
                    )

    def _reduce_nucleus(nucleus_map: dict) -> dict:
        return {
            solvent: {
                depth: {code: _stats(vals) for code, vals in depth_map.items() if len(vals) >= 2}
                for depth, depth_map in solvent_depth_map.items()
            }
            for solvent, solvent_depth_map in nucleus_map.items()
        }

    return {nucleus: _reduce_nucleus(nm) for nucleus, nm in code_values.items()}


def build_hose_database(sdf_path: str) -> dict:
    RDLogger.DisableLog("rdApp.error")
    RDLogger.DisableLog("rdApp.warning")
    try:
        supplier = Chem.SDMolSupplier(sdf_path, removeHs=False, sanitize=False, strictParsing=False)
        payload = _collect_shift_examples_from_supplier(supplier)
    finally:
        RDLogger.EnableLog("rdApp.error")
        RDLogger.EnableLog("rdApp.warning")
    return {
        "_meta": {
            "generated_from": os.path.basename(sdf_path),
            "depths": list(HOSE_DEPTHS),
            "proton_mhz": PROTON_SPECTROMETER_MHZ,
        },
        **payload,
    }


def write_hose_database_sqlite(payload: dict, output_path: str) -> None:
    conn = sqlite3.connect(output_path)
    try:
        conn.executescript(HOSE_DB_SCHEMA)
        conn.execute("DELETE FROM hose_stats")
        conn.execute("DELETE FROM hose_meta")

        meta = payload.get("_meta", {})
        conn.executemany(
            "INSERT INTO hose_meta (key, value) VALUES (?, ?)",
            [(str(key), str(value)) for key, value in meta.items()],
        )

        rows = []
        for nucleus in ("1H", "13C"):
            nucleus_payload = payload.get(nucleus, {})
            for solvent, solvent_payload in nucleus_payload.items():
                for depth_str, depth_payload in solvent_payload.items():
                    depth = int(depth_str)
                    for code, stats in depth_payload.items():
                        rows.append(
                            (
                                nucleus,
                                solvent,
                                depth,
                                code,
                                int(stats["n"]),
                                float(stats["median"]),
                                float(stats["mad"]),
                                float(stats["min"]),
                                float(stats["max"]),
                            )
                        )

        conn.executemany(
            """
            INSERT INTO hose_stats (nucleus, solvent, depth, code, n, median, mad, min, max)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        conn.commit()
    finally:
        conn.close()


def build_hose_database_sqlite(sdf_path: str, output_path: str) -> None:
    payload = build_hose_database(sdf_path)
    write_hose_database_sqlite(payload, output_path)


def _db_path() -> str:
    if hasattr(sys, "_MEIPASS"):
        return os.path.join(sys._MEIPASS, NMR_HOSE_DB_FILENAME)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), NMR_HOSE_DB_FILENAME)


def _empty_hose_db() -> sqlite3.Connection:
    conn = sqlite3.connect(":memory:", check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.executescript(HOSE_DB_SCHEMA)
    return conn


def load_hose_database() -> sqlite3.Connection:
    path = _db_path()
    if not os.path.isfile(path):
        return _empty_hose_db()
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA query_only = 1")
    return conn


def _lookup_hose_shift(
    db: sqlite3.Connection,
    nucleus: str,
    mol,
    atom_idx: int,
    solvent: str = "CDCl3",
    hose_code_cache: dict[tuple[int, int], str] | None = None,
) -> dict | None:
    hits = []
    for depth in HOSE_DEPTHS:
        code = _cached_hose_code(mol, atom_idx, depth, hose_code_cache)
        row = db.execute(
            """
            SELECT n, median, mad, min, max
            FROM hose_stats
            WHERE nucleus = ?
              AND solvent = ?
              AND depth = ?
              AND code = ?
            LIMIT 1
            """,
            (nucleus, solvent, depth, code),
        ).fetchone()
        if row is None and solvent != POOLED_SOLVENT:
            row = db.execute(
                """
                SELECT n, median, mad, min, max
                FROM hose_stats
                WHERE nucleus = ?
                  AND solvent = ?
                  AND depth = ?
                  AND code = ?
                LIMIT 1
                """,
                (nucleus, POOLED_SOLVENT, depth, code),
            ).fetchone()
        stats = dict(row) if row is not None else None
        if stats:
            hits.append({"depth": depth, "code": code, **stats})
    if not hits:
        return None
    # Weighted blend: deeper depth and larger support both increase weight.
    # depth_weight = 2^(depth-2) so depth 6 outweighs depth 2 by 16×.
    weights = [float(h["n"]) * (2.0 ** (h["depth"] - 2)) for h in hits]
    total_weight = sum(weights)
    blended_median = sum(float(h["median"]) * w for h, w in zip(hits, weights, strict=False)) / total_weight
    total_n = sum(int(h["n"]) for h in hits)
    blended_mad = sum(float(h["mad"]) * int(h["n"]) for h in hits) / total_n
    best = max(hits, key=lambda h: h["depth"])
    return {
        "depth": best["depth"],
        "code": best["code"],
        "median": blended_median,
        "n": total_n,
        "mad": blended_mad,
        "min": min(float(h["min"]) for h in hits),
        "max": max(float(h["max"]) for h in hits),
        "_n_depths": len(hits),
    }


def _is_carbonyl_carbon(atom) -> bool:
    return any(
        bond.GetBondType() == rdchem.BondType.DOUBLE and bond.GetOtherAtom(atom).GetAtomicNum() == 8
        for bond in atom.GetBonds()
    )


def _hetero_neighbor_count(atom) -> int:
    return sum(1 for neighbor in atom.GetNeighbors() if neighbor.GetAtomicNum() in HETERO_ATOMIC_NUMS)


def _hetero_shift_weight(atom) -> float:
    weight = 0.0
    for neighbor in atom.GetNeighbors():
        atomic_num = neighbor.GetAtomicNum()
        if atomic_num == 8:
            weight += 1.2
        elif atomic_num == 7:
            weight += 0.7
        elif atomic_num == 16:
            weight += 0.8
        elif atomic_num in {9, 17, 35, 53}:
            weight += 0.55
        elif atomic_num == 15:
            weight += 0.45
    return weight


def _bond_distance_to_heteroatom(atom, max_depth: int = 2) -> int | None:
    visited = {atom.GetIdx()}
    frontier = [atom]
    for depth in range(1, max_depth + 1):
        next_frontier = []
        for current in frontier:
            for neighbor in current.GetNeighbors():
                if neighbor.GetIdx() in visited:
                    continue
                if neighbor.GetAtomicNum() in HETERO_ATOMIC_NUMS:
                    return depth
                visited.add(neighbor.GetIdx())
                next_frontier.append(neighbor)
        frontier = next_frontier
    return None


def _is_attached_to_aromatic(atom) -> bool:
    return any(neighbor.GetIsAromatic() for neighbor in atom.GetNeighbors())


def _is_alpha_to_carbonyl(atom) -> bool:
    return any(_is_carbonyl_carbon(neighbor) for neighbor in atom.GetNeighbors())


def _count_neighbor_hydrogens(atom, exclude_idx: int | None = None) -> int:
    total = 0
    for neighbor in atom.GetNeighbors():
        if exclude_idx is not None and neighbor.GetIdx() == exclude_idx:
            continue
        total += int(neighbor.GetTotalNumHs())
    return total


def _substituent_label(neighbor) -> str:
    atomic_num = neighbor.GetAtomicNum()
    if atomic_num == 6:
        if neighbor.GetIsAromatic():
            return "Car"
        if neighbor.GetHybridization() == rdchem.HybridizationType.SP2:
            return "Csp2"
        if neighbor.GetHybridization() == rdchem.HybridizationType.SP:
            return "Csp"
        return "Csp3"
    if atomic_num == 7:
        return "N"
    if atomic_num == 8:
        return "O"
    if atomic_num == 16:
        return "S"
    if atomic_num == 15:
        return "P"
    return neighbor.GetSymbol()


def _aromatic_ring_signature(mol, atom_idx: int) -> tuple | None:
    ring_info = mol.GetRingInfo()
    atom = mol.GetAtomWithIdx(atom_idx)
    if not atom.GetIsAromatic():
        return None

    aromatic_ring = None
    for ring in ring_info.AtomRings():
        if atom_idx not in ring:
            continue
        if all(mol.GetAtomWithIdx(ring_atom_idx).GetIsAromatic() for ring_atom_idx in ring):
            aromatic_ring = tuple(ring)
            break
    if aromatic_ring is None:
        return None

    ring_positions = {ring_atom_idx: pos for pos, ring_atom_idx in enumerate(aromatic_ring)}
    substituted_by_pos = {}
    ring_size = len(aromatic_ring)
    this_pos = ring_positions[atom_idx]
    for ring_atom_idx in aromatic_ring:
        ring_atom = mol.GetAtomWithIdx(ring_atom_idx)
        external_neighbors = [
            neighbor for neighbor in ring_atom.GetNeighbors() if neighbor.GetIdx() not in ring_positions
        ]
        if not external_neighbors:
            continue
        pos = ring_positions[ring_atom_idx]
        labels = tuple(sorted(_substituent_label(neighbor) for neighbor in external_neighbors))
        substituted_by_pos[pos] = labels

    if not substituted_by_pos:
        return tuple()

    clockwise = []
    counter_clockwise = []
    for step in range(1, ring_size):
        cw_pos = (this_pos + step) % ring_size
        ccw_pos = (this_pos - step) % ring_size
        if cw_pos in substituted_by_pos:
            clockwise.append((step, substituted_by_pos[cw_pos]))
        if ccw_pos in substituted_by_pos:
            counter_clockwise.append((step, substituted_by_pos[ccw_pos]))
    return min(tuple(clockwise), tuple(counter_clockwise))


def _blended_shift(lookup: dict | None, heuristic_value: float) -> tuple[float, str, int]:
    if lookup is None:
        return round(heuristic_value, 3), "heuristic", 0

    depth = int(lookup["depth"])
    support = int(lookup["n"])
    if support >= 20 and depth >= 5:
        heuristic_weight = 0.06
    elif support >= 8 and depth >= 4:
        heuristic_weight = 0.14
    elif support >= 4:
        heuristic_weight = 0.24
    else:
        heuristic_weight = 0.38

    blended = (1 - heuristic_weight) * float(lookup["median"]) + heuristic_weight * heuristic_value
    return round(blended, 3), f"hose-{depth}", support


def _format_lookup_explanation(lookup: dict | None, heuristic_value: float, center: float, source: str) -> list[str]:
    explanation = [f"Final shift {center:.3f} ppm via {source}."]
    if lookup is None:
        explanation.append(f"No HOSE database hit. Heuristic baseline {heuristic_value:.3f} ppm.")
        return explanation

    n_depths = int(lookup.get("_n_depths", 1))
    depth_note = f" (blended across {n_depths} sphere depths)" if n_depths > 1 else f" (sphere {lookup['depth']})"
    explanation.append(
        "Matched HOSE DB"
        f"{depth_note} with support n={int(lookup['n'])} and blended median "
        f"{float(lookup['median']):.3f} ppm (MAD ±{float(lookup['mad']):.3f})."
    )
    explanation.append(f"Fallback heuristic for this environment is {heuristic_value:.3f} ppm.")
    explanation.append(f"Best-depth code starts {lookup['code'][:72]}{'...' if len(lookup['code']) > 72 else ''}")
    return explanation


def _exchangeable_proton_shift(atom) -> float:
    atomic_num = atom.GetAtomicNum()
    if atomic_num == 8:
        if _is_attached_to_aromatic(atom):
            return 5.4
        if _is_alpha_to_carbonyl(atom):
            return 10.8
        return 2.2
    if atomic_num == 7:
        if _is_alpha_to_carbonyl(atom):
            return 7.4
        if atom.GetHybridization() == rdchem.HybridizationType.SP2:
            return 5.6
        return 2.4
    if atomic_num == 16:
        return 1.8
    return 2.0


def _is_potential_stereocenter(atom, ranks: list[int]) -> bool:
    if atom.GetChiralTag() != rdchem.ChiralType.CHI_UNSPECIFIED:
        return True
    if atom.GetHybridization() != rdchem.HybridizationType.SP3:
        return False
    if atom.GetDegree() < 3:
        return False

    neighbor_keys = sorted(ranks[neighbor.GetIdx()] for neighbor in atom.GetNeighbors())
    hydrogen_count = int(atom.GetTotalNumHs())
    if hydrogen_count:
        neighbor_keys.extend([-1] * hydrogen_count)
    return len(neighbor_keys) >= 4 and len(set(neighbor_keys)) >= 4


def _has_nearby_stereocenter(atom, ranks: list[int], max_depth: int = 2) -> bool:
    visited = {atom.GetIdx()}
    frontier = [atom]
    for depth in range(1, max_depth + 1):
        next_frontier = []
        for current in frontier:
            for neighbor in current.GetNeighbors():
                if neighbor.GetIdx() in visited:
                    continue
                if depth >= 1 and _is_potential_stereocenter(neighbor, ranks):
                    return True
                visited.add(neighbor.GetIdx())
                next_frontier.append(neighbor)
        frontier = next_frontier
    return False


def _is_terminal_vinyl_ch2(atom) -> bool:
    if atom.GetAtomicNum() != 6 or int(atom.GetTotalNumHs()) != 2:
        return False
    if atom.GetHybridization() != rdchem.HybridizationType.SP2:
        return False
    return any(
        bond.GetBondType() == rdchem.BondType.DOUBLE and bond.GetOtherAtom(atom).GetAtomicNum() == 6
        for bond in atom.GetBonds()
    )


def _is_diastereotopic_methylene(atom, ranks: list[int]) -> bool:
    if atom.GetAtomicNum() != 6 or int(atom.GetTotalNumHs()) != 2:
        return False
    if atom.GetIsAromatic():
        return False
    if _is_terminal_vinyl_ch2(atom):
        return True
    if atom.GetHybridization() != rdchem.HybridizationType.SP3:
        return False
    # Acyclic: stereocenter within 3 bonds
    if not atom.IsInRing() and _has_nearby_stereocenter(atom, ranks, max_depth=3):
        return True
    # Ring CH₂: diastereotopic if any atom in the same ring is a stereocenter
    if atom.IsInRing():
        mol = atom.GetOwningMol()
        ring_info = mol.GetRingInfo()
        atom_idx = atom.GetIdx()
        for ring in ring_info.AtomRings():
            if atom_idx not in ring:
                continue
            if any(_is_potential_stereocenter(mol.GetAtomWithIdx(idx), ranks) for idx in ring if idx != atom_idx):
                return True
    return False


def _vinyl_couplings_for_terminal_ch2(atom) -> tuple[float, float]:
    for bond in atom.GetBonds():
        if bond.GetBondType() != rdchem.BondType.DOUBLE:
            continue
        neighbor = bond.GetOtherAtom(atom)
        if neighbor.GetAtomicNum() != 6:
            continue
        neighbor_h = int(neighbor.GetTotalNumHs())
        if neighbor_h <= 0:
            continue
        stereo = bond.GetStereo()
        if stereo in {rdchem.BondStereo.STEREOE, rdchem.BondStereo.STEREOTRANS}:
            return 17.0, 10.5
        if stereo in {rdchem.BondStereo.STEREOZ, rdchem.BondStereo.STEREOCIS}:
            return 10.5, 17.0
        return 17.0, 10.5
    return 17.0, 10.5


def _alkene_vicinal_coupling(bond) -> float:
    stereo = bond.GetStereo()
    if stereo in {rdchem.BondStereo.STEREOE, rdchem.BondStereo.STEREOTRANS}:
        return 15.8
    if stereo in {rdchem.BondStereo.STEREOZ, rdchem.BondStereo.STEREOCIS}:
        return 10.2
    return 13.0


def _carbon_heuristic(atom) -> float:
    degree = atom.GetDegree()
    hetero_count = _hetero_neighbor_count(atom)
    hetero_weight = _hetero_shift_weight(atom)

    if _is_carbonyl_carbon(atom):
        has_hetero_single_neighbor = any(
            neighbor.GetAtomicNum() in {7, 8, 16} and mol_bond.GetBondType() == rdchem.BondType.SINGLE
            for mol_bond in atom.GetBonds()
            for neighbor in [mol_bond.GetOtherAtom(atom)]
        )
        if has_hetero_single_neighbor:
            return 168.0
        if atom.GetTotalNumHs() > 0:
            return 194.0
        return 203.0

    if atom.GetHybridization() == rdchem.HybridizationType.SP:
        return 78.0 if degree <= 1 else 92.0

    if atom.GetIsAromatic():
        if hetero_count > 0:
            return 153.0
        if atom.GetTotalNumHs() > 0:
            return 128.0
        return 137.0

    if atom.GetHybridization() == rdchem.HybridizationType.SP2:
        if hetero_count > 0:
            return 138.0 + hetero_weight * 10.0
        return 126.0 if atom.GetTotalNumHs() > 0 else 136.0

    if hetero_count > 0:
        return 28.0 + hetero_weight * 24.0
    if _is_alpha_to_carbonyl(atom):
        return 32.0
    if degree <= 1:
        return 14.0
    if degree == 2:
        return 24.0
    if degree == 3:
        return 34.0
    return 42.0


def _proton_heuristic(atom) -> float:
    if atom.GetAtomicNum() in {7, 8, 16}:
        return _exchangeable_proton_shift(atom)

    hetero_count = _hetero_neighbor_count(atom)
    hetero_weight = _hetero_shift_weight(atom)
    alpha_hetero = _bond_distance_to_heteroatom(atom, max_depth=1) is not None

    if _is_carbonyl_carbon(atom) and atom.GetTotalNumHs() > 0:
        return 9.75
    if atom.GetHybridization() == rdchem.HybridizationType.SP:
        return 2.45
    if atom.GetIsAromatic():
        shift = 6.95 + min(0.45, hetero_count * 0.18)
        if _is_attached_to_aromatic(atom) and hetero_count > 0:
            shift += 0.12
        return shift
    if atom.GetHybridization() == rdchem.HybridizationType.SP2:
        return 5.1 + min(0.6, hetero_count * 0.22)
    if any(neighbor.GetHybridization() == rdchem.HybridizationType.SP2 for neighbor in atom.GetNeighbors()):
        return 1.75 + min(0.55, hetero_weight * 0.3)
    if alpha_hetero:
        return 2.15 + min(1.35, hetero_weight * 0.95)
    if _is_alpha_to_carbonyl(atom):
        return 2.2
    if _is_attached_to_aromatic(atom):
        return 2.32

    degree = atom.GetDegree()
    if degree <= 1:
        return 0.92
    if degree == 2:
        return 1.28
    if degree == 3:
        return 1.55
    return 1.72


def _pascal_row(n: int) -> list[int]:
    row = [1]
    for _ in range(n):
        row = [1] + [row[i] + row[i + 1] for i in range(len(row) - 1)] + [1]
    return row


def _coupling_groups_for_atom(atom) -> list[tuple[int, float]]:
    if atom.GetAtomicNum() in {7, 8, 16}:
        return []
    groups = []
    for bond in atom.GetBonds():
        neighbor = bond.GetOtherAtom(atom)
        if neighbor.GetAtomicNum() != 6:
            continue
        neighbor_h = int(neighbor.GetTotalNumHs())
        if neighbor_h <= 0:
            continue
        if atom.GetIsAromatic() and neighbor.GetIsAromatic():
            groups.append((neighbor_h, 7.8))
            continue
        if bond.GetBondType() == rdchem.BondType.DOUBLE:
            groups.append((neighbor_h, _alkene_vicinal_coupling(bond)))
            continue
        if (
            atom.GetHybridization() == rdchem.HybridizationType.SP2
            and neighbor.GetHybridization() == rdchem.HybridizationType.SP3
        ) or (
            atom.GetHybridization() == rdchem.HybridizationType.SP3
            and neighbor.GetHybridization() == rdchem.HybridizationType.SP2
        ):
            groups.append((neighbor_h, 6.6))
            continue
        if _is_attached_to_aromatic(atom) and _is_attached_to_aromatic(neighbor):
            groups.append((neighbor_h, 7.2))
            continue
        if _is_alpha_to_carbonyl(atom) or _is_alpha_to_carbonyl(neighbor):
            groups.append((neighbor_h, 7.4))
            continue
        groups.append((neighbor_h, 7.0))
    grouped = defaultdict(float)
    for count, j_hz in groups:
        grouped[count] = max(grouped[count], j_hz)
    return sorted(grouped.items(), key=lambda item: item[0])


def _apply_split(transitions: list[tuple[float, float]], count: int, j_hz: float) -> list[tuple[float, float]]:
    row = _pascal_row(count)
    j_ppm = j_hz / PROTON_SPECTROMETER_MHZ
    offset_start = -0.5 * count * j_ppm
    result = []
    for ppm, intensity in transitions:
        for idx, coeff in enumerate(row):
            result.append((ppm + offset_start + idx * j_ppm, intensity * coeff))
    return result


def _transition_payload(center: float, groups: list[tuple[int, float]]) -> list[dict]:
    transitions = [(center, 1.0)]
    for count, j_hz in groups:
        transitions = _apply_split(transitions, count, j_hz)
    total_intensity = sum(intensity for _, intensity in transitions) or 1.0
    return [
        {
            "ppm": round(ppm, 4),
            "intensity": round(intensity / total_intensity, 4),
            "label": None,
        }
        for ppm, intensity in sorted(transitions, key=lambda item: item[0], reverse=True)
    ]


def _multiplicity_label(groups: list[tuple[int, float]]) -> str:
    if not groups:
        return "s"
    total_sets = []
    for count, _ in groups:
        label_map = {1: "d", 2: "t", 3: "q"}
        total_sets.append(label_map.get(count, "m"))
    if len(total_sets) == 1:
        return total_sets[0]
    if all(label == "d" for label in total_sets):
        return "dd"
    if len(total_sets) == 2 and "d" in total_sets and "t" in total_sets:
        return "dt"
    return "m"


def _build_proton_signal(atom_idx: int, atom, lookup: dict | None) -> dict:
    heuristic_shift = _proton_heuristic(atom)
    center, source, confidence = _blended_shift(lookup, heuristic_shift)
    groups = _coupling_groups_for_atom(atom)
    transition_payload = _transition_payload(center, groups)
    return {
        "atom_idxs": [atom_idx],
        "center_ppm": center,
        "integral": int(atom.GetTotalNumHs()),
        "multiplicity": _multiplicity_label(groups),
        "couplings_hz": [round(j_hz, 1) for _, j_hz in groups],
        "confidence": confidence,
        "source": source,
        "mad": round(float(lookup["mad"]), 3) if lookup else 0.0,
        "explanation": _format_lookup_explanation(lookup, heuristic_shift, center, source),
        "transitions": transition_payload,
    }


def _build_split_methylene_signals(atom_idx: int, atom, lookup: dict | None, ranks: list[int]) -> list[dict]:
    heuristic_shift = _proton_heuristic(atom)
    center, source, confidence = _blended_shift(lookup, heuristic_shift)
    if _is_terminal_vinyl_ch2(atom):
        offset = 0.22
        trans_j, cis_j = _vinyl_couplings_for_terminal_ch2(atom)
        variants = [
            {"center": center + offset, "groups": [(1, 1.5), (1, trans_j)], "label": "Ha"},
            {"center": center - offset, "groups": [(1, 1.5), (1, cis_j)], "label": "Hb"},
        ]
        variant_source = f"{source}-vinyl"
    else:
        offset = 0.12
        base_groups = _coupling_groups_for_atom(atom)
        variants = [
            {"center": center + offset, "groups": [(1, 13.2), *base_groups], "label": "Ha"},
            {"center": center - offset, "groups": [(1, 13.2), *base_groups], "label": "Hb"},
        ]
        variant_source = f"{source}-diastereo"

    signals = []
    for variant in variants:
        groups = variant["groups"]
        signals.append(
            {
                "atom_idxs": [atom_idx],
                "center_ppm": round(variant["center"], 3),
                "integral": 1,
                "multiplicity": _multiplicity_label(groups),
                "couplings_hz": [round(j_hz, 1) for _, j_hz in groups],
                "confidence": confidence,
                "source": f"{variant_source}-{variant['label']}",
                "mad": round(float(lookup["mad"]), 3) if lookup else 0.0,
                "explanation": [
                    *_format_lookup_explanation(
                        lookup,
                        heuristic_shift,
                        variant["center"],
                        f"{variant_source}-{variant['label']}",
                    ),
                    f"Split methylene proton {variant['label']} generated from a non-equivalent CH2 site.",
                ],
                "transitions": _transition_payload(variant["center"], groups),
            }
        )
    return signals


def _build_carbon_signal(atom_idx: int, atom, lookup: dict | None) -> dict:
    heuristic_shift = _carbon_heuristic(atom)
    center, source, confidence = _blended_shift(lookup, heuristic_shift)
    return {
        "atom_idxs": [atom_idx],
        "center_ppm": round(center, 2),
        "integral": 1,
        "multiplicity": "s",
        "couplings_hz": [],
        "confidence": confidence,
        "source": source,
        "mad": round(float(lookup["mad"]), 3) if lookup else 0.0,
        "explanation": _format_lookup_explanation(lookup, heuristic_shift, center, source),
        "transitions": [{"ppm": round(center, 2), "intensity": 1.0, "label": None}],
    }


def _merge_signal_group(signals: list[dict]) -> dict:
    atom_idxs = sorted({atom_idx for signal in signals for atom_idx in signal["atom_idxs"]})
    total_integral = sum(int(signal["integral"]) for signal in signals)
    total_confidence = sum(int(signal["confidence"]) for signal in signals)
    weighted_center = sum(float(signal["center_ppm"]) * max(1, int(signal["integral"])) for signal in signals) / max(
        1, total_integral
    )

    transition_bins = defaultdict(float)
    for signal in signals:
        for transition in signal["transitions"]:
            key = round(float(transition["ppm"]), 3)
            transition_bins[key] += float(transition["intensity"]) * max(1, int(signal["integral"]))
    total_transition_intensity = sum(transition_bins.values()) or 1.0
    transitions = [
        {"ppm": ppm, "intensity": round(intensity / total_transition_intensity, 4), "label": None}
        for ppm, intensity in sorted(transition_bins.items(), reverse=True)
    ]

    source = max(signals, key=lambda signal: (int(signal["confidence"]), signal["source"]))["source"]
    explanation = max(
        signals,
        key=lambda signal: (
            int(signal["confidence"]),
            len(signal.get("explanation", [])),
        ),
    ).get("explanation", [])
    multiplicity = max(signals, key=lambda signal: len(signal["couplings_hz"]))["multiplicity"]
    couplings = sorted({round(float(value), 1) for signal in signals for value in signal["couplings_hz"]})
    merged_mad = max(float(signal.get("mad", 0.0)) for signal in signals)

    return {
        "atom_idxs": atom_idxs,
        "center_ppm": round(weighted_center, 3),
        "integral": total_integral,
        "multiplicity": multiplicity,
        "couplings_hz": couplings,
        "confidence": total_confidence,
        "source": source,
        "mad": round(merged_mad, 3),
        "explanation": explanation,
        "transitions": transitions,
    }


def _group_signals(mol, signals: list[dict], nucleus: str, ranks: list[int] | None = None) -> list[dict]:
    if not signals:
        return []

    if ranks is None:
        ranks = list(Chem.CanonicalRankAtoms(mol, breakTies=False))
    grouped: dict[tuple, list[dict]] = defaultdict(list)
    for signal in signals:
        first_idx = signal["atom_idxs"][0]
        atom = mol.GetAtomWithIdx(first_idx)
        rank = ranks[first_idx]
        rounded_center = round(float(signal["center_ppm"]), 2 if nucleus == "1H" else 1)
        couplings = tuple(round(float(value), 1) for value in signal["couplings_hz"])
        aromatic_signature = None
        if atom.GetIsAromatic() and atom.GetAtomicNum() == 6:
            aromatic_signature = _aromatic_ring_signature(mol, first_idx)
        key = (
            aromatic_signature if aromatic_signature is not None else rank,
            rounded_center,
            signal["multiplicity"],
            couplings,
            signal["source"],
        )
        grouped[key].append(signal)

    merged = [_merge_signal_group(items) for items in grouped.values()]
    merged.sort(key=lambda signal: signal["center_ppm"], reverse=True)
    return merged


def predict_nmr_hose_from_mol(mol, db: dict | None = None, solvent: str = "CDCl3") -> dict:
    if db is None:
        db = load_hose_database()

    ranks = list(Chem.CanonicalRankAtoms(mol, breakTies=False))
    hose_code_cache: dict[tuple[int, int], str] = {}
    signals_13c = []
    signals_1h = []
    for atom in mol.GetAtoms():
        atom_idx = atom.GetIdx()
        if atom.GetAtomicNum() == 6:
            lookup = _lookup_hose_shift(db, "13C", mol, atom_idx, solvent=solvent, hose_code_cache=hose_code_cache)
            signals_13c.append(_build_carbon_signal(atom_idx, atom, lookup))
        if atom.GetAtomicNum() != 1 and atom.GetTotalNumHs() > 0:
            lookup = _lookup_hose_shift(db, "1H", mol, atom_idx, solvent=solvent, hose_code_cache=hose_code_cache)
            if _is_diastereotopic_methylene(atom, ranks):
                signals_1h.extend(_build_split_methylene_signals(atom_idx, atom, lookup, ranks))
            else:
                signals_1h.append(_build_proton_signal(atom_idx, atom, lookup))

    signals_1h = _group_signals(mol, signals_1h, "1H", ranks=ranks)
    signals_13c = _group_signals(mol, signals_13c, "13C", ranks=ranks)
    return {"signals_1h": signals_1h, "signals_13c": signals_13c}


def predict_nmr_hose(smiles: str, db: dict | None = None, solvent: str = "CDCl3") -> dict:
    mol = Chem.MolFromSmiles(smiles)
    if not mol:
        return {"error": "Invalid SMILES"}
    return predict_nmr_hose_from_mol(mol, db=db, solvent=solvent)


def apply_topology_j_to_signals(mol, signals_1h: list[dict]) -> list[dict]:
    updated = []
    for signal in signals_1h:
        if not signal.get("atom_idxs"):
            updated.append(signal)
            continue
        atom_idx = int(signal["atom_idxs"][0])
        atom = mol.GetAtomWithIdx(atom_idx)
        groups = _coupling_groups_for_atom(atom)
        updated_signal = {
            **signal,
            "multiplicity": _multiplicity_label(groups) if groups else signal.get("multiplicity", "s"),
            "couplings_hz": [round(j_hz, 1) for _, j_hz in groups],
            "transitions": (
                _transition_payload(float(signal["center_ppm"]), groups) if groups else signal.get("transitions", [])
            ),
            "source": f"{signal.get('source', 'dft')}+topology-j",
        }
        updated.append(updated_signal)
    updated.sort(key=lambda signal: signal["center_ppm"], reverse=True)
    return updated
