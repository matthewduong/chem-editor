import test from 'node:test';
import assert from 'node:assert/strict';

import {
  VIEWER_DEFAULT_BACKGROUND_DARK,
  VIEWER_DEFAULT_BACKGROUND_LIGHT,
  alignViewerMoleculeToReference,
  resolveViewerBackgroundColor,
  viewer3dFitDistance,
  viewer3dHasMatchingTopology,
  viewer3dVisualBounds,
} from '../.unit-test-dist/src/lib/viewer3d.js';

function approxEqual(actual, expected, epsilon = 1e-5) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function makeMolecule(atoms) {
  return {
    atoms,
    bonds: [
      { a1: 0, a2: 1, order: 1 },
      { a1: 1, a2: 2, order: 1 },
    ],
  };
}

test('viewer background defaults follow the current theme', () => {
  assert.equal(
    resolveViewerBackgroundColor(VIEWER_DEFAULT_BACKGROUND_LIGHT, true),
    VIEWER_DEFAULT_BACKGROUND_DARK,
  );
  assert.equal(
    resolveViewerBackgroundColor(VIEWER_DEFAULT_BACKGROUND_DARK, false),
    VIEWER_DEFAULT_BACKGROUND_LIGHT,
  );
  assert.equal(resolveViewerBackgroundColor('#112233', true), '#112233');
});

test('fit distance grows when the field of view gets tighter', () => {
  const wide = viewer3dFitDistance(3, 40, 1);
  const narrow = viewer3dFitDistance(3, 18, 1);
  assert.ok(narrow > wide);
});

test('visual bounds include atom radii, not just atom centers', () => {
  const bounds = viewer3dVisualBounds(
    [
      { x: 0, y: 0, z: 0, element: 'C' },
      { x: 4, y: 0, z: 0, element: 'O' },
    ],
    1,
  );
  assert.ok(bounds.radius > 2);
  assert.ok(bounds.center.x > 1.5 && bounds.center.x < 2.5);
});

test('topology matching compares indexed atoms and bonds', () => {
  const reference = makeMolecule([
    { x: 0, y: 0, z: 0, element: 'C' },
    { x: 1, y: 0, z: 0, element: 'N' },
    { x: 0, y: 1, z: 0, element: 'O' },
  ]);
  const same = makeMolecule([
    { x: 2, y: -2, z: 1, element: 'C' },
    { x: 3, y: -2, z: 1, element: 'N' },
    { x: 2, y: -1, z: 1, element: 'O' },
  ]);
  const different = makeMolecule([
    { x: 2, y: -2, z: 1, element: 'C' },
    { x: 3, y: -2, z: 1, element: 'C' },
    { x: 2, y: -1, z: 1, element: 'O' },
  ]);

  assert.equal(viewer3dHasMatchingTopology(reference, same), true);
  assert.equal(viewer3dHasMatchingTopology(reference, different), false);
});

test('conformer alignment maps rotated coordinates back onto the previous view', () => {
  const reference = makeMolecule([
    { x: 0, y: 0, z: 0, element: 'C' },
    { x: 1.5, y: 0, z: 0, element: 'N' },
    { x: 0.2, y: 1.2, z: 0.5, element: 'O' },
  ]);
  const candidate = makeMolecule([
    { x: 5, y: -1, z: 2, element: 'C' },
    { x: 5, y: 0.5, z: 2, element: 'N' },
    { x: 3.8, y: -0.8, z: 2.5, element: 'O' },
  ]);

  const aligned = alignViewerMoleculeToReference(reference, candidate);
  aligned.atoms.forEach((atom, index) => {
    approxEqual(atom.x, reference.atoms[index].x);
    approxEqual(atom.y, reference.atoms[index].y);
    approxEqual(atom.z, reference.atoms[index].z);
  });
});
