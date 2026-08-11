import test from 'node:test';
import assert from 'node:assert/strict';

import { graphToMolblock } from '../.unit-test-dist/src/lib/graph.js';

test('graphToMolblock does not rely on repeated Array.findIndex lookups', () => {
  const atoms = Object.assign(
    [
      { id: 'a1', x: 0, y: 0, kind: 'element', element: 'C' },
      { id: 'a2', x: 40, y: 0, kind: 'element', element: 'O', charge: -1 },
      { id: 'a3', x: 80, y: 0, kind: 'element', element: 'N', charge: 1 },
    ],
    {
      findIndex() {
        throw new Error('graphToMolblock should use indexed atom lookup instead of findIndex');
      },
    },
  );
  const bonds = [
    { id: 'b1', from: 'a1', to: 'a2', order: 1, stereo: 0 },
    { id: 'b2', from: 'a2', to: 'a3', order: 2, stereo: 0 },
  ];

  const result = graphToMolblock(atoms, bonds, 400, 300);

  assert.match(result.molblock, /V2000/);
  // V2000 bond blocks are fixed-width columns, so the space counts are significant.
  assert.match(result.molblock, /M {2}CHG/);
  assert.match(result.molblock, / {2}1 {2}2 {2}1/);
  assert.match(result.molblock, / {2}2 {2}3 {2}2/);
});
