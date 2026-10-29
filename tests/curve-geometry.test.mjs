import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cubicPointAt,
  curveAnchors,
  curveSegments,
  trimCubic,
} from '../.unit-test-dist/src/lib/curveGeometry.js';

const pts = (...values) => {
  const out = [];
  for (let i = 0; i < values.length; i += 2) out.push({ x: values[i], y: values[i + 1] });
  return out;
};

test('an open curve runs between the middle points of its first and last triples', () => {
  // Three anchors, each written as (incoming control, anchor, outgoing control).
  const points = pts(-5, 0, 0, 0, 5, 0, 15, 5, 20, 5, 25, 5, 35, 0, 40, 0, 45, 0);
  assert.deepEqual(curveAnchors(points), pts(0, 0, 20, 5, 40, 0));
  const segments = curveSegments(points, false);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[0], { p0: points[1], c1: points[2], c2: points[3], p3: points[4] });
  assert.deepEqual(cubicPointAt(segments[1], 1), { x: 40, y: 0 });
});

test('a closed curve joins its last anchor back to the first', () => {
  const points = pts(-5, 0, 0, 0, 5, 0, 15, 5, 20, 5, 25, 5);
  const segments = curveSegments(points, true);
  assert.equal(segments.length, 2);
  assert.deepEqual(segments[1], { p0: points[4], c1: points[5], c2: points[0], p3: points[1] });
});

test('a point list not in triples draws as a polyline', () => {
  const segments = curveSegments(pts(0, 0, 10, 0, 10, 10, 0, 10), false);
  assert.equal(segments.length, 3);
  assert.deepEqual(segments[2].p3, { x: 0, y: 10 });
});

test('trimming stops the curve the requested distance short of its end', () => {
  const [segment] = curveSegments(pts(0, 0, 0, 0, 10, 0, 90, 0, 100, 0, 100, 0), false);
  const trimmed = trimCubic(segment, true, 8);
  assert.ok(Math.abs(trimmed.p3.x - 92) < 1e-3, `ended at ${trimmed.p3.x}`);
  assert.deepEqual(trimmed.p0, { x: 0, y: 0 });
  const fromStart = trimCubic(segment, false, 8);
  assert.ok(Math.abs(fromStart.p0.x - 8) < 1e-3);
});
