"""Precompute TMS reference shieldings for DFT NMR predictions.

Geometry: GFN2-xTB (same protocol as predict_nmr_dft in chem-engine.py)
Method:   PBE0 / {pcSseg-1, 6-31G*, def2-SVP}
Output:   Constants ready to paste into chem-engine.py

Usage (from repo root):
    uv run --project src-tauri python development/precompute_nmr_refs.py

Takes ~5-15 min depending on hardware. Run once per machine after changing
functional or geometry protocol. Output is deterministic for fixed xtb version.
"""

import os
import shutil
import subprocess
import sys
import tempfile


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

        def _patched(self, mol, grids, nao, deriv=0, max_memory=2000,
                     non0tab=None, blksize=None, buf=None):
            if blksize is not None and blksize % _BLKSIZE != 0:
                blksize = ((blksize + _BLKSIZE - 1) // _BLKSIZE) * _BLKSIZE
            return _orig(self, mol, grids, nao, deriv, max_memory, non0tab, blksize, buf)

        _numint.NumInt.block_loop = _patched
    except Exception:
        pass


_patch_pyscf_nmr()

TMS_SMILES = "[Si](C)(C)(C)C"
FUNCTIONAL = "pbe0"
# Only the default basis is precomputed at build time.
# Other bases are computed on demand at runtime and cached in the user cache.
BASES = ["pcseg-1"]


def _find_xtb() -> str | None:
    """Locate xtb binary: PATH then src-tauri/bin/ (dev context)."""
    system = shutil.which("xtb")
    if system:
        return system
    # Check bundled binary in src-tauri/bin/ relative to repo root
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    candidate = os.path.join(repo_root, "src-tauri", "bin", "xtb")
    if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
        return candidate
    return None


def mmff_geometry(smiles: str):
    """SMILES → RDKit mol with MMFF94s 3D geometry."""
    from rdkit import Chem
    from rdkit.Chem import AllChem

    mol = Chem.MolFromSmiles(smiles)
    mol = Chem.AddHs(mol)
    params = AllChem.ETKDGv3()
    params.randomSeed = 0xF00D
    if AllChem.EmbedMolecule(mol, params) < 0:
        raise RuntimeError("3D embedding failed")
    AllChem.MMFFOptimizeMolecule(mol, mmffVariant="MMFF94s", maxIters=500)
    return mol


def xtb_optimize(mol) -> bool:
    """Refine mol's conformer in-place with GFN2-xTB. Returns True on success."""
    from rdkit.Geometry import Point3D

    xtb = _find_xtb()
    if not xtb:
        print("  WARNING: xtb not found — keeping MMFF94s geometry")
        return False

    conf = mol.GetConformer(0)
    n = mol.GetNumAtoms()
    xyz_lines = [str(n), "TMS"]
    for i in range(n):
        pos = conf.GetAtomPosition(i)
        sym = mol.GetAtomWithIdx(i).GetSymbol()
        xyz_lines.append(f"{sym}  {pos.x:.6f}  {pos.y:.6f}  {pos.z:.6f}")
    xyz_text = "\n".join(xyz_lines) + "\n"

    with tempfile.TemporaryDirectory() as tmpdir:
        with open(os.path.join(tmpdir, "mol.xyz"), "w") as f:
            f.write(xyz_text)
        result = subprocess.run(
            [xtb, "mol.xyz", "--opt", "--gfn", "2"],
            cwd=tmpdir, capture_output=True, text=True, timeout=180,
        )
        opt_path = os.path.join(tmpdir, "xtbopt.xyz")
        if not os.path.isfile(opt_path):
            print(f"  WARNING: xtb opt failed: {result.stderr[-300:]}")
            return False

        with open(opt_path) as f:
            lines = f.readlines()

        for i in range(n):
            parts = lines[2 + i].split()
            conf.SetAtomPosition(i, Point3D(float(parts[1]), float(parts[2]), float(parts[3])))

    return True


def compute_shieldings(mol, basis: str) -> dict[str, float]:
    """Return averaged TMS reference shieldings {"1H": σ, "13C": σ} at PBE0/basis."""
    try:
        from pyscf.prop.nmr import rks as nmr_rks  # noqa: F401 — verify NMR is available
    except ImportError as e:
        raise ImportError(
            f"pyscf NMR unavailable: {e}. "
            "Install pyscf-properties or a pyscf version with built-in NMR support."
        ) from e
    from pyscf import dft, gto

    conf = mol.GetConformer(0)
    atom_spec = []
    for i in range(mol.GetNumAtoms()):
        pos = conf.GetAtomPosition(i)
        sym = mol.GetAtomWithIdx(i).GetSymbol()
        atom_spec.append(f"{sym} {pos.x:.6f} {pos.y:.6f} {pos.z:.6f}")

    pm = gto.Mole()
    pm.atom = "\n".join(atom_spec)
    pm.basis = basis
    pm.verbose = 0
    pm.build()

    mf = dft.RKS(pm)
    mf.xc = FUNCTIONAL
    mf.verbose = 0
    mf.kernel()

    shieldings = mf.NMR().kernel()

    h_vals, c_vals = [], []
    for i in range(mol.GetNumAtoms()):
        atom = mol.GetAtomWithIdx(i)
        sigma_iso = float(shieldings[i].trace() / 3)
        if atom.GetAtomicNum() == 1:
            h_vals.append(sigma_iso)
        elif atom.GetAtomicNum() == 6:
            c_vals.append(sigma_iso)

    if not h_vals or not c_vals:
        raise RuntimeError("No H or C atoms found in TMS")

    # TMS: 12 equivalent H, 4 equivalent C — average for robustness
    return {
        "1H": sum(h_vals) / len(h_vals),
        "13C": sum(c_vals) / len(c_vals),
    }


def write_refs_json(results: dict[str, dict[str, float]], geom_label: str, out_path: str) -> None:
    """Write {functional: {basis: {nucleus: sigma}}} to nmr_refs.json."""
    import json as _json

    payload = {
        "_meta": {
            "functional": FUNCTIONAL,
            "geometry": geom_label,
            "generated_by": "development/precompute_nmr_refs.py",
        },
        FUNCTIONAL: {basis: vals for basis, vals in results.items()},
    }
    with open(out_path, "w") as f:
        _json.dump(payload, f, indent=2)
    print(f"\nWrote: {out_path}")


def main():
    # Output path: src-tauri/bin/nmr_refs.json (alongside chem-engine.py)
    script_dir = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(script_dir)
    out_path = os.path.join(repo_root, "src-tauri", "bin", "nmr_refs.json")

    print(f"Computing TMS ({TMS_SMILES}) reference shieldings")
    print(f"Functional: {FUNCTIONAL}")
    print(f"Bases:      {', '.join(BASES)}")
    print(f"Output:     {out_path}\n")

    print("Step 1: MMFF94s initial geometry...")
    mol = mmff_geometry(TMS_SMILES)

    print("Step 2: GFN2-xTB optimization...")
    used_xtb = xtb_optimize(mol)
    geom_label = "GFN2-xTB" if used_xtb else "MMFF94s (xtb unavailable)"
    print(f"  Geometry source: {geom_label}\n")

    results: dict[str, dict[str, float]] = {}
    for basis in BASES:
        print(f"Step 3: {FUNCTIONAL}/{basis}...")
        try:
            refs = compute_shieldings(mol, basis)
            results[basis] = refs
            print(f"  σ_ref(¹H)  = {refs['1H']:.4f} ppm")
            print(f"  σ_ref(¹³C) = {refs['13C']:.4f} ppm")
        except Exception as e:
            print(f"  ERROR: {e}")
        print()

    if not results:
        print("WARNING: No reference shieldings computed — pyscf NMR unavailable.")
        print("DFT NMR will use approximate fallback values. Install a compatible pyscf")
        print("version with NMR support to get exact reference shieldings.")
        sys.exit(0)  # Non-fatal: build continues with fallback values in chem-engine.py

    write_refs_json(results, geom_label, out_path)
    print("Done. nmr_refs.json will be bundled automatically on next build:sidecar run.")


if __name__ == "__main__":
    main()
