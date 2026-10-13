import test from 'node:test';
import assert from 'node:assert/strict';
import { chemDrawImplicitHydrogens } from '../.unit-test-dist/src/lib/chemistry/displayHydrogens.js';
import { getAtomHydrogenCount } from '../.unit-test-dist/src/lib/atomLabels.js';
import { VALENCIES } from '../.unit-test-dist/src/lib/elements.js';

// Implicit hydrogens ChemDraw 26.1.0.6801 wrote on an unlabelled heteroatom (macOS, 2026-10-13).
// Rows are charge -> counts for [0, 1, 2, 3, 4 single bonds, then one double bond with
// 0, 1, 2, 3 single bonds]. Source: development/chemdraw-implicit-hydrogens.md.
const MEASURED = {
  N: {
    '-1': [2, 1, 0, 0, 0, 0, 0, 0, 0],
    0: [3, 2, 1, 0, 0, 1, 0, 0, 0],
    1: [4, 3, 2, 1, 0, 2, 1, 0, 0],
  },
  O: {
    '-1': [1, 0, 0, 0, 0, 0, 0, 0, 0],
    0: [2, 1, 0, 0, 0, 0, 0, 0, 0],
    1: [3, 2, 1, 0, 0, 1, 0, 0, 0],
  },
  S: {
    '-1': [1, 0, 1, 0, 1, 1, 0, 1, 0],
    0: [2, 1, 0, 1, 0, 0, 1, 0, 1],
    1: [0, 2, 1, 0, 1, 1, 0, 1, 0],
  },
  P: {
    '-1': [2, 1, 0, 1, 0, 0, 1, 0, 1],
    0: [0, 2, 1, 0, 1, 1, 0, 1, 0],
    1: [4, 3, 2, 1, 0, 2, 1, 0, 0],
  },
  B: {
    '-1': [4, 3, 2, 1, 0, 2, 1, 0, 0],
    0: [3, 2, 1, 0, 0, 1, 0, 0, 0],
    1: [0, 1, 0, 0, 0, 0, 0, 0, 0],
  },
  Cl: {
    '-1': [0, 0, 0, 0, 0, 0, 0, 0, 0],
    0: [1, 0, 1, 0, 1, 1, 0, 1, 0],
    1: [2, 1, 0, 1, 0, 0, 1, 0, 1],
  },
  Br: {
    '-1': [0, 1, 0, 0, 0, 0, 0, 0, 0],
    0: [1, 0, 1, 0, 1, 1, 0, 1, 0],
    1: [2, 1, 0, 1, 0, 0, 1, 0, 1],
  },
  I: {
    '-1': [0, 1, 0, 1, 0, 0, 1, 0, 1],
    0: [1, 0, 1, 0, 1, 1, 0, 1, 0],
    1: [2, 1, 0, 1, 0, 0, 1, 0, 1],
  },
  F: {
    '-1': [0, 0, 0, 0, 0, 0, 0, 0, 0],
    0: [1, 0, 0, 0, 0, 0, 0, 0, 0],
    1: [2, 1, 0, 0, 0, 0, 0, 0, 0],
  },
  Si: {
    '-1': [0, 2, 1, 0, 1, 1, 0, 1, 0],
    0: [4, 3, 2, 1, 0, 2, 1, 0, 0],
    1: [3, 2, 1, 0, 0, 1, 0, 0, 0],
  },
  Se: {
    '-1': [1, 0, 1, 0, 1, 1, 0, 1, 0],
    0: [2, 1, 0, 1, 0, 0, 1, 0, 1],
    1: [0, 2, 1, 0, 1, 1, 0, 1, 0],
  },
};

const SHAPES = [
  [0, 0],
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 0],
  [1, 1],
  [1, 2],
  [1, 3],
];

function build(element, charge, doubles, singles) {
  const atoms = [{ id: 'c', element, charge, x: 0, y: 0 }];
  const bonds = [];
  for (let i = 0; i < doubles + singles; i += 1) {
    atoms.push({ id: `n${i}`, element: 'C', x: 10 * (i + 1), y: 0 });
    bonds.push({ id: `b${i}`, from: 'c', to: `n${i}`, order: i < doubles ? 2 : 1 });
  }
  return { atom: atoms[0], bonds };
}

for (const [element, byCharge] of Object.entries(MEASURED)) {
  for (const [charge, expected] of Object.entries(byCharge)) {
    test(`ChemDraw hydrogen count for ${element} with charge ${charge}`, () => {
      SHAPES.forEach(([doubles, singles], i) => {
        const { atom, bonds } = build(element, Number(charge), doubles, singles);
        const label = `${element}${charge} ${doubles}d+${singles}s`;
        assert.equal(
          chemDrawImplicitHydrogens(element, Number(charge), doubles * 2 + singles),
          expected[i],
          label,
        );
        assert.equal(
          getAtomHydrogenCount(atom, bonds, VALENCIES[element] ?? null),
          expected[i],
          label,
        );
      });
    });
  }
}

test('unmeasured elements and charges fall back to the caller', () => {
  assert.equal(chemDrawImplicitHydrogens('As', 0, 1), null);
  assert.equal(chemDrawImplicitHydrogens('N', 2, 1), null);
  assert.equal(chemDrawImplicitHydrogens('N', 0, 1.5), null);
});
