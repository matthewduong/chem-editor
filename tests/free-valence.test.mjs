import test from 'node:test';
import assert from 'node:assert/strict';
import { getAtomFreeValence } from '../.unit-test-dist/src/lib/canvasChemistry.js';

const atom = (id, extra = {}) => ({ id, x: 0, y: 0, kind: 'element', element: 'C', ...extra });
const bondTo = (n, order = 1) =>
  Array.from({ length: n }, (_, i) => ({ id: `b${i}`, from: 'x', to: `n${i}`, order }));

test('neutral second-row atoms are unchanged', () => {
  assert.equal(getAtomFreeValence(atom('x'), bondTo(2)), 2);
  assert.equal(getAtomFreeValence(atom('x', { element: 'N' }), bondTo(3)), 0);
  assert.equal(getAtomFreeValence(atom('x', { element: 'O' }), bondTo(1)), 1);
});

test('charge moves the valence of single-valence elements', () => {
  assert.equal(getAtomFreeValence(atom('x', { element: 'N', charge: 1 }), bondTo(3)), 1);
  assert.equal(getAtomFreeValence(atom('x', { element: 'O', charge: -1 }), bondTo(1)), 0);
  assert.equal(getAtomFreeValence(atom('x', { element: 'B', charge: -1 }), bondTo(3)), 1);
});

test('a radical uses up valence', () => {
  assert.equal(getAtomFreeValence(atom('x', { radicalElectrons: 1 }), bondTo(3)), 0);
});

test('multi-valence and unknown elements keep their previous behaviour', () => {
  assert.equal(getAtomFreeValence(atom('x', { element: 'S' }), bondTo(2)), 0);
  assert.equal(getAtomFreeValence(atom('x', { element: 'Fe' }), bondTo(6)), 100);
});
