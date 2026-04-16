import test from 'node:test';
import assert from 'node:assert/strict';

import { getAtomDisplayText, getAtomHydrogenCount } from '../.unit-test-dist/src/lib/atomLabels.js';
import { VALENCIES } from '../.unit-test-dist/src/lib/elements.js';
import { getAtomBondClipOffset } from '../.unit-test-dist/src/lib/renderGeometry.js';

function approxEqual(actual, expected, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

test('heteroatom bond clipping stays consistent across angles', () => {
  const atom = { id: 'o1', x: 0, y: 0, kind: 'element', element: 'O' };
  const atoms = [atom];
  const bonds = [];

  const horizontal = getAtomBondClipOffset(atom, atoms, bonds, 1, 0);
  const vertical = getAtomBondClipOffset(atom, atoms, bonds, 0, 1);
  const diagonal = getAtomBondClipOffset(atom, atoms, bonds, Math.SQRT1_2, Math.SQRT1_2);

  approxEqual(horizontal, vertical);
  approxEqual(horizontal, diagonal);
});

test('ring nitrogen bond clipping stays symmetric around the anchored N label', () => {
  const atoms = [
    { id: 'n1', x: 0, y: 0, kind: 'element', element: 'N' },
    { id: 'c1', x: -30, y: -24, kind: 'element', element: 'C' },
    { id: 'c2', x: -30, y: 24, kind: 'element', element: 'C' },
  ];
  const bonds = [
    { id: 'b1', from: 'n1', to: 'c1', order: 1, stereo: 0 },
    { id: 'b2', from: 'n1', to: 'c2', order: 1, stereo: 0 },
  ];
  const nitrogen = atoms[0];

  const dx1 = atoms[1].x - nitrogen.x;
  const dy1 = atoms[1].y - nitrogen.y;
  const len1 = Math.hypot(dx1, dy1);
  const dx2 = atoms[2].x - nitrogen.x;
  const dy2 = atoms[2].y - nitrogen.y;
  const len2 = Math.hypot(dx2, dy2);

  const clip1 = getAtomBondClipOffset(nitrogen, atoms, bonds, dx1 / len1, dy1 / len1);
  const clip2 = getAtomBondClipOffset(nitrogen, atoms, bonds, dx2 / len2, dy2 / len2);

  approxEqual(clip1, clip2);
});

test('ring-embedded NTs shorthand does not show a built-in NH label', () => {
  const atoms = [
    { id: 'n1', x: 0, y: 0, kind: 'alias', element: 'N', alias: 'NTs' },
    { id: 'c1', x: -30, y: -24, kind: 'element', element: 'C' },
    { id: 'c2', x: -30, y: 24, kind: 'element', element: 'C' },
  ];
  const bonds = [
    { id: 'b1', from: 'n1', to: 'c1', order: 1, stereo: 0 },
    { id: 'b2', from: 'n1', to: 'c2', order: 1, stereo: 0 },
  ];
  const hydrogenCount = getAtomHydrogenCount(atoms[0], bonds, VALENCIES.N ?? null);
  const label = getAtomDisplayText(atoms[0], atoms, bonds, hydrogenCount).text;

  assert.equal(hydrogenCount, 0);
  assert.equal(label, 'NTs');
});

test('monosubstituted NTs shorthand keeps the built-in NH label', () => {
  const atoms = [
    { id: 'n1', x: 0, y: 0, kind: 'alias', element: 'N', alias: 'NTs' },
    { id: 'c1', x: -40, y: 0, kind: 'element', element: 'C' },
  ];
  const bonds = [{ id: 'b1', from: 'n1', to: 'c1', order: 1, stereo: 0 }];
  const hydrogenCount = getAtomHydrogenCount(atoms[0], bonds, VALENCIES.N ?? null);
  const label = getAtomDisplayText(atoms[0], atoms, bonds, hydrogenCount).text;

  assert.equal(hydrogenCount, 0);
  assert.equal(label, 'NHTs');
});
