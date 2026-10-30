import test from 'node:test';
import assert from 'node:assert/strict';

import { applyShapeHandle, getShapeHandles } from '../.unit-test-dist/src/lib/shapeHandles.js';
import { createBoxShapeGraphic, createArcArrow } from '../.unit-test-dist/src/lib/shapeGesture.js';
import { arcPointAt, resolveArcArrow } from '../.unit-test-dist/src/lib/arrowArc.js';

const close = (a, b) => Math.abs(a - b) < 1e-6;
const rect = createBoxShapeGraphic('r', 'rectangle', {
  center: { x: 50, y: 50 },
  halfWidth: 20,
  halfHeight: 10,
});

test('a side handle stretches one side and leaves the opposite one', () => {
  const stretched = applyShapeHandle(rect, 'e', { x: 100, y: 999 });
  assert.ok(close(stretched.bounds.left, 30));
  assert.ok(close(stretched.bounds.right, 100));
  assert.ok(close(stretched.bounds.top, 40));
});

test('a corner handle scales both sides about the opposite corner, in proportion', () => {
  const grown = applyShapeHandle(rect, 'se', { x: 110, y: 90 });
  assert.ok(close(grown.bounds.left, 30) && close(grown.bounds.top, 40));
  const width = grown.bounds.right - grown.bounds.left;
  const height = grown.bounds.bottom - grown.bounds.top;
  assert.ok(close(width / height, 2), `aspect ${width / height}`);
});

test('a circle has one radius handle and stays round', () => {
  const circle = createBoxShapeGraphic('c', 'circle', {
    center: { x: 0, y: 0 },
    halfWidth: 5,
    halfHeight: 5,
  });
  assert.deepEqual(
    getShapeHandles(circle).map((h) => h.id),
    ['radius'],
  );
  const bigger = applyShapeHandle(circle, 'radius', { x: 0, y: 12 });
  assert.ok(close(bigger.bounds.right, 12) && close(bigger.bounds.bottom, 12));
});

test('a rotated rectangle stretches along its own side', () => {
  const rotated = {
    ...rect,
    majorAxisEnd: { x: 50, y: 70 },
    minorAxisEnd: { x: 40, y: 50 },
  };
  const longer = applyShapeHandle(rotated, 'e', { x: 50, y: 90 });
  assert.ok(
    close(
      Math.hypot(longer.majorAxisEnd.x - longer.center.x, longer.majorAxisEnd.y - longer.center.y),
      30,
    ),
  );
});

test('arc ends move the arc; its middle sets the curvature on the side dragged', () => {
  const arc = createArcArrow('a', 90, { x: 0, y: 0 }, { x: 100, y: 0 });
  const moved = applyShapeHandle(arc, 'head', { x: 120, y: 0 });
  assert.equal(moved.angularSize, -90);
  assert.ok(close(arcPointAt(resolveArcArrow(moved), 1).x, 120));
  const deeper = applyShapeHandle(arc, 'mid', { x: 50, y: -50 });
  assert.ok(close(Math.abs(deeper.angularSize), 180));
  const flipped = applyShapeHandle(arc, 'mid', { x: 50, y: 30 });
  assert.ok(flipped.angularSize > 0, 'dragged to the other side, it bulges the other way');
  assert.ok(arcPointAt(resolveArcArrow(flipped), 0.5).y > 0);
});
