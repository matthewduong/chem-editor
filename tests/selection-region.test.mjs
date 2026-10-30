import test from 'node:test';
import assert from 'node:assert/strict';

import { pointInPolygon, selectEnclosed } from '../.unit-test-dist/src/lib/selectionRegion.js';

const loop = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 50, y: 40 },
  { x: 0, y: 100 },
];
const inside = (point) => pointInPolygon(point, loop);

test('point in polygon follows a concave outline', () => {
  assert.equal(inside({ x: 50, y: 20 }), true);
  assert.equal(inside({ x: 50, y: 80 }), false, 'the notch is outside');
  assert.equal(inside({ x: 150, y: 50 }), false);
});

test('a lasso takes only what lies entirely within it', () => {
  const atoms = [
    { id: 'a', x: 20, y: 10, kind: 'element', element: 'C' },
    { id: 'b', x: 80, y: 10, kind: 'element', element: 'C' },
    { id: 'c', x: 50, y: 80, kind: 'element', element: 'C' },
  ];
  const bonds = [
    { id: 'ab', from: 'a', to: 'b', order: 1 },
    { id: 'bc', from: 'b', to: 'c', order: 1 },
  ];
  const arrows = [{ id: 'r', type: 'reaction', x1: 10, y1: 5, x2: 90, y2: 5, cpx: 50, cpy: 5 }];
  const objects = [
    {
      id: 'in',
      type: 'graphic',
      graphicType: 'rectangle',
      bounds: { left: 30, top: 15, right: 70, bottom: 25 },
    },
    {
      id: 'half',
      type: 'graphic',
      graphicType: 'rectangle',
      bounds: { left: 80, top: 50, right: 120, bottom: 60 },
    },
  ];
  const caught = selectEnclosed(inside, { atoms, bonds, arrows, textBoxes: [], objects });
  assert.deepEqual(caught.atomIds, ['a', 'b']);
  assert.deepEqual(caught.bondIds, ['ab']);
  assert.deepEqual(caught.arrowIds, ['r']);
  assert.deepEqual(caught.objectIds, ['in']);
});
