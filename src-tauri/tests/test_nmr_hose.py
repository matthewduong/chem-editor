import importlib
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from rdkit import Chem

BIN_DIR = Path(__file__).resolve().parents[1] / "bin"

if str(BIN_DIR) not in sys.path:
    sys.path.insert(0, str(BIN_DIR))

nmr_hose = importlib.import_module("nmr_hose")


def _add_lookup(payload, nucleus, solvent, depth, code, *, median, n=20, mad=0.2, min_ppm=None, max_ppm=None):
    payload.setdefault(nucleus, {}).setdefault(solvent, {}).setdefault(str(depth), {})[code] = {
        "n": n,
        "median": median,
        "mad": mad,
        "min": median if min_ppm is None else min_ppm,
        "max": median if max_ppm is None else max_ppm,
    }


def _signal_by_atom(signals, atom_idx):
    for signal in signals:
        if signal["atom_idxs"] == [atom_idx]:
            return signal
    raise AssertionError(f"No signal found for atom index {atom_idx}: {signals}")


class HosePredictionTests(unittest.TestCase):
    def setUp(self):
        self.mol = Chem.MolFromSmiles("CCO")
        self.assertIsNotNone(self.mol)

    def _write_test_db(self, payload):
        tempdir = tempfile.TemporaryDirectory()
        db_path = Path(tempdir.name) / "test_hose.sqlite"
        nmr_hose.write_hose_database_sqlite(payload, str(db_path))
        return tempdir, db_path

    def test_predict_nmr_uses_sqlite_backed_hose_hits(self):
        payload = {
            "_meta": {
                "generated_from": "unit-test",
                "depths": list(nmr_hose.HOSE_DEPTHS),
                "proton_mhz": nmr_hose.PROTON_SPECTROMETER_MHZ,
            },
            "1H": {},
            "13C": {},
        }
        carbon_idx = 0
        proton_site_idx = 1

        _add_lookup(
            payload,
            "13C",
            "CDCl3",
            6,
            nmr_hose.hose_code(self.mol, carbon_idx, 6),
            median=11.0,
            n=24,
            mad=0.4,
            min_ppm=10.5,
            max_ppm=11.5,
        )
        _add_lookup(
            payload,
            "1H",
            "CDCl3",
            6,
            nmr_hose.hose_code(self.mol, proton_site_idx, 6),
            median=3.6,
            n=18,
            mad=0.15,
            min_ppm=3.4,
            max_ppm=3.8,
        )

        tempdir, db_path = self._write_test_db(payload)
        self.addCleanup(tempdir.cleanup)

        with mock.patch.object(nmr_hose, "_db_path", return_value=str(db_path)):
            result = nmr_hose.predict_nmr_hose("CCO", solvent="CDCl3")

        carbon_signal = _signal_by_atom(result["signals_13c"], carbon_idx)
        proton_signal = _signal_by_atom(result["signals_1h"], proton_site_idx)

        expected_carbon = round(
            0.94 * 11.0 + 0.06 * nmr_hose._carbon_heuristic(self.mol.GetAtomWithIdx(carbon_idx)),
            2,
        )
        expected_proton = round(
            0.86 * 3.6 + 0.14 * nmr_hose._proton_heuristic(self.mol.GetAtomWithIdx(proton_site_idx)),
            3,
        )

        self.assertEqual(carbon_signal["source"], "hose-6")
        self.assertEqual(carbon_signal["confidence"], 24)
        self.assertAlmostEqual(carbon_signal["center_ppm"], expected_carbon, places=2)
        self.assertIn("Matched HOSE DB", " ".join(carbon_signal["explanation"]))

        self.assertEqual(proton_signal["source"], "hose-6")
        self.assertEqual(proton_signal["confidence"], 18)
        self.assertAlmostEqual(proton_signal["center_ppm"], expected_proton, places=3)
        self.assertIn("Matched HOSE DB", " ".join(proton_signal["explanation"]))

    def test_predict_nmr_falls_back_to_pooled_solvent_rows(self):
        payload = {
            "_meta": {
                "generated_from": "unit-test",
                "depths": list(nmr_hose.HOSE_DEPTHS),
                "proton_mhz": nmr_hose.PROTON_SPECTROMETER_MHZ,
            },
            "1H": {},
            "13C": {},
        }
        carbon_idx = 1
        proton_site_idx = 0

        _add_lookup(
            payload,
            "13C",
            nmr_hose.POOLED_SOLVENT,
            6,
            nmr_hose.hose_code(self.mol, carbon_idx, 6),
            median=58.0,
            n=9,
            mad=0.6,
        )
        _add_lookup(
            payload,
            "1H",
            nmr_hose.POOLED_SOLVENT,
            6,
            nmr_hose.hose_code(self.mol, proton_site_idx, 6),
            median=1.2,
            n=7,
            mad=0.2,
        )

        tempdir, db_path = self._write_test_db(payload)
        self.addCleanup(tempdir.cleanup)

        with mock.patch.object(nmr_hose, "_db_path", return_value=str(db_path)):
            result = nmr_hose.predict_nmr_hose("CCO", solvent="DMSO-d6")

        carbon_signal = _signal_by_atom(result["signals_13c"], carbon_idx)
        proton_signal = _signal_by_atom(result["signals_1h"], proton_site_idx)

        expected_carbon = round(
            0.86 * 58.0 + 0.14 * nmr_hose._carbon_heuristic(self.mol.GetAtomWithIdx(carbon_idx)),
            2,
        )
        expected_proton = round(
            0.76 * 1.2 + 0.24 * nmr_hose._proton_heuristic(self.mol.GetAtomWithIdx(proton_site_idx)),
            3,
        )

        self.assertEqual(carbon_signal["source"], "hose-6")
        self.assertEqual(carbon_signal["confidence"], 9)
        self.assertAlmostEqual(carbon_signal["center_ppm"], expected_carbon, places=2)

        self.assertEqual(proton_signal["source"], "hose-6")
        self.assertEqual(proton_signal["confidence"], 7)
        self.assertAlmostEqual(proton_signal["center_ppm"], expected_proton, places=3)

    def test_load_hose_database_reads_generated_sqlite_file(self):
        payload = {
            "_meta": {
                "generated_from": "unit-test",
                "depths": list(nmr_hose.HOSE_DEPTHS),
                "proton_mhz": nmr_hose.PROTON_SPECTROMETER_MHZ,
            },
            "1H": {},
            "13C": {},
        }
        carbon_idx = 0

        _add_lookup(
            payload,
            "13C",
            "CDCl3",
            6,
            nmr_hose.hose_code(self.mol, carbon_idx, 6),
            median=14.0,
            n=20,
            mad=0.3,
        )

        tempdir, db_path = self._write_test_db(payload)
        self.addCleanup(tempdir.cleanup)

        with mock.patch.object(nmr_hose, "_db_path", return_value=str(db_path)):
            db = nmr_hose.load_hose_database()
            try:
                result = nmr_hose.predict_nmr_hose_from_mol(self.mol, db=db, solvent="CDCl3")
            finally:
                db.close()

        carbon_signal = _signal_by_atom(result["signals_13c"], carbon_idx)
        self.assertEqual(carbon_signal["source"], "hose-6")
        self.assertGreater(carbon_signal["center_ppm"], 0)


if __name__ == "__main__":
    unittest.main()
