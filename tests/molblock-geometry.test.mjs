import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MOLBLOCK_SCALE,
  getMedianBondLength,
  normalizeMolblockBondLength,
  parseMolblockGeometry,
} from '../.unit-test-dist/src/lib/graph.js';

function approxEqual(actual, expected, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

const ETHANE_MOLBLOCK = `Fragment
  ChemEditor

  2  1  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
    1.5000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
M  END
`;

const SINGLE_ATOM_MOLBLOCK = `Fragment
  ChemEditor

  1  0  0  0  0  0  0  0  0  0999 V2000
    1.2000   -0.5000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
M  END
`;

test('fragment geometry normalizes bonded molblocks to the requested bond length', () => {
  const rawGeometry = parseMolblockGeometry(ETHANE_MOLBLOCK, 1);
  assert.ok(rawGeometry);
  approxEqual(getMedianBondLength(rawGeometry), 1.5);

  const normalizedGeometry = normalizeMolblockBondLength(rawGeometry, 14.4);
  approxEqual(getMedianBondLength(normalizedGeometry), 14.4);
});

test('bondless fragment geometry falls back to the legacy molblock scale', () => {
  const rawGeometry = parseMolblockGeometry(SINGLE_ATOM_MOLBLOCK, 1);
  assert.ok(rawGeometry);
  assert.equal(getMedianBondLength(rawGeometry), null);

  const normalizedGeometry = normalizeMolblockBondLength(rawGeometry, 14.4);
  approxEqual(normalizedGeometry.atoms[0].x, 1.2 * MOLBLOCK_SCALE);
  approxEqual(normalizedGeometry.atoms[0].y, 0.5 * MOLBLOCK_SCALE);
});
