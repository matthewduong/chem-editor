import test from 'node:test';
import assert from 'node:assert/strict';

import {
  arrowUsesControlPoint,
  getArrowLabelAnchors,
  getArrowSelectionPoints,
} from '../.unit-test-dist/src/lib/renderGeometry.js';

test('straight arrows only use the control point when bend mode is enabled', () => {
  assert.equal(arrowUsesControlPoint({ type: 'reaction' }), false);
  assert.equal(arrowUsesControlPoint({ type: 'reaction', curveEnabled: true }), true);
  assert.equal(arrowUsesControlPoint({ type: 'curved' }), true);
});

test('curved arrow label anchors and selection points follow the bent geometry', () => {
  const arrow = {
    type: 'reaction',
    x1: 0,
    y1: 0,
    x2: 20,
    y2: 0,
    cpx: 10,
    cpy: -10,
    curveEnabled: true,
  };

  const anchors = getArrowLabelAnchors(arrow, 10);
  assert.ok(anchors.above.y < 0, 'expected the above label to sit above the bent arrow');

  const points = getArrowSelectionPoints(arrow);
  assert.deepEqual(points, [
    { x: 0, y: 0 },
    { x: 10, y: -10 },
    { x: 20, y: 0 },
  ]);
});
