import test from 'node:test';
import assert from 'node:assert/strict';

import {
  graphToMolblock,
  parseMolblockGeometry,
  molblockToState,
} from '../.unit-test-dist/src/lib/graph.js';

const atom = (id, x, extra = {}) => ({ id, x, y: 0, kind: 'element', element: 'C', ...extra });
const bond = { id: 'b1', from: 'a', to: 'b', order: 1 };

test('graphToMolblock writes isotope and radical properties that the reader understands', () => {
  const { molblock } = graphToMolblock(
    [atom('a', 0, { isotope: 13 }), atom('b', 20, { radicalElectrons: 1 })],
    [bond],
    0,
    0,
  );
  assert.match(molblock, /M {2}ISO {2}1 {3}1 {2}13\n/);
  assert.match(molblock, /M {2}RAD {2}1 {3}2 {3}2\n/);

  const geometry = parseMolblockGeometry(molblock);
  assert.equal(geometry.atoms[0].isotope, 13);
  assert.equal(geometry.atoms[1].radicalElectrons, 1);
});

test('molblockToState carries isotope and radical electrons onto canvas atoms', () => {
  const { molblock } = graphToMolblock(
    [atom('a', 0, { isotope: 2 }), atom('b', 20, { radicalElectrons: 2 })],
    [bond],
    0,
    0,
  );
  const state = molblockToState(molblock, 100, 100);
  assert.equal(state.atoms[0].isotope, 2);
  assert.equal(state.atoms[1].radicalElectrons, 2);
});

test('property lines are chunked at eight atoms', () => {
  const atoms = Array.from({ length: 10 }, (_, i) => atom(`a${i}`, i * 20, { isotope: 13 }));
  const { molblock } = graphToMolblock(atoms, [], 0, 0);
  assert.equal((molblock.match(/^M {2}ISO/gm) ?? []).length, 2);
});

const V3000 = `
  test

  0  0  0     0  0            999 V3000
M  V30 BEGIN CTAB
M  V30 COUNTS 3 2 0 0 0
M  V30 BEGIN ATOM
M  V30 1 C 0 0 0 0 MASS=13
M  V30 2 N 1.5 0 0 0 CHG=1 RAD=2
M  V30 3 O 3 0 0 0
M  V30 END ATOM
M  V30 BEGIN BOND
M  V30 1 1 1 2
M  V30 2 2 2 3 CFG=1
M  V30 END BOND
M  V30 END CTAB
M  END
`;

test('V3000 molfiles are parsed rather than reported as empty', () => {
  const geometry = parseMolblockGeometry(V3000, 1);
  assert.equal(geometry.atoms.length, 3);
  assert.equal(geometry.bonds.length, 2);
  assert.equal(geometry.atoms[0].isotope, 13);
  assert.equal(geometry.atoms[1].charge, 1);
  assert.equal(geometry.atoms[1].radicalElectrons, 1);
  assert.deepEqual(geometry.bonds[1], { from: 1, to: 2, order: 2, stereo: 1 });
});

test('non-numeric coordinates make the molblock unparsable instead of yielding NaN atoms', () => {
  const { molblock } = graphToMolblock([atom('a', 0), atom('b', 20)], [bond], 0, 0);
  const broken = molblock.replace(/^ +0\.0000/m, '       abc');
  assert.equal(parseMolblockGeometry(broken), null);
});
