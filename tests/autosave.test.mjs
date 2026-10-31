import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeAutosaveMinutes, shouldAutosave } from '../.unit-test-dist/src/lib/autosave.js';

test('autosave saves only an opened or saved CDXML file with changes, when it is on', () => {
  const file = { path: '/a.cdxml', format: 'cdxml', dirty: true };
  assert.equal(shouldAutosave(5, file), true);
  assert.equal(shouldAutosave(0, file), false);
  assert.equal(shouldAutosave(5, { ...file, dirty: false }), false);
  assert.equal(shouldAutosave(5, { ...file, path: null }), false);
  assert.equal(shouldAutosave(5, { ...file, format: null }), false);
});

test('the autosave interval is whole minutes, off by default', () => {
  assert.equal(normalizeAutosaveMinutes(undefined), 0);
  assert.equal(normalizeAutosaveMinutes(2.6), 3);
  assert.equal(normalizeAutosaveMinutes(-1), 0);
  assert.equal(normalizeAutosaveMinutes(1e9), 1440);
});
