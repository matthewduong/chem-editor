import test from 'node:test';
import assert from 'node:assert/strict';

import { fragmentAcross } from '../.unit-test-dist/src/lib/massFragmentation.js';

const atom = (id, element, x, y) => ({ id, x, y, kind: 'element', element });
const bond = (id, from, to, order = 1) => ({ id, from, to, order });

test('cutting ethanol between the carbons gives CH3 and CH2OH radicals', () => {
  const atoms = [atom('a', 'C', 0, 0), atom('b', 'C', 26, -15), atom('o', 'O', 52, 0)];
  const bonds = [bond('ab', 'a', 'b'), bond('bo', 'b', 'o')];
  const sides = fragmentAcross(
    [
      { x: 13, y: -40 },
      { x: 13, y: 30 },
    ],
    atoms,
    bonds,
  );
  const byFormula = Object.fromEntries(sides.map((s) => [s.formula, s]));
  assert.deepEqual(Object.keys(byFormula).sort(), ['CH3', 'CH3O']);
  assert.equal(byFormula.CH3.radicals, 1);
  assert.ok(Math.abs(byFormula.CH3.exactMass - 15.0235) < 1e-3);
  assert.ok(Math.abs(byFormula.CH3O.exactMass - 31.0184) < 1e-3);
});

test('one ring bond crossed leaves one formula, the whole molecule', () => {
  const ring = [0, 1, 2, 3, 4, 5].map((i) =>
    atom(`r${i}`, 'C', 30 * Math.cos((i * Math.PI) / 3), 30 * Math.sin((i * Math.PI) / 3)),
  );
  const bonds = ring.map((_, i) => bond(`b${i}`, `r${i}`, `r${(i + 1) % 6}`));
  const sides = fragmentAcross(
    [
      { x: 35, y: 22 },
      { x: 12, y: 4 },
    ],
    ring,
    bonds,
  );
  assert.equal(sides.length, 1);
  assert.equal(sides[0].formula, 'C6H12');
});

test('a line that crosses nothing fragments nothing', () => {
  const atoms = [atom('a', 'C', 0, 0), atom('b', 'C', 26, 0)];
  assert.equal(
    fragmentAcross(
      [
        { x: 0, y: 20 },
        { x: 30, y: 20 },
      ],
      atoms,
      [bond('ab', 'a', 'b')],
    ),
    null,
  );
});
