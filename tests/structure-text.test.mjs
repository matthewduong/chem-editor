import test from 'node:test';
import assert from 'node:assert/strict';
import initRDKitModule from '@rdkit/rdkit';

import { structureAsText } from '../.unit-test-dist/src/lib/structureText.js';

test('a structure copies as SMILES, InChI, InChIKey and molfile', async () => {
  const rdkit = await initRDKitModule();
  const molblock = rdkit.get_mol('CCO').get_molblock();
  assert.equal(structureAsText(rdkit, molblock, 'smiles'), 'CCO');
  assert.equal(structureAsText(rdkit, molblock, 'inchi'), 'InChI=1S/C2H6O/c1-2-3/h3H,2H2,1H3');
  assert.equal(structureAsText(rdkit, molblock, 'inchikey'), 'LFQSCWFLJHTTHZ-UHFFFAOYSA-N');
  assert.match(structureAsText(rdkit, molblock, 'molfile'), /V2000/);
});

test('enhanced stereo groups make a V3000 molfile that RDKit reads back as groups', async () => {
  const rdkit = await initRDKitModule();
  const molblock = rdkit.get_mol('C[C@H](O)C[C@@H](C)N').get_molblock();
  const text = structureAsText(rdkit, molblock, 'molfile', {
    absolute: [],
    and: new Map([[1, [2]]]),
    or: new Map([[1, [5]]]),
  });
  assert.match(text, /V3000/);
  assert.match(text, /MDLV30\/STERAC1 ATOMS=\(1 2\)/);
  assert.match(text, /MDLV30\/STEREL1 ATOMS=\(1 5\)/);
  // RDKit's CXSMILES writes the groups back: &1 and o1.
  const cx = rdkit.get_mol(text).get_cxsmiles();
  assert.match(cx, /&1:/);
  assert.match(cx, /o1:/);
});
