import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import {
  computeAllBondVisibleIntervals,
  computeBondVisibleIntervals,
} from '../.unit-test-dist/src/lib/renderGeometry.js';
import { cdxmlToChemDrawDocument } from '../.unit-test-dist/src/utils/cdxml.js';
import { chemDrawDocumentToCanvasState } from '../.unit-test-dist/src/lib/chemdrawModel.js';
import { DEFAULT_DOCUMENT_STYLE_SETTINGS } from '../.unit-test-dist/src/lib/settings.js';

const settings = DEFAULT_DOCUMENT_STYLE_SETTINGS;
const width = (bond) => bond.lineWidth ?? settings.bondLineWidth;

function assertSameAsPerBond(atoms, bonds, label) {
  const batch = computeAllBondVisibleIntervals(atoms, bonds, width, settings);
  // `new Map(bonds.map(...))` is what the scene used to do: the last bond wins per id.
  const expected = new Map(
    bonds.map((bond) => [
      bond.id,
      computeBondVisibleIntervals(bond, atoms, bonds, width, settings),
    ]),
  );
  assert.deepEqual([...batch.keys()], [...expected.keys()], label);
  for (const [id, intervals] of expected)
    assert.deepEqual(batch.get(id), intervals, `${label} ${id}`);
}

const fixtures = readdirSync('tests/fixtures/cdxml').filter((f) => f.endsWith('.cdxml'));
for (const fixture of fixtures)
  test(`batched crossing intervals equal the per-bond result: ${fixture}`, () => {
    const document = cdxmlToChemDrawDocument(
      readFileSync(`tests/fixtures/cdxml/${fixture}`, 'utf8'),
    ).document;
    const { atoms, bonds } = chemDrawDocumentToCanvasState(document).state;
    assertSameAsPerBond(atoms, bonds, fixture);
  });

const atom = (id, x, y, extra = {}) => ({ id, x, y, kind: 'atom', element: 'C', ...extra });
const bond = (id, from, to, extra = {}) => ({ id, from, to, order: 1, ...extra });

test('a crossing is cut in the lower bond only, and matches the per-bond result', () => {
  const atoms = [atom('a', 0, 0), atom('b', 40, 40), atom('c', 0, 40), atom('d', 40, 0)];
  const bonds = [bond('lower', 'a', 'b'), bond('upper', 'c', 'd')];
  const batch = computeAllBondVisibleIntervals(atoms, bonds, width, settings);
  assert.ok(batch.get('lower').length > 1, 'lower bond has a gap');
  assert.deepEqual(batch.get('upper'), [[0, 1]]);
  assertSameAsPerBond(atoms, bonds, 'crossing');
});

test('labelled atoms, dangling bonds and duplicate ids behave as before', () => {
  const atoms = [
    atom('a', 0, 0, { element: 'N' }),
    atom('b', 30, 10, { element: 'O' }),
    atom('c', 0, 30),
    atom('c', 99, 99), // duplicate id: the first atom wins, as with `find`
  ];
  const bonds = [
    bond('x', 'a', 'b'),
    bond('y', 'c', 'b'),
    bond('y', 'a', 'c'), // duplicate bond id
    bond('dangling', 'a', 'missing'),
    bond('zero', 'c', 'c'),
  ];
  assertSameAsPerBond(atoms, bonds, 'malformed');
});

test('empty and single-bond inputs', () => {
  assert.equal(computeAllBondVisibleIntervals([], [], width, settings).size, 0);
  const atoms = [atom('a', 0, 0), atom('b', 14, 0)];
  assertSameAsPerBond(atoms, [bond('only', 'a', 'b')], 'single');
});
