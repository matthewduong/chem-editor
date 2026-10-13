import test from 'node:test';
import assert from 'node:assert/strict';
import { getNewBondAngle } from '../.unit-test-dist/src/lib/newBondAngle.js';
import { getPreferredAttachmentAngle } from '../.unit-test-dist/src/lib/ringTemplates.js';

const L = 14.4;
const deg = (r) => Math.round((r * 180) / Math.PI);
const atom = (id, x, y) => ({ id, x, y, kind: 'element', element: 'C' });
const bond = (id, from, to, extra = {}) => ({ id, from, to, order: 1, ...extra });
const polar = (x, y, degrees) => [
  x + Math.cos((degrees * Math.PI) / 180) * L,
  y + Math.sin((degrees * Math.PI) / 180) * L,
];

test('no neighbours and two or more neighbours match the existing preference', () => {
  const lone = [atom('a', 0, 0)];
  assert.equal(
    getNewBondAngle(lone[0], lone, []),
    getPreferredAttachmentAngle(lone[0], lone, [], false),
  );
  const atoms = [atom('c', 0, 0), atom('x', L, 0), atom('y', -L / 2, 12)];
  const bonds = [bond('1', 'c', 'x'), bond('2', 'c', 'y')];
  assert.equal(
    getNewBondAngle(atoms[0], atoms, bonds),
    getPreferredAttachmentAngle(atoms[0], atoms, bonds, false),
  );
});

test('a terminal atom whose neighbour has no other substituent keeps the +60 degree turn', () => {
  const atoms = [atom('a', 0, 0), atom('b', L, 0)];
  const bonds = [bond('1', 'a', 'b')];
  assert.equal(deg(getNewBondAngle(atoms[1], atoms, bonds)), 60);
});

test('repeated extension zigzags instead of curling', () => {
  const atoms = [atom('a', 0, 0), atom('b', L, 0)];
  const bonds = [bond('1', 'a', 'b')];
  const headings = [];
  for (let i = 0; i < 5; i++) {
    const last = atoms[atoms.length - 1];
    const angle = getNewBondAngle(last, atoms, bonds);
    headings.push(deg(angle));
    const [x, y] = polar(last.x, last.y, deg(angle));
    const id = `n${i}`;
    atoms.push(atom(id, x, y));
    bonds.push(bond(`b${i}`, last.id, id));
  }
  // A curling chain would be 60, 120, 180, ...; a zigzag alternates between two headings.
  assert.deepEqual(headings, [60, 0, 60, 0, 60]);
});

test('turns away from the substituent on the other side', () => {
  // b has a substituent below the chain, so the new bond from c goes above it
  const atoms = [atom('a', 0, 0), atom('b', L, 0), atom('c', 2 * L, 0), atom('s', L, -L)];
  const bonds = [bond('1', 'a', 'b'), bond('2', 'b', 'c'), bond('3', 'b', 's')];
  // b has three neighbours but c is terminal; s lies at -y, so c turns toward +y
  assert.equal(deg(getNewBondAngle(atoms[2], atoms, bonds)), 60);
  const flipped = [atom('a', 0, 0), atom('b', L, 0), atom('c', 2 * L, 0), atom('s', L, L)];
  assert.equal(deg(getNewBondAngle(flipped[2], flipped, bonds)), -60);
});

test('no preference when the neighbour has substituents on both sides', () => {
  const atoms = [atom('b', L, 0), atom('c', 2 * L, 0), atom('u', L, -L), atom('d', L, L)];
  const bonds = [bond('1', 'b', 'c'), bond('2', 'b', 'u'), bond('3', 'b', 'd')];
  assert.equal(
    getNewBondAngle(atoms[1], atoms, bonds),
    getPreferredAttachmentAngle(atoms[1], atoms, bonds, false),
  );
});

test('double after double, triple after single and single after triple are straight', () => {
  const atoms = [atom('a', 0, 0), atom('b', L, 0)];
  const straightCases = [
    [2, 2],
    [3, 3],
    [1, 3],
    [3, 1],
  ];
  for (const [before, next] of straightCases) {
    const bonds = [bond('1', 'a', 'b', { order: before })];
    assert.equal(
      deg(getNewBondAngle(atoms[1], atoms, bonds, { newBondOrder: next })),
      0,
      `${before}->${next}`,
    );
  }
  const bent = [
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 3],
  ];
  for (const [before, next] of bent) {
    const bonds = [bond('1', 'a', 'b', { order: before })];
    assert.equal(
      deg(getNewBondAngle(atoms[1], atoms, bonds, { newBondOrder: next })),
      60,
      `${before}->${next}`,
    );
  }
});

test('a wedge or hash is never drawn straight on', () => {
  const atoms = [atom('a', 0, 0), atom('b', L, 0)];
  const bonds = [bond('1', 'a', 'b', { order: 3 })];
  assert.equal(deg(getNewBondAngle(atoms[1], atoms, bonds, { newBondOrder: 1, stereo: 1 })), 60);
  const wedged = [bond('1', 'a', 'b', { order: 1, stereo: 1 })];
  assert.equal(deg(getNewBondAngle(atoms[1], atoms, wedged, { newBondOrder: 3 })), 60);
});
