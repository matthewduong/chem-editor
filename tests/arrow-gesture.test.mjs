import test from 'node:test';
import assert from 'node:assert/strict';
import {
  arrowDragGeometry,
  isArrowLongEnough,
  MIN_ARROW_LENGTH,
} from '../.unit-test-dist/src/lib/arrowGesture.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !~ ${b}`);

test('straight arrows snap to 15 degrees and keep the drag length', () => {
  // 10 degrees off the x axis snaps to 15
  const len = 100;
  const raw = (10 * Math.PI) / 180;
  const g = arrowDragGeometry(
    'solid',
    { x: 0, y: 0 },
    { x: Math.cos(raw) * len, y: Math.sin(raw) * len },
  );
  near(Math.hypot(g.x2, g.y2), len);
  near(Math.atan2(g.y2, g.x2), (15 * Math.PI) / 180);
  near(g.cpx, g.x2 / 2);
  near(g.cpy, g.y2 / 2);
});

test('curved arrows follow the pointer and derive a control point', () => {
  const g = arrowDragGeometry('curved', { x: 0, y: 0 }, { x: 40, y: 30 });
  assert.equal(g.x2, 40);
  assert.equal(g.y2, 30);
  assert.ok(g.cpx !== 20 || g.cpy !== 15, 'control point leaves the chord midpoint');
});

test('a drag at or under the minimum length is a click', () => {
  assert.equal(isArrowLongEnough({ x1: 0, y1: 0, x2: MIN_ARROW_LENGTH, y2: 0 }), false);
  assert.equal(isArrowLongEnough({ x1: 0, y1: 0, x2: MIN_ARROW_LENGTH + 0.5, y2: 0 }), true);
});

test('a connecting arrow starts at the nearest end or middle of an arrow', async () => {
  const { arrowConnectionPoint } = await import('../.unit-test-dist/src/lib/arrowGesture.js');
  const straight = { type: 'reaction', x1: 0, y1: 0, x2: 40, y2: 0, cpx: 0, cpy: 0 };
  assert.deepEqual(arrowConnectionPoint({ x: 21, y: 3 }, [straight], 8), { x: 20, y: 0 });
  assert.deepEqual(arrowConnectionPoint({ x: 38, y: -2 }, [straight], 8), { x: 40, y: 0 });
  assert.equal(arrowConnectionPoint({ x: 10, y: 0 }, [straight], 8), null);
  // A curved arrow's middle is on its curve.
  const curved = { type: 'curved', x1: 0, y1: 0, x2: 40, y2: 0, cpx: 20, cpy: -20 };
  assert.deepEqual(arrowConnectionPoint({ x: 20, y: -9 }, [curved], 8), { x: 20, y: -10 });
});
