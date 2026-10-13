import test from 'node:test';
import assert from 'node:assert/strict';
import { bondsOfAtom, findAtomById } from '../.unit-test-dist/src/lib/graphLookup.js';

const atom = (id, x = 0) => ({ id, x, y: 0, kind: 'atom', element: 'C' });
const bond = (id, from, to) => ({ id, from, to, order: 1 });
const scan = (id, bonds) => bonds.filter((b) => b.from === id || b.to === id);

const atoms = [atom('a'), atom('b'), atom('a', 99), atom('c')];
const bonds = [bond('1', 'a', 'b'), bond('2', 'b', 'c'), bond('3', 'c', 'c'), bond('4', 'a', 'c')];

test('frozen arrays use an index that matches the plain scan exactly', () => {
  Object.freeze(bonds);
  for (const id of ['a', 'b', 'c', 'missing'])
    assert.deepEqual([...bondsOfAtom(id, bonds)], scan(id, bonds), id);
  // order is array order, and the self-bond appears once
  assert.deepEqual(
    bondsOfAtom('c', bonds).map((b) => b.id),
    ['2', '3', '4'],
  );
});

test('first atom wins on a repeated id, frozen or not', () => {
  const plain = [...atoms];
  assert.equal(findAtomById('a', plain), atoms[0]);
  Object.freeze(atoms);
  assert.equal(findAtomById('a', atoms), atoms[0]);
  assert.equal(findAtomById('missing', atoms), undefined);
});

test('an array that is not frozen is never indexed, so in-place edits stay visible', () => {
  const live = [bond('1', 'a', 'b')];
  assert.equal(bondsOfAtom('a', live).length, 1);
  live.push(bond('2', 'a', 'c'));
  assert.equal(bondsOfAtom('a', live).length, 2);
  const liveAtoms = [atom('a')];
  assert.equal(findAtomById('z', liveAtoms), undefined);
  liveAtoms.push(atom('z'));
  assert.ok(findAtomById('z', liveAtoms));
});
