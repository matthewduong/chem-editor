import test from 'node:test';
import assert from 'node:assert/strict';
import { chainGeometry, materializeChain } from '../.unit-test-dist/src/lib/chain.js';
import { ToolLifecycle } from '../.unit-test-dist/src/editor/toolLifecycle.js';

test('chain projection, zigzag bond lengths and click threshold', () => {
  assert.equal(chainGeometry({ x: 0, y: 0 }, { x: 2, y: 0 }, 30).length, 1);
  const points = chainGeometry({ x: 0, y: 0 }, { x: 110, y: 0 }, 30);
  assert.equal(points.length, 5);
  for (let i = 1; i < points.length; i++)
    assert.ok(
      Math.abs(Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y) - 30) <
        1e-10,
    );
  let id = 0;
  const result = materializeChain(points, [], [], undefined, undefined, () => String(++id));
  assert.equal(result.atoms.length, 5);
  assert.equal(result.bonds.length, 4);
  assert.deepEqual(
    result.atoms.map(({ x, y }) => ({ x, y })),
    points,
  );
});
test('chain attachment preserves IDs and rejects duplicate or self-bonds', () => {
  const atoms = [
    { id: 'a', x: 0, y: 0, element: 'C' },
    { id: 'b', x: 30, y: 0, element: 'C' },
  ];
  const bonds = [{ id: 'bond', from: 'a', to: 'b', order: 1 }];
  const points = [
    { x: 0, y: 0 },
    { x: 30, y: 0 },
  ];
  assert.throws(() => materializeChain(points, atoms, bonds, 'a', 'b'), /duplicate/);
  assert.throws(() => materializeChain(points, atoms, bonds, 'a', 'a'), /self-bond/);
  const result = materializeChain([...points, { x: 40, y: 30 }], atoms, bonds, 'a', 'b');
  assert.equal(result.atoms.length, 3);
  assert.equal(result.atoms[0], atoms[0]);
  assert.equal(result.bonds[0], bonds[0]);
});
test('lifecycle ignores late commits after cancellation and document replacement', () => {
  const lifecycle = new ToolLifecycle();
  const source = {},
    event = { point: { x: 0, y: 0 }, hit: null, modifiers: { primary: false, shift: false } };
  lifecycle.begin(source, event);
  lifecycle.cancel();
  assert.equal(lifecycle.commit(source), null);
  lifecycle.begin(source, event);
  assert.equal(lifecycle.commit({}), null);
  lifecycle.begin(source, event);
  const latest = { ...event, point: { x: 10, y: 20 } };
  lifecycle.update(latest);
  assert.equal(lifecycle.commit(source).latest, latest);
  assert.equal(lifecycle.commit(source), null);
});
