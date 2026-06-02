import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getRegularRingGeometry,
  resolveRingTemplatePlacement,
} from '../.unit-test-dist/src/lib/ringTemplates.js';

function assertPointsClose(actual, expected, tolerance = 0.35) {
  const remaining = [...actual];
  assert.equal(remaining.length, expected.length);
  expected.forEach((ref, index) => {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((point, candidateIndex) => {
      const distance = Math.hypot(point.x - ref.x, point.y - ref.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = candidateIndex;
      }
    });
    assert.ok(bestIndex >= 0, `no point matched reference ${index}`);
    const [point] = remaining.splice(bestIndex, 1);
    assert.ok(
      Math.abs(point.x - ref.x) <= tolerance,
      `x mismatch at ${index}: ${point.x} vs ${ref.x}`,
    );
    assert.ok(
      Math.abs(point.y - ref.y) <= tolerance,
      `y mismatch at ${index}: ${point.y} vs ${ref.y}`,
    );
  });
}

function buildChairAtoms(points) {
  return points.map((point, index) => ({
    id: `a${index}`,
    x: point.x,
    y: point.y,
    kind: 'element',
    element: 'C',
  }));
}

function buildChairBonds() {
  const edges = [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [4, 5],
    [5, 0],
  ];
  return edges.map(([from, to], index) => ({
    id: `b${index}`,
    from: `a${from}`,
    to: `a${to}`,
    order: 1,
    stereo: 0,
  }));
}

function getMedian(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function getGeometryBondLengths(geometry) {
  return geometry.bonds.map((bond) => {
    const from = geometry.atoms[bond.from];
    const to = geometry.atoms[bond.to];
    return Math.hypot(to.x - from.x, to.y - from.y);
  });
}

test('standalone chair placement matches the ChemDraw chair geometry', () => {
  const placement = resolveRingTemplatePlacement({
    preset: 'chair',
    bondLength: 14.4,
    center: { x: 101.645, y: 333.255 },
    existingAtoms: [],
    existingBonds: [],
  });

  assertPointsClose(placement.atoms, [
    { x: 84.16, y: 327.02 },
    { x: 91.36, y: 339.49 },
    { x: 105.29, y: 335.84 },
    { x: 119.13, y: 339.49 },
    { x: 111.93, y: 327.02 },
    { x: 98.0, y: 330.67 },
  ]);
});

test('chair fusion onto an exposed bond reproduces the ChemDraw decalin geometry', () => {
  const atoms = buildChairAtoms([
    { x: 143.51, y: 327.41 },
    { x: 150.71, y: 339.88 },
    { x: 164.64, y: 336.23 },
    { x: 178.49, y: 339.88 },
    { x: 171.29, y: 327.41 },
    { x: 157.36, y: 331.05 },
  ]);
  const bonds = buildChairBonds();
  const hitBond = bonds.find((bond) => bond.from === 'a3' && bond.to === 'a4');

  const placement = resolveRingTemplatePlacement({
    preset: 'chair',
    bondLength: 14.4,
    pointer: { x: 196, y: 333 },
    existingAtoms: atoms,
    existingBonds: bonds,
    hitBond,
  });

  const newAtoms = placement.atoms.filter((_, index) => !placement.mappedAtomIdsByIndex.has(index));
  assert.equal(placement.mappedAtomIdsByIndex.size, 2);
  assert.equal(placement.skippedBondIndices.size, 1);
  assertPointsClose(newAtoms, [
    { x: 192.42, y: 336.23 },
    { x: 206.26, y: 339.88 },
    { x: 199.07, y: 327.41 },
    { x: 185.13, y: 331.05 },
  ]);
});

test('flipped chair fusion reproduces the alternate ChemDraw decalin geometry', () => {
  const atoms = buildChairAtoms([
    { x: 236.62, y: 328.96 },
    { x: 243.82, y: 341.43 },
    { x: 257.75, y: 337.78 },
    { x: 271.6, y: 341.43 },
    { x: 264.4, y: 328.96 },
    { x: 250.47, y: 332.61 },
  ]);
  const bonds = buildChairBonds();
  const hitBond = bonds.find((bond) => bond.from === 'a2' && bond.to === 'a3');

  const placement = resolveRingTemplatePlacement({
    preset: 'chair-flipped',
    bondLength: 14.4,
    pointer: { x: 268, y: 361 },
    existingAtoms: atoms,
    existingBonds: bonds,
    hitBond,
  });

  const newAtoms = placement.atoms.filter((_, index) => !placement.mappedAtomIdsByIndex.has(index));
  assert.equal(placement.mappedAtomIdsByIndex.size, 2);
  assert.equal(placement.skippedBondIndices.size, 1);
  assertPointsClose(newAtoms, [
    { x: 265.17, y: 350.03 },
    { x: 265.17, y: 364.35 },
    { x: 279.01, y: 368.0 },
    { x: 271.6, y: 355.75 },
  ]);
});

test('regular hexagons and chair templates use the requested bond length', () => {
  const bondLength = 18;
  const polygon = getRegularRingGeometry({ x: 100, y: 120 }, bondLength, 6);
  const chair = resolveRingTemplatePlacement({
    preset: 'chair',
    bondLength,
    center: { x: 100, y: 120 },
    existingAtoms: [],
    existingBonds: [],
  });

  const polygonMedian = getMedian(getGeometryBondLengths(polygon));
  const chairMedian = getMedian(getGeometryBondLengths(chair));

  assert.ok(Math.abs(polygonMedian - bondLength) <= 1e-6, `polygon bond length ${polygonMedian}`);
  assert.ok(Math.abs(chairMedian - bondLength) <= 0.05, `chair bond length ${chairMedian}`);
  assert.ok(
    Math.abs(chairMedian - polygonMedian) <= 0.05,
    `geometry drift ${chairMedian} vs ${polygonMedian}`,
  );
});
