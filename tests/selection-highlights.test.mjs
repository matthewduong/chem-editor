import test from 'node:test';
import assert from 'node:assert/strict';

import { getFullySelectedComponentAtomIds } from '../.unit-test-dist/src/lib/graph.js';

function atom(id) {
  return { id, x: 0, y: 0, kind: 'element', element: 'C' };
}

test('fully selected connected structures suppress per-atom selection adornments', () => {
  const atoms = [atom('a1'), atom('a2'), atom('a3'), atom('a4')];
  const bonds = [
    { id: 'b1', from: 'a1', to: 'a2', order: 1 },
    { id: 'b2', from: 'a2', to: 'a3', order: 1 },
  ];

  assert.deepEqual(
    Array.from(getFullySelectedComponentAtomIds(atoms, bonds, new Set(['a1', 'a2', 'a3']))).sort(),
    ['a1', 'a2', 'a3'],
  );
  assert.deepEqual(
    Array.from(getFullySelectedComponentAtomIds(atoms, bonds, new Set(['a1', 'a2']))),
    [],
  );
  assert.deepEqual(Array.from(getFullySelectedComponentAtomIds(atoms, bonds, new Set(['a4']))), []);
});
