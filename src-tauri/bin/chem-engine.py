import argparse
import atexit
import hashlib
import importlib.util
import json
import math
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time

from nmr_hose import apply_topology_j_to_signals, predict_nmr_hose_from_mol
from rdkit import Chem
from rdkit.Chem import AllChem, Descriptors, rdMolDescriptors

_ACTIVE_SUBPROCESSES: set[subprocess.Popen] = set()
_CACHED_HOSE_DB: object | None = None
_HOSE_DB_LOCK = threading.Lock()


def _terminate_active_subprocesses() -> None:
    for proc in list(_ACTIVE_SUBPROCESSES):
        try:
            if proc.poll() is None:
                proc.terminate()
        except Exception:
            pass


def _handle_termination_signal(signum, _frame) -> None:
    _terminate_active_subprocesses()
    raise SystemExit(128 + signum)


def _monitor_parent_process(parent_pid: int) -> None:
    while True:
        time.sleep(1.0)
        try:
            if os.getppid() != parent_pid:
                _terminate_active_subprocesses()
                os._exit(1)
        except Exception:
            _terminate_active_subprocesses()
            os._exit(1)


def _run_tracked_subprocess(
    args,
    *,
    cwd=None,
    capture_output=False,
    text=False,
    timeout=None,
    env=None,
):
    proc = subprocess.Popen(
        args,
        cwd=cwd,
        env=env,
        stdout=subprocess.PIPE if capture_output else None,
        stderr=subprocess.PIPE if capture_output else None,
        text=text,
    )
    _ACTIVE_SUBPROCESSES.add(proc)
    try:
        stdout, stderr = proc.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.communicate()
        raise
    finally:
        _ACTIVE_SUBPROCESSES.discard(proc)

    return subprocess.CompletedProcess(args, proc.returncode, stdout, stderr)


atexit.register(_terminate_active_subprocesses)
for _signal_name in ("SIGTERM", "SIGINT"):
    if hasattr(signal, _signal_name):
        signal.signal(getattr(signal, _signal_name), _handle_termination_signal)


_METAL_ATOMIC_NUMBERS = {
    3,
    4,
    11,
    12,
    13,
    *range(19, 32),
    *range(37, 51),
    *range(55, 84),
    *range(87, 113),
}


def _contains_metal(mol) -> bool:
    return any(atom.GetAtomicNum() in _METAL_ATOMIC_NUMBERS for atom in mol.GetAtoms())


def _preferred_rdkit_force_field(mol, requested_force_field: str) -> str:
    if requested_force_field == "UFF":
        return "UFF"
    if _contains_metal(mol):
        return "UFF"
    if not AllChem.MMFFHasAllMoleculeParams(mol):
        return "UFF"
    return requested_force_field


def _optimize_molecule_confs(mol, requested_force_field: str, max_iters: int):
    effective_force_field = _preferred_rdkit_force_field(mol, requested_force_field)
    if requested_force_field == "xtb":
        if effective_force_field == "UFF":
            return AllChem.UFFOptimizeMoleculeConfs(mol, maxIters=max_iters), effective_force_field
        return AllChem.MMFFOptimizeMoleculeConfs(mol, mmffVariant="MMFF94s", maxIters=max_iters), "MMFF94s"
    if effective_force_field == "UFF":
        return AllChem.UFFOptimizeMoleculeConfs(mol, maxIters=max_iters), effective_force_field
    variant = "MMFF94s" if effective_force_field == "MMFF94s" else "MMFF94"
    return AllChem.MMFFOptimizeMoleculeConfs(mol, mmffVariant=variant, maxIters=max_iters), effective_force_field


def _optimize_molecule(mol, requested_force_field: str, max_iters: int):
    effective_force_field = _preferred_rdkit_force_field(mol, requested_force_field)
    if effective_force_field == "UFF":
        AllChem.UFFOptimizeMolecule(mol, maxIters=max_iters)
        return effective_force_field
    variant = "MMFF94s" if effective_force_field != "MMFF94" else "MMFF94"
    AllChem.MMFFOptimizeMolecule(mol, mmffVariant=variant, maxIters=max_iters)
    return effective_force_field


def _parse_mol(smiles=None, molblock=None):
    """Parse a molecule from molblock or SMILES, tolerating unusual valences."""
    mol = None
    if molblock:
        mol = Chem.MolFromMolBlock(molblock, sanitize=True)
        if not mol:
            mol = Chem.MolFromMolBlock(molblock, sanitize=False)
            if mol:
                try:
                    Chem.SanitizeMol(
                        mol,
                        Chem.SanitizeFlags.SANITIZE_ALL ^ Chem.SanitizeFlags.SANITIZE_PROPERTIES,
                    )
                    mol.UpdatePropertyCache(strict=False)
                except Exception:
                    mol = None
    if not mol and smiles:
        mol = Chem.MolFromSmiles(smiles)
        if not mol:
            mol = Chem.MolFromSmiles(smiles, sanitize=False)
            if mol:
                try:
                    Chem.SanitizeMol(
                        mol,
                        Chem.SanitizeFlags.SANITIZE_ALL ^ Chem.SanitizeFlags.SANITIZE_PROPERTIES,
                    )
                    mol.UpdatePropertyCache(strict=False)
                except Exception:
                    mol = None
    return mol


def generate_conformers(
    smiles=None,
    molblock=None,
    pool_size=50,
    max_output=10,
    energy_window=10.0,
    rmsd_threshold=0.5,
    force_field="MMFF94s",
):
    try:
        mol = _parse_mol(smiles=smiles, molblock=molblock)
        if not mol:
            return {"error": "Invalid structure"}

        mol = Chem.AddHs(mol)
        atom_count = mol.GetNumAtoms()
        requested_output = max(1, min(int(max_output), 10))
        if atom_count <= 24:
            pool_size = min(max(requested_output * 4, 12), 32)
            max_iters = 400
        elif atom_count <= 60:
            pool_size = min(max(requested_output * 3, 8), 20)
            max_iters = 300
        else:
            pool_size = min(max(requested_output * 2, 6), 12)
            max_iters = 200

        params = AllChem.ETKDGv3()
        params.randomSeed = 0xF00D
        conf_ids = AllChem.EmbedMultipleConfs(mol, numConfs=pool_size, params=params)

        if not conf_ids:
            return {"error": "Initial 3D embedding failed"}

        ff_results, effective_force_field = _optimize_molecule_confs(mol, force_field, max_iters)

        data_pool = []
        for i, conf_id in enumerate(conf_ids):
            converged, energy = ff_results[i]
            if converged != 0:
                continue
            data_pool.append({"conf_id": conf_id, "energy": energy})

        if not data_pool:
            return {"error": f"No conformers converged during {effective_force_field} minimization"}

        data_pool.sort(key=lambda x: x["energy"])
        min_energy = data_pool[0]["energy"]

        unique_conformers = []
        if data_pool:
            unique_conformers.append(data_pool[0])
            for i in range(1, len(data_pool)):
                if len(unique_conformers) >= max_output:
                    break
                item = data_pool[i]
                if (item["energy"] - min_energy) > energy_window:
                    continue

                is_unique = True
                for kept in unique_conformers:
                    rmsd = AllChem.GetBestRMS(mol, mol, item["conf_id"], kept["conf_id"])
                    if rmsd < rmsd_threshold:
                        is_unique = False
                        break
                if is_unique:
                    unique_conformers.append(item)

        final_results = []
        if force_field == "xtb":
            xtb_results = []
            for item in unique_conformers:
                optimized = _xtb_optimize_conformer(mol, item["conf_id"])
                if optimized is not None:
                    xtb_results.append(optimized)

            if not xtb_results:
                xtb_bin, _xtb_share = _find_xtb()
                if not xtb_bin:
                    return {"error": "xtb not found. Install via: conda install -c conda-forge xtb", "fallback": True}
                return {"error": "No conformers converged during xtb minimization"}

            if any(item["energy_hartree"] is not None for item in xtb_results):
                xtb_results.sort(
                    key=lambda item: item["energy_hartree"] if item["energy_hartree"] is not None else float("inf")
                )
            hartree_to_kcal = 627.509474
            min_energy_hartree = next(
                (item["energy_hartree"] for item in xtb_results if item["energy_hartree"] is not None),
                None,
            )
            for item in xtb_results:
                delta_e = None
                if item["energy_hartree"] is not None and min_energy_hartree is not None:
                    delta_e = (item["energy_hartree"] - min_energy_hartree) * hartree_to_kcal
                final_results.append(
                    {
                        "atoms": item["atoms"],
                        "energy": delta_e,
                        "delta_e": delta_e,
                    }
                )
        else:
            for item in unique_conformers:
                conf = mol.GetConformer(item["conf_id"])
                atoms = []
                for j in range(mol.GetNumAtoms()):
                    pos = conf.GetAtomPosition(j)
                    atoms.append(
                        {
                            "element": mol.GetAtomWithIdx(j).GetSymbol(),
                            "atomMapNum": mol.GetAtomWithIdx(j).GetAtomMapNum() or None,
                            "x": pos.x,
                            "y": pos.y,
                            "z": pos.z,
                        }
                    )
                final_results.append({"atoms": atoms, "energy": item["energy"], "delta_e": item["energy"] - min_energy})

        bonds = []
        for b in mol.GetBonds():
            bonds.append({"a1": b.GetBeginAtomIdx(), "a2": b.GetEndAtomIdx(), "order": int(b.GetBondTypeAsDouble())})

        return {
            "smiles": smiles,
            "conformers": final_results,
            "bonds": bonds,
            "force_field_used": effective_force_field,
        }
    except Exception as e:
        return {"error": str(e)}


