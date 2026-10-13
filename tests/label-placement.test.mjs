import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGeneratedLabelSide } from '../.unit-test-dist/src/lib/labelPlacement.js';
import {
  resolveStackedHydrogenSide,
  splitHydrogenLabel,
} from '../.unit-test-dist/src/lib/atomLabels.js';
import { getStackedLabelBaselines } from '../.unit-test-dist/src/lib/chemdrawMetrics.js';

// Bond directions (degrees counter-clockwise from +x, y up) -> the LabelAlignment ChemDraw
// 26.1.0.6801 saved for a heteroatom with hydrogens and no label of its own (macOS, 2026-10-13).
// The same table held for N, O, S, P, B, Si, Se, C and for charges -1 and +1.
const MEASURED = [
  [[0], 'right'],
  [[0, 30], 'right'],
  [[0, 60], 'right'],
  [[0, 90], 'right'],
  [[0, 120], 'right'],
  [[0, 122], 'right'],
  [[0, 124], 'right'],
  [[0, 126], 'right'],
  [[0, 128], 'right'],
  [[0, 130], 'right'],
  [[0, 132], 'right'],
  [[0, 134], 'right'],
  [[0, 136], 'below'],
  [[0, 138], 'below'],
  [[0, 140], 'below'],
  [[0, 142], 'below'],
  [[0, 144], 'below'],
  [[0, 146], 'below'],
  [[0, 148], 'below'],
  [[0, 150], 'below'],
  [[0, 180], 'above'],
  [[0, 210], 'above'],
  [[0, 240], 'right'],
  [[0, 270], 'right'],
  [[0, 300], 'right'],
  [[0, 330], 'right'],
  [[30], 'right'],
  [[30, 60], 'right'],
  [[30, 90], 'right'],
  [[30, 90, 150], 'below'],
  [[30, 90, 150, 270], 'left'],
  [[30, 120], 'below'],
  [[30, 150], 'below'],
  [[30, 180], 'below'],
  [[30, 210], 'right'],
  [[30, 240], 'right'],
  [[30, 270], 'right'],
  [[30, 300], 'right'],
  [[30, 330], 'right'],
  [[45, 135, 225, 315], 'above'],
  [[60], 'right'],
  [[60, 90], 'below'],
  [[60, 120], 'below'],
  [[60, 120, 180], 'left'],
  [[60, 120, 270], 'left'],
  [[60, 150], 'below'],
  [[60, 180], 'left'],
  [[60, 210], 'left'],
  [[60, 240], 'right'],
  [[60, 270], 'right'],
  [[60, 300], 'right'],
  [[60, 330], 'right'],
  [[90], 'left'],
  [[90, 120], 'below'],
  [[90, 150], 'left'],
  [[90, 180], 'left'],
  [[90, 210], 'left'],
  [[90, 210, 330], 'left'],
  [[90, 240], 'left'],
  [[90, 270], 'left'],
  [[90, 300], 'right'],
  [[90, 330], 'right'],
  [[120], 'left'],
  [[120, 150], 'left'],
  [[120, 180], 'left'],
  [[120, 210], 'left'],
  [[120, 240], 'left'],
  [[120, 270], 'left'],
  [[120, 300], 'left'],
  [[120, 330], 'right'],
  [[150], 'left'],
  [[150, 180], 'left'],
  [[150, 210], 'left'],
  [[150, 240], 'left'],
  [[150, 270], 'left'],
  [[150, 300], 'left'],
  [[150, 330], 'left'],
  [[180], 'left'],
  [[180, 210], 'left'],
  [[180, 240], 'left'],
  [[180, 270], 'left'],
  [[180, 300], 'left'],
  [[180, 330], 'above'],
  [[210], 'left'],
  [[210, 240], 'left'],
  [[210, 270], 'left'],
  [[210, 300], 'above'],
  [[210, 330], 'above'],
  [[240], 'left'],
  [[240, 270], 'above'],
  [[240, 300], 'above'],
  [[240, 300, 0], 'right'],
  [[240, 330], 'above'],
  [[270], 'left'],
  [[270, 300], 'above'],
  [[270, 330], 'right'],
  [[300], 'right'],
  [[300, 330], 'right'],
  [[330], 'right'],
];

