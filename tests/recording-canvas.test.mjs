import test from 'node:test';
import assert from 'node:assert/strict';

import { createRecordingContext, normalizeOps } from '../scripts/lib/recording-canvas.mjs';

test('records calls and property assignments in order', () => {
  const ctx = createRecordingContext();
  ctx.strokeStyle = '#ff0000';
  ctx.beginPath();
  ctx.moveTo(1, 2);
  ctx.lineTo(3, 4);
  ctx.stroke();

  assert.deepEqual(ctx.__ops, [
    { op: 'set', prop: 'strokeStyle', value: '#ff0000' },
    { op: 'call', name: 'beginPath', args: [] },
    { op: 'call', name: 'moveTo', args: [1, 2] },
    { op: 'call', name: 'lineTo', args: [3, 4] },
    { op: 'call', name: 'stroke', args: [] },
  ]);
});

test('rounds floats and collapses negative zero so goldens do not churn', () => {
  const ctx = createRecordingContext();
  ctx.moveTo(0.1 + 0.2, -0);
  ctx.lineWidth = 1 / 3;

  assert.deepEqual(ctx.__ops[0].args, [0.3, 0]);
  assert.equal(ctx.__ops[1].value, 0.3333);
});

test('throws on an unmodelled context member rather than dropping it', () => {
  const ctx = createRecordingContext();
  // A module reaching for a feature the recorder does not model must fail the suite, not
  // silently weaken every golden that covers it.
  assert.throws(() => ctx.bezierCurveTo(1, 2, 3, 4, 5, 6), /unmodelled read of ctx\.bezierCurveTo/);
  assert.throws(() => {
    ctx.miterLimit = 4;
  }, /unmodelled write to ctx\.miterLimit/);
});

test('normalization drops redundant style writes but keeps real changes', () => {
  const ctx = createRecordingContext();
  ctx.strokeStyle = '#000000';
  ctx.strokeStyle = '#000000';
  ctx.moveTo(0, 0);
  ctx.strokeStyle = '#ff0000';

  const normalized = normalizeOps(ctx.__ops);
  assert.deepEqual(normalized, [
    { op: 'set', prop: 'strokeStyle', value: '#000000' },
    { op: 'call', name: 'moveTo', args: [0, 0] },
    { op: 'set', prop: 'strokeStyle', value: '#ff0000' },
  ]);
});

test('normalization tracks save/restore so a restored value stays a no-op', () => {
  const ctx = createRecordingContext();
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.restore();
  // restore() puts the context back at 1, so assigning 1 again really is redundant.
  ctx.globalAlpha = 1;

  assert.deepEqual(
    normalizeOps(ctx.__ops).filter((entry) => entry.op === 'set'),
    [
      { op: 'set', prop: 'globalAlpha', value: 1 },
      { op: 'set', prop: 'globalAlpha', value: 0.5 },
    ],
  );
});

test('normalization re-emits a write that restore() reverted away from', () => {
  const ctx = createRecordingContext();
  ctx.globalAlpha = 0.5;
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.restore();
  // restore() reverted to 0.5, so this assignment genuinely changes the context and must survive.
  ctx.globalAlpha = 1;

  assert.deepEqual(
    normalizeOps(ctx.__ops).filter((entry) => entry.op === 'set'),
    [
      { op: 'set', prop: 'globalAlpha', value: 0.5 },
      { op: 'set', prop: 'globalAlpha', value: 1 },
      { op: 'set', prop: 'globalAlpha', value: 1 },
    ],
  );
});