def xyz_to_conformer(xyz_text):
    try:
        mol = Chem.MolFromXYZBlock(xyz_text)
        if not mol:
            return {"error": "Failed to parse XYZ content"}
        mol = Chem.RWMol(mol)
        AllChem.DetermineConnectivity(mol)
        mol = mol.GetMol()
        if not mol.GetNumConformers():
            return {"error": "XYZ block has no conformer data"}
        conf = mol.GetConformer(0)
        atoms = []
        for i in range(mol.GetNumAtoms()):
            pos = conf.GetAtomPosition(i)
            atoms.append({"element": mol.GetAtomWithIdx(i).GetSymbol(), "x": pos.x, "y": pos.y, "z": pos.z})
        bonds = []
        for b in mol.GetBonds():
            bonds.append({"a1": b.GetBeginAtomIdx(), "a2": b.GetEndAtomIdx(), "order": int(b.GetBondTypeAsDouble())})
        return {"conformers": [{"atoms": atoms, "energy": None, "delta_e": 0.0}], "bonds": bonds}
    except Exception as e:
        return {"error": str(e)}


def parse_file(content, format):
    try:
        mol = None
        if format == "xyz":
            mol = Chem.MolFromXYZBlock(content)
            if mol:
                mol = Chem.Mol(mol)
                AllChem.DetermineConnectivity(mol)
        elif format == "pdb":
            mol = Chem.MolFromPDBBlock(content)
        elif format == "sdf":
            suppl = Chem.SDMolSupplier()
            suppl.SetData(content)
            mol = next(suppl)
        elif format == "mol":
            mol = _parse_mol(molblock=content)
        elif format == "cif":
            if hasattr(Chem, "MolFromCIFBlock"):
                mol = Chem.MolFromCIFBlock(content)
            else:
                return {"error": "CIF support not available in this RDKit version"}

        if not mol:
            return {"error": f"Failed to parse {format} content"}

        if not mol.GetNumConformers():
            AllChem.Compute2DCoords(mol)

        return {"molblock": Chem.MolToMolBlock(mol), "smiles": Chem.MolToSmiles(mol)}
    except Exception as e:
        return {"error": str(e)}


def export_file(molblock, format, arrows_json=None):
    try:
        mol = _parse_mol(molblock=molblock)
        if not mol:
            return {"error": "Invalid molblock provided"}

        if format == "sdf":
            return {"content": Chem.MolToV3KMolBlock(mol) if mol.GetNumAtoms() > 999 else Chem.MolToMolBlock(mol)}
        elif format == "mol":
            return {"content": Chem.MolToMolBlock(mol)}
        elif format == "rxn":
            atom_map = Chem.GetMolFrags(mol)  # tuple of (atom_idx,...) per fragment
            frag_mols = Chem.GetMolFrags(mol, asMols=True)

            reactants = []
            products = []

            if arrows_json:
                arrows = json.loads(arrows_json)
                # Use first reaction arrow to split: fragments whose centroid is on the
                # tail side → reactants; on the head side → products.
                # Arrow goes from (x1,y1)=tail to (x2,y2)=head in canvas coordinates.
                if arrows:
                    arrow = arrows[0]
                    tail_x = arrow.get("x1", 0)
                    head_x = arrow.get("x2", 0)
                    # Canvas x grows right; molblock x is in Å (÷30 from canvas px, centered)
                    # We compare molblock x centroids directly since arrow is in canvas px.
                    # Re-scale: canvas_x = molblock_x * 30 + canvas_center_x; but we don't
                    # know canvas_center_x here. Use relative ordering: left of midpoint in
                    # canvas → leftward in molblock (same direction).
                    # Midpoint in molblock coords relative to centroid:
                    mol_xs = [mol.GetConformer().GetAtomPosition(i).x for i in range(mol.GetNumAtoms())]
                    mol_cx = sum(mol_xs) / len(mol_xs) if mol_xs else 0
                    # canvas mid_x → mol mid_x (canvas grows right = mol grows right)
                    # tail_x < head_x means arrow points right → reactants are left (smaller x)
                    arrow_points_right = head_x >= tail_x
                    conf = mol.GetConformer()
                    for frag_mol, atom_indices in zip(frag_mols, atom_map, strict=False):
                        xs = [conf.GetAtomPosition(int(idx)).x for idx in atom_indices]
                        cx = sum(xs) / len(xs) if xs else 0
                        if (arrow_points_right and cx <= mol_cx) or (not arrow_points_right and cx >= mol_cx):
                            reactants.append(frag_mol)
                        else:
                            products.append(frag_mol)

            if not reactants and not products:
                # Fallback: all as reactants
                reactants = list(frag_mols)

            nr, np = len(reactants), len(products)
            lines = [f"$RXN\n\n      ChemEditor\n\n{nr:>3}{np:>3}\n"]
            for frag in reactants + products:
                lines.append("$MOL\n")
                lines.append(Chem.MolToMolBlock(frag))
            return {"content": "".join(lines)}

        return {"error": f"Unsupported export format: {format}"}
    except Exception as e:
        return {"error": str(e)}


def compute_properties(smiles):
    try:
        mol = Chem.MolFromSmiles(smiles)
        if not mol:
            return {"error": "Invalid SMILES"}
        return {
            "formula": rdMolDescriptors.CalcMolFormula(mol),
            "mw": round(Descriptors.MolWt(mol), 4),
            "exact_mass": round(Descriptors.ExactMolWt(mol), 6),
            "logp": round(Descriptors.MolLogP(mol), 2),
            "tpsa": round(Descriptors.TPSA(mol), 1),
            "hbd": rdMolDescriptors.CalcNumHBD(mol),
            "hba": rdMolDescriptors.CalcNumHBA(mol),
            "rotatable_bonds": rdMolDescriptors.CalcNumRotatableBonds(mol),
            "rings": rdMolDescriptors.CalcNumRings(mol),
            "aromatic_rings": rdMolDescriptors.CalcNumAromaticRings(mol),
            "charge": Chem.GetFormalCharge(mol),
            "heavy_atoms": mol.GetNumHeavyAtoms(),
        }
    except Exception as e:
        return {"error": str(e)}


def _find_xtb():
    """Locate the xtb binary and return (binary_path, xtb_share_dir | None).

    Search order: bundled (PyInstaller sys._MEIPASS) → alongside script → PATH.
    The share dir contains parameter files (param_gfnff.xtb etc.); if found
    it should be set as XTBPATH before invoking xtb.
    """

    def _share(base):
        d = os.path.join(base, "xtb-share")
        return d if os.path.isdir(d) else None

    exe = ".exe" if sys.platform == "win32" else ""

    # PyInstaller onefile extraction dir
    if hasattr(sys, "_MEIPASS"):
        candidate = os.path.join(sys._MEIPASS, "xtb" + exe)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate, _share(sys._MEIPASS)

    # Dev: alongside chem-engine.py
    script_dir = os.path.dirname(os.path.abspath(__file__))
    candidate = os.path.join(script_dir, "xtb" + exe)
    if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
        return candidate, _share(script_dir)

    # System PATH (conda / system install — XTBPATH already set by activation)
    system = shutil.which("xtb")
    return system, None


