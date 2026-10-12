import unittest

from test_orbitals import chem_engine


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

