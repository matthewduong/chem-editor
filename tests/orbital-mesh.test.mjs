import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOrbitalMesh } from '../src/lib/orbitalMesh.ts';
import { viewer3DFormalChargeFromMolblock } from '../src/lib/viewer3d.ts';

const grid = {
  origin: [0, 0, 0],
  spacing: 0.5,
  dims: [2, 2, 2],
};

const field = {
  key: 'mo-1',
  values: [1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0, -1.0],
  minValue: -1.0,
  maxValue: 1.0,
};

test('orbital mesh generation responds to the isovalue without refetching field data', () => {
  const dense = buildOrbitalMesh(field, grid, 0.02);
  const sparse = buildOrbitalMesh(field, grid, 0.12);

  assert.ok(dense);
  assert.ok(dense.positivePositions.length > 0);
  assert.ok(dense.negativePositions.length > 0);
  assert.ok(sparse);
  assert.ok(dense.positivePositions.length >= sparse.positivePositions.length);
  assert.ok(dense.negativePositions.length >= sparse.negativePositions.length);
});

test('formal charge parsing follows the charge drawn in the molblock', () => {
  const molblock = `
  ChemEditor

  2  1  0  0  0  0  0  0  0  0999 V2000
    0.0000    0.0000    0.0000 N   0  0  0  0  0  0  0  0  0  0  0  0
    1.2000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0
  1  2  1  0  0  0  0
M  CHG  2   1   1   2  -1
M  END
`;

  assert.equal(viewer3DFormalChargeFromMolblock(molblock), 0);
});