# Isotope data: (mass_offset_from_lightest_stable_isotope_Da, natural_abundance)
_ISOTOPE_DATA = {
    "H": [(0.000000, 0.999885), (1.006277, 0.000115)],
    "C": [(0.000000, 0.989300), (1.003355, 0.010700)],
    "N": [(0.000000, 0.996320), (0.997035, 0.003680)],
    "O": [(0.000000, 0.997570), (1.004217, 0.000380), (2.004966, 0.002050)],
    "S": [(0.000000, 0.949900), (0.999388, 0.007500), (1.995796, 0.042500), (3.995010, 0.000100)],
    "Cl": [(0.000000, 0.757600), (1.997050, 0.242400)],
    "Br": [(0.000000, 0.506900), (1.997953, 0.493100)],
    "Si": [(0.000000, 0.922300), (0.999567, 0.046700), (1.998844, 0.031000)],
}


def predict_ms(smiles):
    try:
        mol = Chem.MolFromSmiles(smiles)
        if not mol:
            return {"error": "Invalid SMILES"}

        mono_mass = Descriptors.ExactMolWt(mol)
        formula = rdMolDescriptors.CalcMolFormula(mol)

        # Count elements (with explicit H)
        mol_h = Chem.AddHs(mol)
        elem_counts: dict[str, int] = {}
        for atom in mol_h.GetAtoms():
            sym = atom.GetSymbol()
            elem_counts[sym] = elem_counts.get(sym, 0) + 1

        # Build isotope envelope by convolving per-element distributions
        # Keys are exact mass offsets (rounded to 6 dp to prevent float drift)
        dist: dict[float, float] = {0.0: 1.0}

        for elem, count in elem_counts.items():
            if elem not in _ISOTOPE_DATA:
                continue  # monoisotopic element (F, P, I, …) — no spread
            isotopes = _ISOTOPE_DATA[elem]

            # Build distribution for one atom of this element
            elem_dist: dict[float, float] = {round(m, 6): p for m, p in isotopes}

            # Raise to count-th power via repeated convolution
            combined: dict[float, float] = {0.0: 1.0}
            for _ in range(count):
                new: dict[float, float] = {}
                for m1, p1 in combined.items():
                    for m2, p2 in elem_dist.items():
                        k = round(m1 + m2, 6)
                        new[k] = new.get(k, 0.0) + p1 * p2
                combined = new

            # Convolve combined into main dist
            new_dist: dict[float, float] = {}
            for m1, p1 in dist.items():
                for m2, p2 in combined.items():
                    k = round(m1 + m2, 6)
                    new_dist[k] = new_dist.get(k, 0.0) + p1 * p2
            dist = new_dist

        # Bin by nominal mass offset (round each offset to nearest integer Da)
        nominal: dict[int, float] = {}
        for offset, prob in dist.items():
            nom = int(round(offset))
            nominal[nom] = nominal.get(nom, 0.0) + prob

        max_prob = max(nominal.values())
        peaks = []
        for nom_offset in sorted(nominal.keys()):
            rel_int = 100.0 * nominal[nom_offset] / max_prob
            if rel_int < 0.01:
                continue
            peaks.append({"mz": round(mono_mass + nom_offset, 4), "intensity": round(rel_int, 2)})

        return {"peaks": peaks, "exact_mass": round(mono_mass, 6), "formula": formula}
    except Exception as e:
        return {"error": str(e)}


def predict_ir(smiles):
    try:
        xtb_bin, xtb_share = _find_xtb()
        if not xtb_bin:
            return {"error": "xtb not found. Install via: conda install -c conda-forge xtb", "fallback": True}

        # SMILES → 3D conformer via RDKit
        mol = Chem.MolFromSmiles(smiles)
        if not mol:
            return {"error": "Invalid SMILES"}
        mol = Chem.AddHs(mol)
        params = AllChem.ETKDGv3()
        params.randomSeed = 0xF00D
        if AllChem.EmbedMolecule(mol, params) < 0:
            return {"error": "3D embedding failed"}
        _optimize_molecule(mol, "MMFF94s", 500)

        # Write XYZ file
        conf = mol.GetConformer(0)
        n = mol.GetNumAtoms()
        xyz_lines = [str(n), "chem-engine"]
        for i in range(n):
            pos = conf.GetAtomPosition(i)
            sym = mol.GetAtomWithIdx(i).GetSymbol()
            xyz_lines.append(f"{sym}  {pos.x:.6f}  {pos.y:.6f}  {pos.z:.6f}")
        xyz_text = "\n".join(xyz_lines) + "\n"

        with tempfile.TemporaryDirectory() as tmpdir:
            xyz_path = os.path.join(tmpdir, "mol.xyz")
            with open(xyz_path, "w") as f:
                f.write(xyz_text)

            env = os.environ.copy()
            if xtb_share:
                env["XTBPATH"] = xtb_share
            result = _run_tracked_subprocess(
                [xtb_bin, "mol.xyz", "--gfnff", "--ohess"],
                cwd=tmpdir,
                capture_output=True,
                text=True,
                timeout=120,
                env=env,
            )

            g98_path = os.path.join(tmpdir, "g98.out")
            if not os.path.isfile(g98_path):
                stderr_tail = result.stderr[-500:] if result.stderr else "(no stderr)"
                return {"error": f"xtb did not produce g98.out. stderr: {stderr_tail}"}

            with open(g98_path) as f:
                g98 = f.read()

        # Parse Gaussian-format output: "Frequencies --  f1 f2 f3" and "IR Intenens --  i1 i2 i3"
        freqs: list[float] = []
        intensities: list[float] = []
        for line in g98.splitlines():
            m = re.match(r"\s*Frequencies\s+--\s+(.*)", line)
            if m:
                freqs.extend(float(v) for v in m.group(1).split())
                continue
            m = re.match(r"\s*IR Inten\w*\s+--\s+(.*)", line)
            if m:
                intensities.extend(float(v) for v in m.group(1).split())

        peaks = []
        for freq, inten in zip(freqs, intensities, strict=False):
            if freq < 10:  # skip imaginary / translation / rotation modes
                continue
            peaks.append({"wavenumber": round(freq, 1), "intensity": round(inten, 4)})

        peaks.sort(key=lambda x: x["wavenumber"], reverse=True)
        return {"peaks": peaks}

    except subprocess.TimeoutExpired:
        return {"error": "xtb calculation timed out (>120 s)"}
    except Exception as e:
        return {"error": str(e)}


def _load_nmr_mol(smiles: str | None = None, molblock: str | None = None):
    return _parse_mol(smiles=smiles, molblock=molblock)


def _get_cached_hose_db() -> dict:
    global _CACHED_HOSE_DB
    if _CACHED_HOSE_DB is not None:
        return _CACHED_HOSE_DB
    with _HOSE_DB_LOCK:
        if _CACHED_HOSE_DB is None:
            from nmr_hose import load_hose_database

            _CACHED_HOSE_DB = load_hose_database()
    return _CACHED_HOSE_DB


def predict_nmr(smiles: str | None = None, molblock: str | None = None, solvent: str = "CDCl3") -> dict:
    mol = _load_nmr_mol(smiles=smiles, molblock=molblock)
    if not mol:
        return {"error": "Invalid structure"}
    return predict_nmr_hose_from_mol(mol, db=_get_cached_hose_db(), solvent=solvent)


