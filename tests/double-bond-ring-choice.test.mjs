import test from 'node:test';
import assert from 'node:assert/strict';
import { computeRingCentroids } from '../.unit-test-dist/src/lib/renderGeometry.js';

// Which ring a fusion double bond's inner line goes in, as ChemDraw 26.1.0.6801 draws it
// (macOS, 2026-10-13): rendered to PDF and read back, 196 bicyclic skeletons. The shared bond is
// vertical, from (0,0) down to (0,L); ring A is to its left, ring B to its right.
const L = 14.4;

function ringAtoms(prefix, n, dir, doubles, hetero) {
  const R = L / (2 * Math.sin(Math.PI / n));
  const cx = dir * R * Math.cos(Math.PI / n);
  const cy = L / 2;
  const a0 = Math.atan2(0 - cy, 0 - cx);
  const a1 = Math.atan2(L - cy, 0 - cx);
  const step = (2 * Math.PI) / n;
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const sgn = Math.abs(wrap(a0 + (n - 1) * step - a1)) < 1e-6 ? 1 : -1;
  const atoms = [];
  const ids = ['s1'];
  for (let k = 1; k <= n - 2; k += 1) {
    const ang = a0 + sgn * step * k;
    const id = `${prefix}${k}`;
    atoms.push({
      id,
      element: hetero === k ? 'N' : 'C',
      x: cx + R * Math.cos(ang),
      y: cy + R * Math.sin(ang),
    });
    ids.push(id);
  }
  ids.push('s2');
  const bonds = [];
  for (let k = 0; k < ids.length - 1; k += 1)
    bonds.push({
      id: `${prefix}b${k}`,
      from: ids[k],
      to: ids[k + 1],
      order: doubles.includes(k) ? 2 : 1,
    });
  return { atoms, bonds };
}

/** Returns 'A' or 'B': the ring whose centroid the shared bond's inner line is drawn towards. */
function winner({ na, nb, pa, pb, hetA = 0, hetB = 0, reversed = false }) {
  const A = ringAtoms('a', na, -1, pa, hetA);
  const B = ringAtoms('b', nb, 1, pb, hetB);
  const atoms = [
    { id: 's1', element: 'C', x: 0, y: 0 },
    { id: 's2', element: 'C', x: 0, y: L },
    ...A.atoms,
    ...B.atoms,
  ];
  const shared = reversed
    ? { id: 'shared', from: 's2', to: 's1', order: 2 }
    : { id: 'shared', from: 's1', to: 's2', order: 2 };
  const bonds = [shared, ...A.bonds, ...B.bonds];
  const centroid = computeRingCentroids(atoms, bonds).get('shared');
  assert.ok(centroid, 'the shared bond is in a ring');
  assert.equal(centroid.n, centroid.cx < 0 ? na : nb);
  return centroid.cx < 0 ? 'A' : 'B';
}

test('more double bonds in a ring wins, whatever the ring sizes', () => {
  assert.equal(winner({ na: 6, nb: 5, pa: [1, 3], pb: [] }), 'A');
  assert.equal(winner({ na: 5, nb: 6, pa: [], pb: [1, 3] }), 'B');
  assert.equal(winner({ na: 6, nb: 7, pa: [2], pb: [] }), 'A'); // a lone non-conjugated one still counts
});

test('equal counts: the ring whose double bond is conjugated with the shared bond wins', () => {
  assert.equal(winner({ na: 6, nb: 6, pa: [1], pb: [2] }), 'A');
  assert.equal(winner({ na: 6, nb: 6, pa: [2], pb: [1] }), 'B');
  assert.equal(winner({ na: 6, nb: 7, pa: [1], pb: [3] }), 'A');
  assert.equal(winner({ na: 6, nb: 7, pa: [3], pb: [2] }), 'A');
});

test('a full tie goes to the ring on the left of the bond direction, and reversing flips it', () => {
  // The shared bond runs downwards; ring B is to the left of that direction on a y-down canvas.
  assert.equal(winner({ na: 6, nb: 6, pa: [], pb: [] }), 'B');
  assert.equal(winner({ na: 6, nb: 6, pa: [1], pb: [1] }), 'B');
  assert.equal(winner({ na: 6, nb: 6, pa: [2], pb: [2] }), 'B');
  assert.equal(winner({ na: 6, nb: 6, pa: [], pb: [], reversed: true }), 'A');
  assert.equal(winner({ na: 5, nb: 7, pa: [1], pb: [1], reversed: true }), 'A');
});

test('a heteroatom does not decide the ring', () => {
  assert.equal(winner({ na: 6, nb: 6, pa: [1], pb: [2], hetA: 2 }), 'A');
  assert.equal(winner({ na: 6, nb: 6, pa: [1], pb: [2], hetB: 2 }), 'A');
  assert.equal(winner({ na: 6, nb: 6, pa: [], pb: [], hetA: 2 }), 'B');
});

test('double bonds in rings above 8 atoms get an inside-the-ring centroid', () => {
  const n = 18;
  const R = L / (2 * Math.sin(Math.PI / n));
  const atoms = Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    element: 'C',
    x: R * Math.cos((2 * Math.PI * i) / n),
    y: R * Math.sin((2 * Math.PI * i) / n),
  }));
  const bonds = atoms.map((a, i) => ({
    id: `b${i}`,
    from: a.id,
    to: atoms[(i + 1) % n].id,
    order: i % 2 === 0 ? 2 : 1,
  }));
  const rings = computeRingCentroids(atoms, bonds);
  assert.equal(rings.get('b0').n, 18);
  assert.ok(Math.hypot(rings.get('b0').cx, rings.get('b0').cy) < 1e-6);
  assert.equal(rings.has('b1'), false, 'single bonds keep the eight-atom cap');
});
