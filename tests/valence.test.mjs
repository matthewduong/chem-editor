import test from 'node:test';
import assert from 'node:assert/strict';
import { allowedValences, checkValence } from '../.unit-test-dist/src/lib/chemistry/valence.js';

test('neutral p-block valences, including hypervalent states', () => {
  assert.deepEqual(allowedValences('C'), [4]);
  assert.deepEqual(allowedValences('N'), [3]);
  assert.deepEqual(allowedValences('O'), [2]);
  assert.deepEqual(allowedValences('S'), [2, 4, 6]);
  assert.deepEqual(allowedValences('P'), [3, 5]);
  assert.deepEqual(allowedValences('Cl'), [1, 3, 5, 7]);
  assert.deepEqual(allowedValences('F'), [1]);
});

test('charge follows the isoelectronic element', () => {
  assert.deepEqual(allowedValences('N', 1), [4]); // ammonium behaves as C
  assert.deepEqual(allowedValences('O', 1), [3]); // oxonium behaves as N
  assert.deepEqual(allowedValences('O', -1), [1]); // alkoxide behaves as F
  assert.deepEqual(allowedValences('B', -1), [4]);
  assert.deepEqual(allowedValences('C', -1), [3]);
  assert.deepEqual(allowedValences('S', 1), [3, 5]);
  assert.equal(allowedValences('N', 3), null);
});

test('radicals consume valence', () => {
  assert.deepEqual(allowedValences('C', 0, 1), [3]);
  assert.deepEqual(allowedValences('O', 0, 1), [1]);
});

test('variable or unknown elements never report an error', () => {
  assert.equal(allowedValences('Fe'), null);
  assert.equal(allowedValences('Xe'), null);
  assert.deepEqual(checkValence('Fe', 0, 0, 9), { ok: true, allowed: [] });
});

test('sulfone, sulfoxide and phosphate are valid; over-valent atoms are not', () => {
  assert.equal(checkValence('S', 0, 0, 6).ok, true); // R2SO2
  assert.equal(checkValence('S', 0, 0, 4).ok, true); // R2SO
  assert.equal(checkValence('P', 0, 0, 5).ok, true); // phosphate
  assert.equal(checkValence('Cl', 0, 0, 3).ok, true); // ClF3
  assert.equal(checkValence('C', 0, 0, 5).ok, false);
  assert.equal(checkValence('N', 0, 0, 4).ok, false);
  assert.equal(checkValence('N', 1, 0, 4).ok, true);
  assert.equal(checkValence('O', 0, 0, 3).ok, false);
  assert.equal(checkValence('S', 0, 0, 7).ok, false);
});

test('aromatic (fractional) bond sums are not judged', () => {
  assert.equal(checkValence('O', 0, 0, 3.5).ok, true);
});