# ── DFT NMR prediction (pyscf PBE0) ──────────────────────────────────────────
def _patch_pyscf_nmr() -> None:
    """Work around pyscf-properties 0.1.0 passing an unaligned blksize to
    NumInt.block_loop, which triggers an assert blksize % BLKSIZE == 0.
    Round up to the nearest BLKSIZE multiple instead.
    Fixed in pyscf-properties >0.1.0 (only version currently available on PyPI).
    """
    try:
        from pyscf.dft import numint as _numint
        from pyscf.dft.gen_grid import BLKSIZE as _BLKSIZE

        _orig = _numint.NumInt.block_loop

        def _patched(self, mol, grids, nao, deriv=0, max_memory=2000, non0tab=None, blksize=None, buf=None):
            if blksize is not None and blksize % _BLKSIZE != 0:
                blksize = ((blksize + _BLKSIZE - 1) // _BLKSIZE) * _BLKSIZE
            return _orig(self, mol, grids, nao, deriv, max_memory, non0tab, blksize, buf)

        _numint.NumInt.block_loop = _patched
    except Exception:
        pass


_patch_pyscf_nmr()

_DFT_SHIFT_PRESET = {
    "id": "delta50-b3lyp-cc-pvtz",
    "functional": "B3LYP",
    "basis": "cc-pVTZ",
    "scaling": {
        "1H": {"m": -1.0450, "b": 31.6889, "digits": 2},
        "13C": {"m": -1.0364, "b": 181.5727, "digits": 1},
    },
}


def _user_cache_dir() -> str:
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.expanduser("~/Library/Caches")
    else:
        base = os.environ.get("XDG_CACHE_HOME") or os.path.expanduser("~/.cache")
    return os.path.join(base, "chem-editor")


def _nmr_dft_cache_dir() -> str:
    return os.path.join(_user_cache_dir(), "nmr_dft")


def _nmr_dft_cache_key(mol) -> str:
    try:
        structure = Chem.MolToSmiles(mol, canonical=True)
    except Exception:
        structure = Chem.MolToMolBlock(mol)
    payload = f"{_DFT_SHIFT_PRESET['id']}|{structure}"
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _load_nmr_dft_cache(cache_key: str) -> dict | None:
    path = os.path.join(_nmr_dft_cache_dir(), f"{cache_key}.json")
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def _save_nmr_dft_cache(cache_key: str, payload: dict) -> None:
    path = os.path.join(_nmr_dft_cache_dir(), f"{cache_key}.json")
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(payload, f)
    except Exception:
        pass


# ── Hartree-Fock orbital plotting (PySCF RHF) ───────────────────────────────
_HARTREE_TO_EV = 27.211386245988
_BOHR_TO_ANGSTROM = 0.529177210903
_ORBITAL_ALLOWED_ATOMIC_NUMBERS = {1, 5, 6, 7, 8, 9, 14, 15, 16, 17, 35, 53}
_ORBITAL_MAX_ATOMS = 96
_ORBITAL_MAX_HEAVY_ATOMS = 40
_ORBITAL_DEFAULT_ISOVALUE = 0.045
_ORBITAL_CACHE_VERSION = 2
_ORBITAL_DEFAULT_SPACING_BOHR = 0.6
_ORBITAL_PADDING_BOHR = 4.0
_ORBITAL_MAX_GRID_POINTS = 160_000
_ORBITAL_CHUNK_POINTS = 24_000
_HF_OPTIMIZATION_TIMEOUT_S = 45.0
_HF_OPTIMIZATION_MAX_STEPS = 20
_HF_OPTIMIZATION_GRADIENT_TOL = 3e-3
_CUBE_VERTEX_OFFSETS = (
    (0, 0, 0),
    (1, 0, 0),
    (1, 1, 0),
    (0, 1, 0),
    (0, 0, 1),
    (1, 0, 1),
    (1, 1, 1),
    (0, 1, 1),
)
_TETRAHEDRA = (
    (0, 5, 1, 6),
    (0, 1, 2, 6),
    (0, 2, 3, 6),
    (0, 3, 7, 6),
    (0, 7, 4, 6),
    (0, 4, 5, 6),
)
_TETRA_EDGES = ((0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3))


def _orbital_cache_dir() -> str:
    return os.path.join(_user_cache_dir(), "hf_orbitals")


def _load_orbital_cache(cache_key: str) -> dict | None:
    path = os.path.join(_orbital_cache_dir(), f"{cache_key}.json")
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return None


def _save_orbital_cache(cache_key: str, payload: dict) -> None:
    path = os.path.join(_orbital_cache_dir(), f"{cache_key}.json")
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w") as f:
            json.dump(payload, f)
    except Exception:
        pass


def _orbital_structure_key(smiles: str | None, molblock: str | None, atoms: list[dict]) -> str:
    if molblock and molblock.strip():
        return molblock.strip()
    if smiles and smiles.strip():
        return smiles.strip()
    return json.dumps(atoms, separators=(",", ":"), sort_keys=True)


def _orbital_cache_key(structure_key: str, atoms: list[dict], basis: str, total_charge: int = 0) -> str:
    atom_payload = [
        (
            atom.get("element", ""),
            round(float(atom.get("x", 0.0)), 5),
            round(float(atom.get("y", 0.0)), 5),
            round(float(atom.get("z", 0.0)), 5),
        )
        for atom in atoms
    ]
    payload = {
        "version": _ORBITAL_CACHE_VERSION,
        "engine": "hartree-fock",
        "basis": basis,
        "charge": int(total_charge),
        "structure_key": structure_key,
        "atoms": atom_payload,
    }
    return hashlib.sha256(json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")).hexdigest()


def _parse_v2000_molblock(molblock: str | None) -> dict | None:
    if not molblock or not molblock.strip():
        return None
    lines = molblock.splitlines()
    if len(lines) < 4:
        return None
    counts_line = lines[3]
    if len(counts_line) < 6:
        return None
    try:
        atom_count = int(counts_line[0:3].strip())
        bond_count = int(counts_line[3:6].strip())
    except (TypeError, ValueError):
        return None
    if atom_count < 0 or bond_count < 0:
        return None

    atoms = []
    for index in range(atom_count):
        line_index = 4 + index
        if line_index >= len(lines):
            return None
        line = lines[line_index]
        if len(line) < 34:
            return None
        try:
            atom_map_num = int(line[60:63].strip()) if len(line) >= 63 and line[60:63].strip() else 0
        except ValueError:
            atom_map_num = 0
        atoms.append(
            {
                "element": line[31:34].strip() or "C",
                "atomMapNum": atom_map_num or None,
                "charge": 0,
            }
        )

    bonds = []
    for index in range(bond_count):
        line_index = 4 + atom_count + index
        if line_index >= len(lines):
            return None
        line = lines[line_index]
        if len(line) < 9:
            return None
        try:
            a1 = int(line[0:3].strip()) - 1
            a2 = int(line[3:6].strip()) - 1
            order = float(int(line[6:9].strip() or "1"))
        except (TypeError, ValueError):
            continue
        if 0 <= a1 < atom_count and 0 <= a2 < atom_count:
            bonds.append({"a1": a1, "a2": a2, "order": order})

    metadata_start = 4 + atom_count + bond_count
    for line in lines[metadata_start:]:
        if line.startswith("M  CHG"):
            try:
                count = int(line[6:9].strip())
            except (TypeError, ValueError):
                continue
            for index in range(count):
                cursor = 10 + index * 8
                try:
                    atom_index = int(line[cursor : cursor + 4].strip()) - 1
                    charge = int(line[cursor + 4 : cursor + 8].strip())
                except (TypeError, ValueError):
                    continue
                if 0 <= atom_index < len(atoms):
                    atoms[atom_index]["charge"] = charge
        if line.startswith("M  END"):
            break

    return {
        "atoms": atoms,
        "bonds": bonds,
        "total_charge": int(sum(atom["charge"] for atom in atoms)),
    }


def _resolve_orbital_total_charge(smiles: str | None, molblock: str | None, explicit_charge=None) -> int:
    if explicit_charge is not None:
        try:
            return int(explicit_charge)
        except (TypeError, ValueError) as exc:
            raise ValueError("Invalid formal charge") from exc

    reference_mol = _parse_mol(smiles=smiles, molblock=molblock)
    if reference_mol is not None:
        return int(Chem.GetFormalCharge(reference_mol))

    parsed_molblock = _parse_v2000_molblock(molblock)
    if parsed_molblock is not None:
        return int(parsed_molblock["total_charge"])

    if smiles and smiles.strip():
        fallback_smiles = _parse_mol(smiles=smiles)
        if fallback_smiles is not None:
            return int(Chem.GetFormalCharge(fallback_smiles))

    return 0


def _validate_orbital_structure(atoms: list[dict], total_charge: int) -> tuple[int, int]:
    total_charge = int(total_charge)
    total_electrons = 0
    heavy_atoms = 0
    for atom in atoms:
        atomic_num = Chem.GetPeriodicTable().GetAtomicNumber(atom["element"])
        if atomic_num not in _ORBITAL_ALLOWED_ATOMIC_NUMBERS:
            raise ValueError(f"Unsupported element for HF orbital plotting: {atom['element']}")
        total_electrons += atomic_num
        if atomic_num > 1:
            heavy_atoms += 1
    total_electrons -= total_charge
    if total_electrons % 2 != 0:
        raise ValueError("Open-shell / odd-electron systems are not supported in v1")
    if len(atoms) > _ORBITAL_MAX_ATOMS or heavy_atoms > _ORBITAL_MAX_HEAVY_ATOMS:
        raise ValueError("Structure is too large for interactive HF orbital plotting on a laptop")
    return total_charge, total_electrons


def _match_orbital_reference_mol(smiles: str | None, molblock: str | None, atom_count: int):
    base = _parse_mol(smiles=smiles, molblock=molblock)
    if not base:
        raise ValueError("Invalid structure")
    candidates = [base]
    try:
        candidates.append(Chem.AddHs(Chem.Mol(base)))
    except Exception:
        pass
    for candidate in candidates:
        if candidate.GetNumAtoms() == atom_count:
            return candidate
    hydrated = candidates[-1]
    if hydrated.GetNumAtoms() != atom_count:
        raise ValueError("Orbital geometry does not match the current structure")
    return hydrated


def _frontier_orbital_indices(mf) -> list[tuple[int, str]]:
    import numpy as np

    mo_occ = np.asarray(mf.mo_occ)
    nocc = int(np.count_nonzero(mo_occ > 1e-8))
    if nocc <= 0 or nocc >= len(mo_occ):
        raise ValueError("Could not determine a frontier orbital window")

    homo = nocc - 1
    lumo = nocc
    candidates = [
        (homo - 2, "HOMO-2"),
        (homo - 1, "HOMO-1"),
        (homo, "HOMO"),
        (lumo, "LUMO"),
        (lumo + 1, "LUMO+1"),
        (lumo + 2, "LUMO+2"),
    ]
    result: list[tuple[int, str]] = []
    seen: set[int] = set()
    for index, label in candidates:
        if 0 <= index < len(mo_occ) and index not in seen:
            seen.add(index)
            result.append((index, label))
    if not result:
        raise ValueError("No frontier orbitals are available for plotting")
    return result


def _orbital_grid(atom_coords_bohr):
    import numpy as np

    origin = atom_coords_bohr.min(axis=0) - _ORBITAL_PADDING_BOHR
    upper = atom_coords_bohr.max(axis=0) + _ORBITAL_PADDING_BOHR
    spacing = _ORBITAL_DEFAULT_SPACING_BOHR
    warning = None

    while True:
        dims = np.maximum(2, np.ceil((upper - origin) / spacing).astype(int) + 1)
        grid_points = int(np.prod(dims))
        if grid_points <= _ORBITAL_MAX_GRID_POINTS:
            break
        spacing *= 1.12
        warning = "Grid resolution was reduced to keep the HF orbital plot laptop-friendly"
        if spacing > 1.6:
            raise ValueError("Orbital plotting grid would be too large for interactive use")

    xs = origin[0] + np.arange(dims[0]) * spacing
    ys = origin[1] + np.arange(dims[1]) * spacing
    zs = origin[2] + np.arange(dims[2]) * spacing
    mesh = np.meshgrid(xs, ys, zs, indexing="ij")
    coords = np.stack(mesh, axis=-1).reshape(-1, 3)
    return origin, float(spacing), tuple(int(v) for v in dims), coords, warning


def _serialize_orbital_grid(origin, spacing: float, dims) -> dict:
    return {
        "origin": [float(value * _BOHR_TO_ANGSTROM) for value in origin],
        "spacing": float(spacing * _BOHR_TO_ANGSTROM),
        "dims": [int(value) for value in dims],
    }


def _serialize_orbital_field(key: str, field) -> dict:
    import numpy as np

    packed = np.asarray(field, dtype=np.float32).reshape(-1)
    return {
        "key": key,
        "values": np.round(packed, 6).tolist(),
        "minValue": float(np.min(packed)),
        "maxValue": float(np.max(packed)),
    }


def _build_atom_spec(atoms: list[dict]) -> list[str]:
    return [f"{atom['element']} {float(atom['x']):.8f} {float(atom['y']):.8f} {float(atom['z']):.8f}" for atom in atoms]


def _build_reference_bonds(reference_mol) -> list[dict]:
    bonds = []
    for bond in reference_mol.GetBonds():
        bonds.append(
            {
                "a1": int(bond.GetBeginAtomIdx()),
                "a2": int(bond.GetEndAtomIdx()),
                "order": float(bond.GetBondTypeAsDouble()),
            }
        )
    return bonds


def _build_reference_atoms(reference_mol, coords_angstrom) -> list[dict]:
    atoms = []
    for index, atom in enumerate(reference_mol.GetAtoms()):
        x, y, z = coords_angstrom[index]
        atoms.append(
            {
                "element": atom.GetSymbol(),
                "atomMapNum": atom.GetAtomMapNum() or None,
                "x": float(x),
                "y": float(y),
                "z": float(z),
            }
        )
    return atoms


def _build_geometry_atoms(atoms: list[dict], coords_angstrom) -> list[dict]:
    result = []
    for index, atom in enumerate(atoms):
        x, y, z = coords_angstrom[index]
        atom_map_num = atom.get("atomMapNum")
        result.append(
            {
                "element": atom["element"],
                "atomMapNum": int(atom_map_num) if atom_map_num not in (None, "") else None,
                "x": float(x),
                "y": float(y),
                "z": float(z),
            }
        )
    return result


def _normalize_geometry_bonds(bonds: list[dict] | None, atom_count: int) -> list[dict]:
    normalized = []
    for bond in bonds or []:
        try:
            a1 = int(bond.get("a1"))
            a2 = int(bond.get("a2"))
            order = float(bond.get("order", 1.0))
        except (TypeError, ValueError, AttributeError):
            continue
        if 0 <= a1 < atom_count and 0 <= a2 < atom_count:
            normalized.append({"a1": a1, "a2": a2, "order": order})
    return normalized


def _run_rhf(atom_spec: list[str], basis: str, total_charge: int, dm0=None):
    from pyscf import gto, scf

    pm = gto.Mole()
    pm.atom = "\n".join(atom_spec)
    pm.unit = "Angstrom"
    pm.basis = basis
    pm.charge = total_charge
    pm.spin = 0
    pm.max_memory = 1500
    pm.verbose = 0
    pm.build()

    mf = scf.RHF(pm)
    mf.max_cycle = 64
    mf.conv_tol = 1e-8
    mf.verbose = 0
    if dm0 is None:
        mf.kernel()
    else:
        mf.kernel(dm0=dm0)
        if not mf.converged:
            mf = scf.RHF(pm)
            mf.max_cycle = 64
            mf.conv_tol = 1e-8
            mf.verbose = 0
            mf.kernel()
    return pm, mf


def _interpolate_isopoint(p1, v1: float, p2, v2: float, iso: float):
    if abs(iso - v1) <= 1e-12:
        return p1
    if abs(iso - v2) <= 1e-12:
        return p2
    denom = v2 - v1
    if abs(denom) <= 1e-12:
        return p1
    t = max(0.0, min(1.0, (iso - v1) / denom))
    return p1 + (p2 - p1) * t


def _append_isopoly(intersections, desired, positions_out: list[float]) -> None:
    import numpy as np

    if len(intersections) < 3:
        return
    centroid = sum(intersections) / len(intersections)
    normal = desired
    if np.linalg.norm(normal) <= 1e-8:
        normal = np.cross(intersections[1] - intersections[0], intersections[-1] - intersections[0])
    if np.linalg.norm(normal) <= 1e-8:
        return
    normal = normal / np.linalg.norm(normal)
    reference = intersections[0] - centroid
    if np.linalg.norm(reference) <= 1e-8 and len(intersections) > 1:
        reference = intersections[1] - centroid
    if np.linalg.norm(reference) <= 1e-8:
        return
    reference = reference / np.linalg.norm(reference)
    tangent = np.cross(normal, reference)
    if np.linalg.norm(tangent) <= 1e-8:
        return
    tangent = tangent / np.linalg.norm(tangent)

    ordered = sorted(
        intersections,
        key=lambda point: math.atan2(np.dot(point - centroid, tangent), np.dot(point - centroid, reference)),
    )
    if len(ordered) >= 3:
        face_normal = np.cross(ordered[1] - ordered[0], ordered[2] - ordered[0])
        if np.dot(face_normal, desired) < 0:
            ordered = [ordered[0], *reversed(ordered[1:])]

    for index in range(1, len(ordered) - 1):
        tri = (ordered[0], ordered[index], ordered[index + 1])
        for point in tri:
            positions_out.extend(
                (
                    float(point[0] * _BOHR_TO_ANGSTROM),
                    float(point[1] * _BOHR_TO_ANGSTROM),
                    float(point[2] * _BOHR_TO_ANGSTROM),
                )
            )


def _polygonize_tetrahedron(positions, values, iso: float, positions_out: list[float]) -> None:
    inside = [value >= iso for value in values]
    inside_count = sum(inside)
    if inside_count == 0 or inside_count == 4:
        return

    intersections = []
    for left, right in _TETRA_EDGES:
        if inside[left] == inside[right]:
            continue
        intersections.append(_interpolate_isopoint(positions[left], values[left], positions[right], values[right], iso))

    if len(intersections) < 3:
        return

    import numpy as np

    inside_centroid = sum(positions[index] for index, flag in enumerate(inside) if flag) / inside_count
    outside_count = 4 - inside_count
    outside_centroid = sum(positions[index] for index, flag in enumerate(inside) if not flag) / max(1, outside_count)
    desired = outside_centroid - inside_centroid
    if np.linalg.norm(desired) <= 1e-8:
        desired = np.array([0.0, 0.0, 1.0])
    _append_isopoly(intersections, desired, positions_out)


def _isosurface_positions(field, origin, spacing: float, iso: float) -> list[float]:
    import numpy as np

    nx, ny, nz = field.shape
    positions_out: list[float] = []
    cube_offsets = [np.array(offset, dtype=float) * spacing for offset in _CUBE_VERTEX_OFFSETS]

    for ix in range(nx - 1):
        for iy in range(ny - 1):
            for iz in range(nz - 1):
                cube_values = (
                    float(field[ix, iy, iz]),
                    float(field[ix + 1, iy, iz]),
                    float(field[ix + 1, iy + 1, iz]),
                    float(field[ix, iy + 1, iz]),
                    float(field[ix, iy, iz + 1]),
                    float(field[ix + 1, iy, iz + 1]),
                    float(field[ix + 1, iy + 1, iz + 1]),
                    float(field[ix, iy + 1, iz + 1]),
                )
                if max(cube_values) < iso or min(cube_values) >= iso:
                    continue
                base = origin + np.array((ix * spacing, iy * spacing, iz * spacing), dtype=float)
                cube_positions = [base + offset for offset in cube_offsets]
                for a, b, c, d in _TETRAHEDRA:
                    tetra_positions = (cube_positions[a], cube_positions[b], cube_positions[c], cube_positions[d])
                    tetra_values = (cube_values[a], cube_values[b], cube_values[c], cube_values[d])
                    _polygonize_tetrahedron(tetra_positions, tetra_values, iso, positions_out)

    return positions_out


def calculate_orbitals(
    smiles: str | None = None,
    molblock: str | None = None,
    atoms: list[dict] | None = None,
    basis: str = "3-21G",
    isovalue: float = _ORBITAL_DEFAULT_ISOVALUE,
    charge=None,
) -> dict:
    try:
        if importlib.util.find_spec("pyscf") is None:
            return {"error": "pyscf not installed", "fallback": True}
        if not atoms:
            return {"error": "No 3D geometry is available for orbital plotting"}

        import numpy as np
        from pyscf.dft import numint

        basis = basis or "3-21G"
        isovalue = max(0.01, min(float(isovalue), 0.12))
        total_charge = _resolve_orbital_total_charge(smiles, molblock, charge)
        total_charge, _total_electrons = _validate_orbital_structure(atoms, total_charge)

        structure_key = _orbital_structure_key(smiles, molblock, atoms)
        cache_key = _orbital_cache_key(structure_key, atoms, basis, total_charge)
        cached = _load_orbital_cache(cache_key)
        if cached is not None:
            return cached

        atom_spec = _build_atom_spec(atoms)
        pm, mf = _run_rhf(atom_spec, basis, total_charge)
        if not mf.converged:
            return {"error": "HF calculation did not converge"}

        orbital_entries = _frontier_orbital_indices(mf)
        selected_indices = [index for index, _label in orbital_entries]
        mo_coeff = np.asarray(mf.mo_coeff)[:, selected_indices]

        atom_coords_bohr = pm.atom_coords(unit="Bohr")
        origin, spacing, dims, grid_coords_bohr, warning = _orbital_grid(atom_coords_bohr)
        total_points = grid_coords_bohr.shape[0]
        field_buffers = {index: np.empty(total_points, dtype=float) for index in selected_indices}
        for start in range(0, total_points, _ORBITAL_CHUNK_POINTS):
            end = min(total_points, start + _ORBITAL_CHUNK_POINTS)
            ao = numint.eval_ao(pm, grid_coords_bohr[start:end])
            mo_values = ao @ mo_coeff
            for col, mo_index in enumerate(selected_indices):
                field_buffers[mo_index][start:end] = mo_values[:, col]

        mo_occ = np.asarray(mf.mo_occ)
        mo_energy = np.asarray(mf.mo_energy)
        orbitals = []
        fields: dict[str, dict] = {}
        warnings = [warning] if warning else []

        for mo_index, label in orbital_entries:
            field = field_buffers[mo_index].reshape(dims)
            key = f"mo-{mo_index}"
            fields[key] = _serialize_orbital_field(key, field)
            orbitals.append(
                {
                    "key": key,
                    "label": label,
                    "moIndex": int(mo_index),
                    "occupation": float(mo_occ[mo_index]),
                    "energyHartree": float(mo_energy[mo_index]),
                    "energyEv": float(mo_energy[mo_index] * _HARTREE_TO_EV),
                }
            )

        payload = {
            "basis": basis,
            "orbitals": orbitals,
            "grid": _serialize_orbital_grid(origin, spacing, dims),
            "fields": fields,
            "warnings": warnings,
        }
        _save_orbital_cache(cache_key, payload)
        return payload

    except ImportError:
        return {"error": "pyscf is unavailable in this environment", "fallback": True}
    except ValueError as exc:
        return {"error": str(exc)}
    except Exception as exc:
        return {"error": str(exc)}


def optimize_hartree_fock_geometry(
    smiles: str | None = None,
    molblock: str | None = None,
    atoms: list[dict] | None = None,
    basis: str = "3-21G",
    bonds: list[dict] | None = None,
    charge=None,
) -> dict:
    try:
        if importlib.util.find_spec("pyscf") is None:
            return {"error": "pyscf not installed", "fallback": True}
        if importlib.util.find_spec("scipy.optimize") is None:
            return {"error": "scipy is unavailable in this environment", "fallback": True}
        if not atoms:
            return {"error": "No 3D geometry is available for HF optimization"}

        import numpy as np
        from pyscf import grad
        from scipy.optimize import minimize

        basis = basis or "3-21G"
        total_charge = _resolve_orbital_total_charge(smiles, molblock, charge)
        total_charge, _total_electrons = _validate_orbital_structure(atoms, total_charge)
        atom_symbols = [atom["element"] for atom in atoms]
        initial_coords = np.asarray(
            [[float(atom["x"]), float(atom["y"]), float(atom["z"])] for atom in atoms],
            dtype=float,
        )
        start_time = time.monotonic()
        state: dict[str, object] = {
            "dm0": None,
            "best_energy": None,
            "best_coords": np.array(initial_coords, copy=True),
            "best_grad_norm": float("inf"),
        }

        def evaluate(flat_coords):
            if time.monotonic() - start_time > _HF_OPTIMIZATION_TIMEOUT_S:
                raise TimeoutError("HF geometry optimization timed out")
            coords = np.asarray(flat_coords, dtype=float).reshape((-1, 3))
            atom_spec = [
                f"{symbol} {coords[index, 0]:.8f} {coords[index, 1]:.8f} {coords[index, 2]:.8f}"
                for index, symbol in enumerate(atom_symbols)
            ]
            pm, mf = _run_rhf(atom_spec, basis, total_charge, dm0=state["dm0"])
            if not mf.converged:
                raise ValueError("HF geometry optimization did not converge")
            gradient = np.asarray(grad.RHF(mf).kernel(), dtype=float).reshape(-1)
            energy = float(mf.e_tot)
            grad_norm = float(np.linalg.norm(gradient))
            state["dm0"] = mf.make_rdm1()
            if state["best_energy"] is None or energy < state["best_energy"]:
                state["best_energy"] = energy
                state["best_coords"] = np.array(coords, copy=True)
                state["best_grad_norm"] = grad_norm
            return energy, gradient

        result = minimize(
            evaluate,
            initial_coords.reshape(-1),
            method="L-BFGS-B",
            jac=True,
            options={
                "maxiter": _HF_OPTIMIZATION_MAX_STEPS,
                "gtol": _HF_OPTIMIZATION_GRADIENT_TOL,
                "ftol": 1e-7,
                "maxls": 20,
            },
        )

        best_coords = np.asarray(state["best_coords"], dtype=float)
        best_energy = state["best_energy"]
        if best_energy is None:
            return {"error": "HF geometry optimization did not produce a valid geometry"}

        warnings = []
        if not result.success:
            message = str(result.message).strip()
            if message:
                warnings.append(f"HF optimization stopped early: {message}")
        optimized_bonds = _normalize_geometry_bonds(bonds, len(atoms))
        if not optimized_bonds:
            parsed_molblock = _parse_v2000_molblock(molblock)
            if parsed_molblock is not None:
                optimized_bonds = parsed_molblock["bonds"]
        return {
            "basis": basis,
            "energyHartree": float(best_energy),
            "atoms": _build_geometry_atoms(atoms, best_coords),
            "bonds": optimized_bonds,
            "warnings": warnings,
        }

    except ImportError:
        return {"error": "pyscf is unavailable in this environment", "fallback": True}
    except TimeoutError as exc:
        return {"error": str(exc)}
    except ValueError as exc:
        return {"error": str(exc)}
    except Exception as exc:
        return {"error": str(exc)}


def _compute_pyscf_shieldings(mf):
    """Run PySCF NMR using whichever API is available in the current environment."""
    try:
        from pyscf.prop.nmr import rks as nmr_rks

        return nmr_rks.NMR(mf).kernel()
    except ImportError:
        pass

    try:
        return mf.NMR().kernel()
    except AttributeError as e:
        raise ImportError(f"pyscf NMR support is unavailable in this environment: {e}") from e


def _apply_linear_scaling(nucleus: str, sigma_iso: float) -> float:
    scaling = _DFT_SHIFT_PRESET["scaling"][nucleus]
    shift = (scaling["b"] - sigma_iso) / (-scaling["m"])
    return round(shift, scaling["digits"])


def _xtb_optimize_mol(mol) -> bool:
    """Refine mol's conformer 0 in-place with GFN2-xTB. Returns True on success."""
    from rdkit.Geometry import Point3D

    optimized = _xtb_optimize_conformer(mol, 0)
    if optimized is None:
        return False

    conf = mol.GetConformer(0)
    for i, atom in enumerate(optimized["atoms"]):
        conf.SetAtomPosition(i, Point3D(atom["x"], atom["y"], atom["z"]))
    return True


def _xtb_optimize_conformer(mol, conf_id=0):
    xtb_bin, xtb_share = _find_xtb()
    if not xtb_bin:
        return None

    conf = mol.GetConformer(conf_id)
    n = mol.GetNumAtoms()
    xyz_lines = [str(n), "mol"]
    for i in range(n):
        pos = conf.GetAtomPosition(i)
        sym = mol.GetAtomWithIdx(i).GetSymbol()
        xyz_lines.append(f"{sym}  {pos.x:.6f}  {pos.y:.6f}  {pos.z:.6f}")
    xyz_text = "\n".join(xyz_lines) + "\n"

    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, "mol.xyz"), "w") as f:
            f.write(xyz_text)
        env = os.environ.copy()
        if xtb_share:
            env["XTBPATH"] = xtb_share
        result = _run_tracked_subprocess(
            [xtb_bin, "mol.xyz", "--opt", "--gfn", "2"],
            cwd=tmpdir,
            capture_output=True,
            text=True,
            timeout=120,
            env=env,
        )
        opt_path = os.path.join(tmpdir, "xtbopt.xyz")
        if result.returncode != 0 or not os.path.isfile(opt_path):
            return None

        with open(opt_path) as f:
            lines = f.readlines()

    atoms = []
    for i in range(n):
        parts = lines[2 + i].split()
        atoms.append(
            {
                "element": parts[0],
                "x": float(parts[1]),
                "y": float(parts[2]),
                "z": float(parts[3]),
            }
        )

    output_text = "\n".join(part for part in (result.stdout, result.stderr) if part)
    energy_match = re.search(r"TOTAL ENERGY\s+(-?\d+\.\d+)", output_text)
    energy_hartree = float(energy_match.group(1)) if energy_match else None
    return {"atoms": atoms, "energy_hartree": energy_hartree}


