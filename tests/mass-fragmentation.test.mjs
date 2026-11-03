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

// ChemDraw 26.1.0.6801, Mass Fragmentation tool dragged across the C3-C4 bond of isopentanol
// (CC(C)CCO, bond length 14.4): its two captions' wording and baseline anchors (gaps.md).
test('captions read and stand where ChemDraw puts them', async () => {
  const { fragmentationCaptions } = await import('../.unit-test-dist/src/lib/massFragmentation.js');
  const { DEFAULT_DOCUMENT_STYLE_SETTINGS: settings } =
    await import('../.unit-test-dist/src/lib/settings.js');
  const atoms = [
    atom('1', 'C', 78.22, 290.82),
    atom('2', 'C', 89.54, 299.71),
    atom('3', 'C', 87.5, 313.97),
    atom('4', 'C', 102.91, 294.36),
    atom('5', 'C', 114.23, 303.25),
    atom('6', 'O', 127.6, 297.89),
  ];
  const bonds = [
    bond('a', '1', '2'),
    bond('b', '2', '3'),
    bond('c', '2', '4'),
    bond('d', '4', '5'),
    bond('e', '5', '6'),
  ];
  // Across the C4-C5 bond (ChemDraw's drag was from (99.9, 287.7) to (117.3, 309.9)).
  const path = [
    { x: 99.9, y: 287.7 },
    { x: 117.3, y: 309.9 },
  ];
  const sides = fragmentAcross(path, atoms, bonds);
  let n = 0;
  const captions = fragmentationCaptions(sides, atoms, path, settings, () => `t${n++}`);
  const text = (c) => c.text.runs.map((r) => r.text).join('');
  const bySide = Object.fromEntries(
    sides.map((s, i) => [s.formula, { caption: captions[i], side: s }]),
  );
  const c4 = bySide.C4H9.caption;
  assert.equal(text(c4), 'Chemical formula: C4H9•\nExact mass: 57.07043');
  assert.ok(Math.abs(c4.anchor.x - 90.57) < 0.3 && Math.abs(c4.anchor.y - 332.37) < 0.3);
  const oh = bySide.CH3O.caption;
  assert.equal(text(oh), 'Chemical formula: CH3O•\nExact mass: 31.01839');
  assert.ok(Math.abs(oh.anchor.x - 120.9) < 3.5 && Math.abs(oh.anchor.y - 275.12) < 0.5);
});

test("cut atoms get ChemDraw's electron symbol: 2.8pt towards the break, second point 7.5pt left", async () => {
  const { fragmentationRadicals } = await import('../.unit-test-dist/src/lib/massFragmentation.js');
  const atoms = [atom('4', 'C', 102.91, 294.36), atom('5', 'C', 114.23, 303.25)];
  const marks = fragmentationRadicals(
    [
      { x: 99.9, y: 287.7 },
      { x: 117.3, y: 309.9 },
    ],
    atoms,
    [bond('d', '4', '5')],
  );
  const near = (a, b) => Math.abs(a - b) < 0.05;
  const four = marks.find((m) => m.atomId === '4');
  assert.ok(near(four.points[0].x, 105.09) && near(four.points[0].y, 296.11));
  assert.ok(near(four.points[1].x, 97.59) && near(four.points[1].y, 296.11));
  const five = marks.find((m) => m.atomId === '5');
  assert.ok(near(five.points[0].x, 112.05) && near(five.points[0].y, 301.5));
  assert.ok(near(five.points[1].x, 104.55));
});
