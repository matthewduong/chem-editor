// Primitives read from the vector paths of ChemDraw 26.1.0.6801's PDF for each symbol type at
// L = 7.5, 10 and 15 (see gaps.md, "Symbol placement and size").
import assert from 'node:assert/strict';
import test from 'node:test';

import { symbolShape, symbolThickness } from '../.unit-test-dist/src/lib/symbolGeometry.js';

const at = { x: 0, y: 0 };
const toward = (l, deg = 0) => ({
  x: l * Math.cos((deg * Math.PI) / 180),
  y: -l * Math.sin((deg * Math.PI) / 180),
});
const near = (actual, expected, label, tolerance = 0.01) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
const parts = (type, l, deg = 0) => symbolShape(type, at, toward(l, deg), 0.6).primitives;

test('electron and lone pair dots scale with the second point distance', () => {
  for (const [l, electron, pair] of [
    [7.5, 0.832, 1.668],
    [10, 1.109, 2.223],
    [15, 1.668, 3.332],
  ]) {
    near(parts('Electron', l)[0].r, electron, `electron r at ${l}`);
    const lone = parts('LonePair', l);
    near(lone[0].r, pair, `lone pair r at ${l}`);
    near(lone[1].x, l, `second dot at ${l}`);
  }
});

test('lone pair and bar follow the direction of the second point; plus and dagger do not', () => {
  const lone = parts('LonePair', 10, 90);
  near(lone[1].x, 0, 'dot x');
  near(lone[1].y, -10, 'dot y');
  const bar = parts('LonePairBar', 10, 0)[0];
  near(bar.x1, -2.223, 'bar start');
  near(bar.x2, 12.223, 'bar end');
  const plus = parts('Plus', 10, 90);
  near(plus[0].x2 - plus[0].x1, 2 * 2.523, 'plus stays horizontal');
  near(plus[0].y1, 0, 'plus arm y');
});

test('plus, circle and dagger arms match ChemDraw', () => {
  for (const [l, half, radius, spine, cross] of [
    [7.5, 1.965, 3.59, 3.301, 1.801],
    [10, 2.523, 4.689, 4.301, 2.301],
    [15, 3.633, 6.891, 6.301, 3.301],
  ]) {
    near(parts('Plus', l)[0].x2, half, `plus arm at ${l}`);
    near(parts('CirclePlus', l)[0].r, radius, `circle r at ${l}`);
    near(parts('Dagger', l)[0].y2, spine, `dagger spine at ${l}`);
    near(parts('Dagger', l)[1].x2, cross, `crossbar at ${l}`);
    near(parts('Dagger', l)[1].y1, -0.2 * l, `crossbar height at ${l}`);
    assert.equal(parts('DoubleDagger', l).length, 3);
  }
});

test('flags are Rac, Abs and Rel; the thickness follows the line width', () => {
  assert.equal(parts('Racemic', 10)[0].text, 'Rac');
  assert.equal(parts('Absolute', 10)[0].text, 'Abs');
  assert.equal(parts('Relative', 10)[0].text, 'Rel');
  near(symbolThickness(0.6), 0.5, 'thickness at 0.6');
  near(symbolThickness(1.2), 0.953, 'thickness at 1.2');
  assert.equal(symbolShape('Bogus', at, toward(10), 0.6), null);
});