def predict_nmr_dft(
    smiles: str | None = None,
    molblock: str | None = None,
    include_j: bool = False,
    progress_callback=None,
) -> dict:
    """DFT-level NMR chemical shifts via a fixed B3LYP/cc-pVTZ shielding preset.

    Geometry: MMFF94s → GFN2-xTB refinement (if xtb available).
    Shieldings are converted to shifts using DELTA50 linear scaling coefficients.
    Returns the same {signals_1h, signals_13c} format as predict_nmr.
    Returns {"error": ..., "fallback": True} if pyscf is not installed.
    """
    try:
        import importlib.util

        if importlib.util.find_spec("pyscf") is None:
            return {"error": "pyscf not installed", "fallback": True}

        from collections import defaultdict

        from pyscf import dft, gto

        mol = _load_nmr_mol(smiles=smiles, molblock=molblock)
        if not mol:
            return {"error": "Invalid structure"}
        cache_key = _nmr_dft_cache_key(mol)
        cached = _load_nmr_dft_cache(cache_key)
        if cached is not None:
            if progress_callback is not None:
                progress_callback("finishing", "Finishing spectrum")
            result = dict(cached)
            result.setdefault("dft_geometry_refinement", "xtb")
            if include_j:
                result["signals_1h"] = apply_topology_j_to_signals(mol, result.get("signals_1h", []))
            return result

        mol = Chem.AddHs(mol)
        params = AllChem.ETKDGv3()
        params.randomSeed = 0xF00D
        if progress_callback is not None:
            progress_callback("embedding", "Embedding 3D geometry")
        if AllChem.EmbedMolecule(mol, params) < 0:
            return {"error": "3D embedding failed"}
        if progress_callback is not None:
            progress_callback("optimizing", "Optimizing conformer")
        _optimize_molecule(mol, "MMFF94s", 500)

        xtb_refined = _xtb_optimize_mol(mol)

        conf = mol.GetConformer(0)
        atom_spec = []
        for i in range(mol.GetNumAtoms()):
            pos = conf.GetAtomPosition(i)
            sym = mol.GetAtomWithIdx(i).GetSymbol()
            atom_spec.append(f"{sym} {pos.x:.6f} {pos.y:.6f} {pos.z:.6f}")

        pm = gto.Mole()
        pm.atom = "\n".join(atom_spec)
        pm.basis = _DFT_SHIFT_PRESET["basis"]
        pm.verbose = 0
        pm.build()

        mf = dft.RKS(pm)
        mf.xc = _DFT_SHIFT_PRESET["functional"]
        mf.verbose = 0
        if progress_callback is not None:
            progress_callback("shielding", "Running shielding calculation")
        mf.kernel()

        try:
            shieldings = _compute_pyscf_shieldings(mf)
        except ImportError as e:
            return {"error": str(e), "fallback": True}

        if progress_callback is not None:
            progress_callback("scaling", "Applying DELTA50 linear scaling")
        signals_13c = []
        h_by_heavy: dict = defaultdict(list)
        for i in range(mol.GetNumAtoms()):
            atom = mol.GetAtomWithIdx(i)
            sigma_iso = float(shieldings[i].trace() / 3)
            if atom.GetAtomicNum() == 6:
                shift = _apply_linear_scaling("13C", sigma_iso)
                signals_13c.append(
                    {
                        "atom_idxs": [i],
                        "center_ppm": shift,
                        "integral": 1,
                        "multiplicity": "s",
                        "couplings_hz": [],
                        "confidence": 999,
                        "source": "dft-delta50",
                        "transitions": [{"ppm": shift, "intensity": 1.0, "label": None}],
                    }
                )
            elif atom.GetAtomicNum() == 1:
                shift = _apply_linear_scaling("1H", sigma_iso)
                nbrs = [b.GetOtherAtomIdx(i) for b in atom.GetBonds()]
                heavy_idx = nbrs[0] if nbrs else -1
                h_by_heavy[heavy_idx].append(shift)

        signals_1h = []
        for heavy_idx, shifts in h_by_heavy.items():
            center = round(sum(shifts) / len(shifts), 2)
            signals_1h.append(
                {
                    "atom_idxs": [heavy_idx],
                    "center_ppm": center,
                    "integral": len(shifts),
                    "multiplicity": "m",
                    "couplings_hz": [],
                    "confidence": 999,
                    "source": "dft-delta50",
                    "transitions": [{"ppm": center, "intensity": 1.0, "label": None}],
                }
            )

        signals_1h.sort(key=lambda signal: signal["center_ppm"], reverse=True)
        signals_13c.sort(key=lambda signal: signal["center_ppm"], reverse=True)
        if progress_callback is not None:
            progress_callback("finishing", "Finishing spectrum")
        base_result = {
            "signals_1h": signals_1h,
            "signals_13c": signals_13c,
            "dft_geometry_refinement": "xtb" if xtb_refined else "mmff94s",
        }
        _save_nmr_dft_cache(cache_key, base_result)
        if include_j:
            return {
                "signals_1h": apply_topology_j_to_signals(_load_nmr_mol(smiles=smiles, molblock=molblock), signals_1h),
                "signals_13c": signals_13c,
                "dft_geometry_refinement": base_result["dft_geometry_refinement"],
            }
        return base_result

    except Exception as e:
        return {"error": str(e)}


