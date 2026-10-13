import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRingPlacement } from '../.unit-test-dist/src/lib/ringGesture.js';
import { getRegularRingGeometry } from '../.unit-test-dist/src/lib/ringTemplates.js';
import {
  stepTextDrag,
  TEXT_DRAG_THRESHOLD_PX,
} from '../.unit-test-dist/src/lib/textDragGesture.js';

const atom = (id, x, y) => ({ id, x, y, kind: 'element', element: 'C' });

test('a free ring is appended to the existing graph without changing it', () => {
  const atoms = [atom('a', 0, 0), atom('b', 14, 0)];
  const bonds = [{ id: 'x', from: 'a', to: 'b', order: 1 }];
  const placement = {
    kind: 'polygon',
    geometry: getRegularRingGeometry({ x: 100, y: 100 }, 14.4, 6),
  };
  const next = applyRingPlacement(placement, atoms, bonds);
  assert.equal(next.atoms.length, 8);
  assert.equal(next.bonds.length, 7);
  assert.deepEqual(next.atoms.slice(0, 2), atoms);
  assert.deepEqual(next.bonds[0], bonds[0]);
  assert.equal(atoms.length, 2, 'input is not mutated');
  const ids = new Set(next.atoms.map((a) => a.id));
  assert.equal(ids.size, 8);
  for (const b of next.bonds.slice(1)) assert.ok(ids.has(b.from) && ids.has(b.to));
});

test('ring size follows the geometry', () => {
  for (const size of [3, 4, 5, 6, 7, 8]) {
    const placement = {
      kind: 'polygon',
      geometry: getRegularRingGeometry({ x: 0, y: 0 }, 14.4, size),
    };
    const next = applyRingPlacement(placement, [], []);
    assert.equal(next.atoms.length, size);
    assert.equal(next.bonds.length, size);
  }
});

const drag = {
  textBoxId: 't',
  startPos: { x: 10, y: 10 },
  lastPos: { x: 10, y: 10 },
  hasMoved: false,
};

test('a text press inside the threshold is a click and never nudges the box', () => {
  assert.equal(stepTextDrag(drag, { x: 10, y: 10 }, 1), null);
  assert.equal(stepTextDrag(drag, { x: 10 + TEXT_DRAG_THRESHOLD_PX, y: 10 }, 1), null);
});

test('past the threshold the drag moves by the distance since the last step', () => {
  const first = stepTextDrag(drag, { x: 30, y: 10 }, 1);
  assert.deepEqual([first.dx, first.dy, first.drag.hasMoved], [20, 0, true]);
  const second = stepTextDrag(first.drag, { x: 35, y: 18 }, 1);
  assert.deepEqual([second.dx, second.dy], [5, 8]);
  assert.deepEqual(drag.startPos, { x: 10, y: 10 }, 'the original drag is not mutated');
});

test('the threshold is in screen pixels, so it shrinks in document units when zoomed in', () => {
  assert.equal(stepTextDrag(drag, { x: 12, y: 10 }, 1), null);
  assert.notEqual(stepTextDrag(drag, { x: 12, y: 10 }, 4), null);
  assert.equal(stepTextDrag(drag, { x: 30, y: 10 }, 0), null);
});
