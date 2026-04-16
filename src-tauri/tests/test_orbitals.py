import importlib.util
import sys
import unittest
from pathlib import Path
from unittest import mock

BIN_DIR = Path(__file__).resolve().parents[1] / "bin"
CHEM_ENGINE_PATH = BIN_DIR / "chem-engine.py"

if str(BIN_DIR) not in sys.path:
    sys.path.insert(0, str(BIN_DIR))

spec = importlib.util.spec_from_file_location("chem_engine", CHEM_ENGINE_PATH)
chem_engine = importlib.util.module_from_spec(spec)
sys.modules.setdefault("chem_engine", chem_engine)
assert spec.loader is not None
spec.loader.exec_module(chem_engine)


class FrontierIndexTests(unittest.TestCase):
    def test_frontier_orbital_indices_cover_homo_lumo_window(self):
        class FakeMeanField:
            mo_occ = [2, 2, 2, 0, 0, 0]

        orbitals = chem_engine._frontier_orbital_indices(FakeMeanField())
        self.assertEqual(
            orbitals,
            [
                (0, "HOMO-2"),
                (1, "HOMO-1"),
                (2, "HOMO"),
                (3, "LUMO"),
                (4, "LUMO+1"),
                (5, "LUMO+2"),
            ],
        )

    def test_orbital_cache_key_changes_with_basis_and_geometry(self):
        atoms = [
            {"element": "C", "x": 0.0, "y": 0.0, "z": 0.0},
            {"element": "H", "x": 0.0, "y": 0.0, "z": 1.1},
        ]
        key_a = chem_engine._orbital_cache_key("C", atoms, "3-21G", 0)
        key_b = chem_engine._orbital_cache_key("C", atoms, "6-31G*", 0)
        moved_atoms = [dict(atom) for atom in atoms]
        moved_atoms[1]["z"] = 1.2
        key_c = chem_engine._orbital_cache_key("C", moved_atoms, "3-21G", 0)
        key_d = chem_engine._orbital_cache_key("C", atoms, "3-21G", 1)

        self.assertNotEqual(key_a, key_b)
        self.assertNotEqual(key_a, key_c)
        self.assertNotEqual(key_a, key_d)

    def test_orbital_structure_key_prefers_molblock_over_smiles(self):
        key = chem_engine._orbital_structure_key(
            "C",
            "charged-molblock",
            [{"element": "C", "x": 0.0, "y": 0.0, "z": 0.0}],
        )
        self.assertEqual(key, "charged-molblock")


class StructureValidationTests(unittest.TestCase):
    def test_validate_orbital_structure_rejects_open_shell_systems(self):
        atoms = [
            {"element": "C", "x": 0.0, "y": 0.0, "z": 0.0},
            {"element": "H", "x": 1.0, "y": 0.0, "z": 0.0},
            {"element": "H", "x": -0.5, "y": 0.9, "z": 0.0},
            {"element": "H", "x": -0.5, "y": -0.9, "z": 0.0},
        ]

        with self.assertRaisesRegex(ValueError, "Open-shell / odd-electron systems"):
            chem_engine._validate_orbital_structure(atoms, 0)

    def test_resolve_total_charge_falls_back_to_molblock_metadata(self):
        charged_molblock = (
            "\n"
            "  ChemEditor\n"
            "\n"
            "  1  0  0  0  0  0  0  0  0  0999 V2000\n"
            "    0.0000    0.0000    0.0000 N   0  0  0  0  0  0  0  0  0  0  0  0\n"
            "M  CHG  1   1   1\n"
            "M  END\n"
        )

        with mock.patch.object(chem_engine, "_parse_mol", return_value=None):
            self.assertEqual(
                chem_engine._resolve_orbital_total_charge("", charged_molblock),
                1,
            )


class GeometryOptimizationTests(unittest.TestCase):
    def test_optimize_hartree_fock_geometry_returns_atoms_and_bonds_for_h2(self):
        result = chem_engine.optimize_hartree_fock_geometry(
            smiles="[H][H]",
            atoms=[
                {"element": "H", "x": 0.0, "y": 0.0, "z": 0.0},
                {"element": "H", "x": 0.0, "y": 0.0, "z": 0.9},
            ],
            bonds=[{"a1": 0, "a2": 1, "order": 1.0}],
            basis="STO-3G",
        )

        self.assertNotIn("error", result)
        self.assertEqual(len(result["atoms"]), 2)
        self.assertEqual(len(result["bonds"]), 1)


if __name__ == "__main__":
    unittest.main()