def _server_predict_nmr(request: dict) -> dict:
    smiles = request.get("smiles")
    molblock = request.get("molblock")
    method = request.get("method", "hose")
    solvent = request.get("solvent", "CDCl3")
    include_j = bool(request.get("include_j", False))
    request_id = request.get("request_id")

    def emit_progress(stage: str, label: str) -> None:
        if request_id is None:
            return
        print(
            json.dumps(
                {
                    "type": "progress",
                    "request_id": request_id,
                    "stage": stage,
                    "label": label,
                }
            ),
            flush=True,
        )

    if method == "dft":
        return predict_nmr_dft(smiles, molblock=molblock, include_j=include_j, progress_callback=emit_progress)
    return predict_nmr(smiles, molblock=molblock, solvent=solvent)


def run_server() -> int:
    parent_pid = os.getppid()
    watcher = threading.Thread(target=_monitor_parent_process, args=(parent_pid,), daemon=True)
    watcher.start()

    # Start opening the HOSE DB immediately so the first visible NMR prediction
    # can often hit a warm cache instead of paying the initial DB open cost.
    threading.Thread(target=_get_cached_hose_db, daemon=True).start()

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            request = json.loads(line)
            command = request.get("command")
            if command == "shutdown":
                print(json.dumps({"type": "result", "payload": {"ok": True}}), flush=True)
                return 0
            if command == "warmup_nmr":
                _get_cached_hose_db()
                print(json.dumps({"type": "result", "payload": {"ok": True}}), flush=True)
                continue
            if command != "predict_nmr":
                raise ValueError(f"Unsupported server command: {command}")
            response = {
                "type": "result",
                "request_id": request.get("request_id"),
                "payload": _server_predict_nmr(request),
            }
        except Exception as exc:
            response = {"type": "result", "payload": {"error": str(exc)}}
        print(json.dumps(response), flush=True)

    _terminate_active_subprocesses()
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--server", action="store_true")
    subparsers = parser.add_subparsers(dest="command")

    # Conformer command
    conf_parser = subparsers.add_parser("conformer")
    conf_parser.add_argument("smiles", nargs="?")
    conf_parser.add_argument("--molblock", default=None)
    conf_parser.add_argument("--ff", default="MMFF94s")
    conf_parser.add_argument("--max", type=int, default=10)

    # Parse command
    parse_parser = subparsers.add_parser("parse")
    parse_parser.add_argument("format")
    parse_parser.add_argument("--file", help="Path to file or - for stdin", default="-")

    # Export command
    export_parser = subparsers.add_parser("export")
    export_parser.add_argument("format")
    export_parser.add_argument("--molblock", help="The molblock to export", default="-")
    export_parser.add_argument("--arrows", help="Arrow data as JSON for RXN split", default=None)

    # XYZ conformer command
    subparsers.add_parser("xyz-conformer")

    # Properties command
    props_parser = subparsers.add_parser("properties")
    props_parser.add_argument("smiles")

    orbital_parser = subparsers.add_parser("orbitals")
    orbital_parser.add_argument("--input", default="-")

    optimize_hf_parser = subparsers.add_parser("optimize-hf")
    optimize_hf_parser.add_argument("--input", default="-")

    # MS prediction command
    ms_parser = subparsers.add_parser("ms")
    ms_parser.add_argument("smiles")

    # IR prediction command
    ir_parser = subparsers.add_parser("ir")
    ir_parser.add_argument("smiles")

    # NMR prediction command
    nmr_parser = subparsers.add_parser("nmr")
    nmr_parser.add_argument("smiles", nargs="?")
    nmr_parser.add_argument("--molblock", default=None)
    nmr_parser.add_argument("--method", choices=["hose", "dft"], default="hose")
    nmr_parser.add_argument("--solvent", default="CDCl3")
    nmr_parser.add_argument("--include-j", action="store_true")

    args = parser.parse_args()

    if args.server:
        raise SystemExit(run_server())

    if args.command == "conformer":
        molblock = sys.stdin.read() if args.molblock == "-" else args.molblock
        print(json.dumps(generate_conformers(args.smiles, molblock=molblock, force_field=args.ff, max_output=args.max)))
    elif args.command == "parse":
        content = sys.stdin.read() if args.file == "-" else open(args.file).read()
        print(json.dumps(parse_file(content, args.format)))
    elif args.command == "export":
        molblock = sys.stdin.read() if args.molblock == "-" else args.molblock
        print(json.dumps(export_file(molblock, args.format, arrows_json=args.arrows)))
    elif args.command == "xyz-conformer":
        content = sys.stdin.read()
        print(json.dumps(xyz_to_conformer(content)))
    elif args.command == "properties":
        print(json.dumps(compute_properties(args.smiles)))
    elif args.command == "orbitals":
        payload = json.loads(sys.stdin.read() if args.input == "-" else open(args.input).read())
        print(
            json.dumps(
                calculate_orbitals(
                    payload.get("smiles"),
                    molblock=payload.get("molblock"),
                    atoms=payload.get("atoms"),
                    basis=payload.get("basis", "3-21G"),
                    isovalue=payload.get("isovalue", _ORBITAL_DEFAULT_ISOVALUE),
                    charge=payload.get("charge"),
                )
            )
        )
    elif args.command == "optimize-hf":
        payload = json.loads(sys.stdin.read() if args.input == "-" else open(args.input).read())
        print(
            json.dumps(
                optimize_hartree_fock_geometry(
                    payload.get("smiles"),
                    molblock=payload.get("molblock"),
                    atoms=payload.get("atoms"),
                    basis=payload.get("basis", "3-21G"),
                    bonds=payload.get("bonds"),
                    charge=payload.get("charge"),
                )
            )
        )
    elif args.command == "ms":
        print(json.dumps(predict_ms(args.smiles)))
    elif args.command == "ir":
        print(json.dumps(predict_ir(args.smiles)))
    elif args.command == "nmr":
        if args.method == "dft":
            print(json.dumps(predict_nmr_dft(args.smiles, molblock=args.molblock, include_j=args.include_j)))
        else:
            print(json.dumps(predict_nmr(args.smiles, molblock=args.molblock, solvent=args.solvent)))
    else:
        parser.print_help()
