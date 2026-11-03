import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from rdkit import Chem
from test_orbitals import chem_engine as engine


class DftSafetyTests(unittest.TestCase):
    def test_identity_preserves_input_order_and_charge(self):
        a = Chem.MolFromSmiles('CCO')
        b = Chem.RenumberAtoms(a, [2, 1, 0])
        self.assertNotEqual(engine._nmr_dft_cache_key(a), engine._nmr_dft_cache_key(b))
        self.assertNotEqual(engine._nmr_dft_cache_key(Chem.MolFromSmiles('N')),
                            engine._nmr_dft_cache_key(Chem.MolFromSmiles('[NH4+]')))

    def test_closed_shell_charge_and_radical_rejection(self):
        self.assertEqual(engine._nmr_closed_shell_charge(Chem.MolFromSmiles('[NH4+]')), 1)
        self.assertEqual(engine._nmr_closed_shell_charge(Chem.MolFromSmiles('[Cl-]')), -1)
        with self.assertRaisesRegex(ValueError, 'radicals'):
            engine._nmr_closed_shell_charge(Chem.MolFromSmiles('[CH3]'))
        self.assertIn('radicals', engine.predict_nmr_dft('[CH3]')['error'])

    def test_cache_version_validation_and_atomic_replacement(self):
        result = {'signals_1h': [], 'signals_13c': [dict(atom_idxs=[0], center_ppm=20,
                  integral=1, transitions=[dict(ppm=20, intensity=1)], couplings_hz=[])]}
        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.object(engine, '_nmr_dft_cache_dir', return_value=directory):
            path = Path(directory) / 'key.json'
            path.write_text(json.dumps(result))
            self.assertIsNone(engine._load_nmr_dft_cache('key', 1))
            engine._save_nmr_dft_cache('key', result, 1)
            self.assertEqual(engine._load_nmr_dft_cache('key', 1), result)
            before = path.read_bytes()
            with mock.patch.object(engine.os, 'replace', side_effect=OSError('disk')):
                engine._save_nmr_dft_cache('key', result, 1)
            self.assertEqual(path.read_bytes(), before)
            self.assertEqual(len(list(Path(directory).iterdir())), 1)
            result['signals_13c'][0]['atom_idxs'] = [1]
            self.assertFalse(engine._validate_nmr_dft_result(result, 1))
            result['signals_13c'][0]['atom_idxs'] = [0]
            result['signals_13c'][0]['center_ppm'] = float('nan')
            with self.assertRaisesRegex(ValueError, 'non-finite'):
                engine._save_nmr_dft_cache('key', result, 1)


def _fake_pyscf(converged=True, energy=-1.0):
    """A stand-in PySCF so predict_nmr_dft runs end to end without any real calculation."""
    import importlib.machinery
    import types

    built = []

    class Mole:
        def build(self):
            built.append(self)

    class RKS:
        def __init__(self, mole):
            self.mol = mole
            self.converged = False

        def kernel(self):
            self.converged = converged
            return energy

    pyscf = types.ModuleType('pyscf')
    pyscf.__spec__ = importlib.machinery.ModuleSpec('pyscf', None)
    pyscf.gto = types.SimpleNamespace(Mole=Mole)
    pyscf.dft = types.SimpleNamespace(RKS=RKS)
    return pyscf, built


class DftEndToEndTests(unittest.TestCase):
    def run_dft(self, smiles, *, shielding=30.0, converged=True):
        import numpy as np

        pyscf, built = _fake_pyscf(converged=converged)

        def shieldings(mf):
            count = len(mf.mol.atom.splitlines())
            return np.array([np.eye(3) * shielding for _ in range(count)])

        with tempfile.TemporaryDirectory() as directory, \
                mock.patch.dict('sys.modules', {'pyscf': pyscf}), \
                mock.patch.object(engine, '_nmr_dft_cache_dir', return_value=directory), \
                mock.patch.object(engine, '_xtb_optimize_mol', return_value=False), \
                mock.patch.object(engine, '_compute_pyscf_shieldings', side_effect=shieldings):
            result = engine.predict_nmr_dft(smiles)
            cached = list(Path(directory).iterdir())
        return result, built, cached

    def test_implicit_hydrogens_produce_valid_input_indexed_signals(self):
        result, built, cached = self.run_dft('CCO')
        self.assertNotIn('error', result)
        self.assertTrue(engine._validate_nmr_dft_result(result, 3))
        self.assertEqual(sum(s['integral'] for s in result['signals_1h']), 6)
        self.assertTrue(all(i < 3 for s in result['signals_1h'] for i in s['atom_idxs']))
        self.assertEqual((built[0].charge, built[0].spin), (0, 0))
        self.assertEqual(len(cached), 1)

    def test_total_charge_reaches_pyscf(self):
        result, built, _ = self.run_dft('C[NH3+]')
        self.assertNotIn('error', result)
        self.assertEqual(built[0].charge, 1)

    def test_unconverged_scf_is_an_error_and_is_not_cached(self):
        result, _, cached = self.run_dft('CCO', converged=False)
        self.assertIn('converge', result['error'])
        self.assertEqual(cached, [])

    def test_non_finite_shielding_is_an_error_and_is_not_cached(self):
        result, _, cached = self.run_dft('CCO', shielding=float('nan'))
        self.assertIn('non-finite', result['error'])
        self.assertEqual(cached, [])


class OneShotNmrCommandTests(unittest.TestCase):
    def test_molblock_is_read_from_stdin(self):
        import subprocess
        import sys

        script = Path(engine.__file__)
        molblock = Chem.MolToMolBlock(Chem.MolFromSmiles('CCO'))
        output = subprocess.run(
            [sys.executable, str(script), 'nmr', '--method', 'hose', '--molblock', '-'],
            input=molblock, capture_output=True, text=True, timeout=120, check=True,
        )
        result = json.loads(output.stdout)
        self.assertNotIn('error', result)
        self.assertTrue(result['signals_13c'])
