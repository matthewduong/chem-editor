import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelGestures, ToolLifecycle } from '../.unit-test-dist/src/editor/toolLifecycle.js';

const input = (x = 0) => ({
  point: { x, y: 0 },
  hit: null,
  modifiers: { primary: false, shift: false },
});

test('commit returns the press only for the document it began on', () => {
  const lifecycle = new ToolLifecycle();
  const a = {};
  lifecycle.begin(a, input(1));
  lifecycle.update(input(5));
  const done = lifecycle.commit(a);
  assert.equal(done.start.point.x, 1);
  assert.equal(done.latest.point.x, 5);

  lifecycle.begin(a, input());
  assert.equal(lifecycle.commit({}), null, 'a replaced document discards the press');
  assert.equal(lifecycle.commit(a), null, 'and the press is over');
});

test('cancel and a second commit both leave nothing to commit', () => {
  const lifecycle = new ToolLifecycle();
  const doc = {};
  lifecycle.begin(doc, input());
  lifecycle.cancel();
  assert.equal(lifecycle.commit(doc), null);
  lifecycle.begin(doc, input());
  assert.notEqual(lifecycle.commit(doc), null);
  assert.equal(lifecycle.commit(doc), null);
});

test('cancelGestures cancels every tool, once each, in order', () => {
  const calls = [];
  const tool = (name) => ({ cancel: () => calls.push(name) });
  cancelGestures([tool('chain'), tool('ring'), tool('arrow')]);
  assert.deepEqual(calls, ['chain', 'ring', 'arrow']);
  cancelGestures([]);
  assert.equal(calls.length, 3);
});