const L = 14.4;
function build(angles, extra = {}) {
  const atom = { id: 'c', x: 0, y: 0, element: 'N', ...extra };
  const atoms = [atom];
  const bonds = angles.map((a, i) => {
    const t = (a * Math.PI) / 180;
    atoms.push({ id: `n${i}`, element: 'C', x: L * Math.cos(t), y: -L * Math.sin(t) });
    return { id: `b${i}`, from: 'c', to: `n${i}`, order: 1 };
  });
  return { atom, atoms, bonds };
}

test('placement reproduces every measured ChemDraw alignment', () => {
  for (const [angles, expected] of MEASURED) {
    const { atom, atoms, bonds } = build(angles);
    assert.equal(
      resolveGeneratedLabelSide(atom, atoms, bonds, { hasHydrogens: true }),
      expected,
      `bonds at ${angles.join(', ')}`,
    );
  }
});

test('the stacking boundary sits 22.5 degrees from vertical', () => {
  const side = (phi) => {
    const { atom, atoms, bonds } = build([0, phi]);
    return resolveGeneratedLabelSide(atom, atoms, bonds, { hasHydrogens: true });
  };
  assert.equal(side(134), 'right');
  assert.equal(side(136), 'below');
});

test('without hydrogens a label is never stacked', () => {
  const { atom, atoms, bonds } = build([60, 120]);
  assert.equal(resolveGeneratedLabelSide(atom, atoms, bonds, { hasHydrogens: false }), 'left');
});

test('an atom with no bonds has no measured placement', () => {
  const { atom, atoms, bonds } = build([]);
  assert.equal(resolveGeneratedLabelSide(atom, atoms, bonds, { hasHydrogens: true }), null);
});

test('explicit alignment and orientation override the rule; shorthand never stacks', () => {
  const { atom, atoms, bonds } = build([60, 120]);
  assert.equal(resolveStackedHydrogenSide(atom, atoms, bonds, 1), 'below');
  assert.equal(resolveStackedHydrogenSide(atom, atoms, bonds, 0), null);
  assert.equal(resolveStackedHydrogenSide(atom, atoms, bonds, 1, 'above'), 'above');
  assert.equal(resolveStackedHydrogenSide(atom, atoms, bonds, 1, 'left'), null);
  const chosen = build([60, 120], { labelOrientation: 'hydrogen-first' });
  assert.equal(resolveStackedHydrogenSide(chosen.atom, chosen.atoms, chosen.bonds, 1), null);
  const alias = build([60, 120], { kind: 'alias', alias: 'OMe' });
  assert.equal(resolveStackedHydrogenSide(alias.atom, alias.atoms, alias.bonds, 1), null);
});

test('label text from a file splits into element and hydrogens', () => {
  assert.deepEqual(splitHydrogenLabel('NH'), { lead: 'N', hydrogens: 'H' });
  assert.deepEqual(splitHydrogenLabel('SiH2'), { lead: 'Si', hydrogens: 'H2' });
  assert.deepEqual(splitHydrogenLabel('SeH₂'), { lead: 'Se', hydrogens: 'H₂' });
  assert.equal(splitHydrogenLabel('OMe'), null);
  assert.equal(splitHydrogenLabel('HN'), null);
  assert.equal(splitHydrogenLabel('H2'), null);
});

// Baselines ChemDraw saved, relative to the atom's y: [size, side, hasSubscript, lead, hydrogens].
const BASELINES = [
  [8, 'below', false, 2.86, 9.59],
  [10, 'below', false, 3.58, 11.93],
  [12, 'below', false, 4.29, 14.32],
  [16, 'below', false, 5.73, 19.09],
  [24, 'below', false, 8.59, 28.63],
  [10, 'above', false, 3.58, -4.77],
  [24, 'above', false, 8.59, -11.45],
  [10, 'above', true, 3.64, -6.89],
  [24, 'above', true, 8.74, -16.54],
];

test('stacked baselines match ChemDraw to within 0.2pt', () => {
  for (const [size, side, subscript, lead, hydrogens] of BASELINES) {
    const got = getStackedLabelBaselines(size, side, subscript);
    const tolerance = 0.2; // ChemDraw's 8pt pitch is 0.841 em, the rest 0.835
    assert.ok(
      Math.abs(got.lead - lead) <= tolerance,
      `lead ${size} ${side}: ${got.lead} vs ${lead}`,
    );
    assert.ok(
      Math.abs(got.hydrogens - hydrogens) <= tolerance,
      `hydrogens ${size} ${side} ${subscript}: ${got.hydrogens} vs ${hydrogens}`,
    );
  }
});
