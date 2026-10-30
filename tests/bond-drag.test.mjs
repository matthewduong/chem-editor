import test from 'node:test';
import assert from 'node:assert/strict';

import { bondDragEnd } from '../.unit-test-dist/src/lib/newBondAngle.js';
import { chainPoints } from '../.unit-test-dist/src/lib/chain.js';

const start = { x: 0, y: 0 };
const pointer = { x: 30, y: 7 };

test('fixed lengths and angles snap a dragged bond to one bond length on a 15° step', () => {
  const end = bondDragEnd(start, pointer, 14.4, { fixedLengths: true, fixedAngles: true });
  assert.ok(Math.abs(Math.hypot(end.x, end.y) - 14.4) < 1e-9);
  const degrees = (Math.atan2(end.y, end.x) * 180) / Math.PI;
  assert.ok(Math.abs(degrees / 15 - Math.round(degrees / 15)) < 1e-9);
});

test('each toggle releases only its own constraint, and Alt releases both', () => {
  const freeAngle = bondDragEnd(start, pointer, 14.4, { fixedLengths: true, fixedAngles: false });
  assert.ok(Math.abs(Math.atan2(freeAngle.y, freeAngle.x) - Math.atan2(7, 30)) < 1e-9);
  assert.ok(Math.abs(Math.hypot(freeAngle.x, freeAngle.y) - 14.4) < 1e-9);
  const freeLength = bondDragEnd(start, pointer, 14.4, { fixedLengths: false, fixedAngles: true });
  assert.ok(Math.abs(Math.hypot(freeLength.x, freeLength.y) - Math.hypot(30, 7)) < 1e-9);
  const free = bondDragEnd(start, pointer, 14.4, {
    fixedLengths: true,
    fixedAngles: true,
    free: true,
  });
  assert.ok(Math.hypot(free.x - pointer.x, free.y - pointer.y) < 1e-9);
});

test('a typed chain zigzags 30° either side of its axis', () => {
  const points = chainPoints(start, 0, 3, 10);
  assert.equal(points.length, 4);
  assert.ok(points[1].y > 0 && points[2].y < points[1].y);
  assert.ok(Math.abs(points[2].y) < 1e-9);
});

test('dragging along a bond cycles single, double, triple, quadruple, single', async () => {
  const { nextBondOrder } = await import('../.unit-test-dist/src/lib/renderGeometry.js');
  assert.deepEqual([1, 2, 3, 4].map(nextBondOrder), [2, 3, 4, 1]);
});

test('V2000 bond types: aromatic is 4, a quadruple bond goes out single', async () => {
  const { molfileBondType } = await import('../.unit-test-dist/src/lib/graph.js');
  assert.deepEqual([1, 2, 3, 1.5, 4].map(molfileBondType), [1, 2, 3, 4, 1]);
});
