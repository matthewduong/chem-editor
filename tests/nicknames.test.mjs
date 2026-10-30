import test from 'node:test';
import assert from 'node:assert/strict';

import {
  contractSelection,
  findNicknameForSelection,
} from '../.unit-test-dist/src/lib/nicknames.js';

const atom = (id, element, x = 0) => ({ id, x, y: 0, kind: 'element', element });
const bond = (id, from, to, order = 1) => ({ id, from, to, order });

// Benzene ring carbon bonded to an O-CH3 group.
const atoms = [atom('r', 'C'), atom('o', 'O', 10), atom('m', 'C', 20)];
const bonds = [bond('b1', 'r', 'o'), bond('b2', 'o', 'm')];

test('a selected group joined by one bond is matched to its nickname, rooted at that bond', () => {
  const plan = findNicknameForSelection(atoms, bonds, new Set(['o', 'm']));
  assert.equal(plan.rootId, 'o');
  assert.equal(plan.externalBondId, 'b1');
  assert.equal(plan.alias, 'OMe');
});

test('contracting keeps the root as the labelled atom and drops the rest of the group', () => {
  const state = { atoms, bonds, arrows: [], groups: [], textBoxes: [] };
  const selected = new Set(['o', 'm']);
  const next = contractSelection(state, selected, findNicknameForSelection(atoms, bonds, selected));
  assert.deepEqual(
    next.atoms.map((a) => a.id),
    ['r', 'o'],
  );
  assert.equal(next.atoms[1].alias, 'OMe');
  assert.deepEqual(
    next.bonds.map((b) => b.id),
    ['b1'],
  );
});

test('a group joined by two bonds cannot become a label', () => {
  const ring = [...bonds, bond('b3', 'm', 'r')];
  assert.ok('error' in findNicknameForSelection(atoms, ring, new Set(['o', 'm'])));
});
