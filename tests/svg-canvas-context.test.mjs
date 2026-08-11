import test from 'node:test';
import assert from 'node:assert/strict';

import { SvgCanvasContext, parseCanvasFont } from '../.unit-test-dist/src/lib/svgCanvasContext.js';
import { measureAdvance } from '../.unit-test-dist/src/lib/textMetrics.js';

function ctx(options = {}) {
  return new SvgCanvasContext({ width: 100, height: 100, ...options });
}

test('parses the CSS font shorthand the scene modules emit', () => {
  assert.deepEqual(parseCanvasFont("normal 10px 'Liberation Sans', sans-serif"), {
    sizePx: 10,
    bold: false,
    italic: false,
    family: "'Liberation Sans', sans-serif",
  });
  assert.deepEqual(parseCanvasFont("bold italic 11.5px 'X'"), {
    sizePx: 11.5,
    bold: true,
    italic: true,
    family: "'X'",
  });
});

test('emits a stroked path with canvas stroke state', () => {
  const c = ctx();
  c.strokeStyle = '#ff0000';
  c.lineWidth = 2;
  c.lineCap = 'round';
  c.setLineDash([4, 2]);
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(10, 10);
  c.stroke();

  const svg = c.toSVG();
  assert.match(svg, /<path d="M0 0L10 10"/);
  assert.match(svg, /stroke="#ff0000"/);
  assert.match(svg, /stroke-width="2"/);
  assert.match(svg, /stroke-linecap="round"/);
  assert.match(svg, /stroke-dasharray="4 2"/);
});

test('bakes the current transform into path coordinates', () => {
  const c = ctx();
  c.translate(5, 7);
  c.scale(2, 2);
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(10, 0);
  c.stroke();

  // (0,0) -> (5,7) and (10,0) -> (25,7); stroke width scales with the transform.
  assert.match(c.toSVG(), /d="M5 7L25 7"/);
  assert.match(c.toSVG(), /stroke-width="2"/);
});

test('save and restore unwind transform and style together', () => {
  const c = ctx();
  c.strokeStyle = '#111111';
  c.save();
  c.translate(50, 50);
  c.strokeStyle = '#222222';
  c.restore();

  c.beginPath();
  c.moveTo(1, 1);
  c.lineTo(2, 2);
  c.stroke();

  const svg = c.toSVG();
  assert.match(svg, /d="M1 1L2 2"/, 'transform should have been restored');
  assert.match(svg, /stroke="#111111"/, 'stroke style should have been restored');
});

test('globalAlpha becomes per-element opacity', () => {
  const c = ctx();
  c.globalAlpha = 0.5;
  c.fillStyle = '#00ff00';
  c.fillRect(0, 0, 10, 10);
  assert.match(c.toSVG(), /fill-opacity="0.5"/);
});

test('text is placed at an explicit pen origin, not via text-anchor', () => {
  const c = ctx();
  c.font = "normal 10px 'Liberation Sans', sans-serif";
  c.fillStyle = '#000000';
  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.fillText('OH', 50, 20);

  const svg = c.toSVG();
  // Centred text shifts left by half its measured advance; relying on text-anchor would leave
  // the position dependent on the SVG renderer's own metrics.
  const half = measureAdvance('OH', { family: 'Liberation Sans', sizePx: 10 }) / 2;
  assert.match(svg, new RegExp(`x="${50 - half}"`));
  assert.doesNotMatch(svg, /text-anchor/);
  assert.match(svg, /font-kerning:none/);
});

test("textBaseline 'top' offsets down by the ascent", () => {
  const c = ctx();
  c.font = "normal 10px 'Liberation Sans', sans-serif";
  c.textBaseline = 'top';
  c.fillText('X', 0, 0);
  // Liberation Sans ascender is 1854/2048 em, so 10px text sits 9.0527px below the top.
  assert.match(c.toSVG(), /y="9\.0527"/);
});

test('a full circle is emitted as two arc halves', () => {
  const c = ctx();
  c.beginPath();
  c.arc(50, 50, 10, 0, Math.PI * 2);
  c.stroke();
  const svg = c.toSVG();
  assert.equal((svg.match(/A10 10/g) ?? []).length, 2);
});

test('escapes text and attribute content', () => {
  const c = ctx();
  c.font = '10px sans-serif';
  c.fillText('<S&P>', 0, 10);
  const svg = c.toSVG();
  assert.match(svg, /&lt;S&amp;P&gt;/);
  assert.doesNotMatch(svg, /<S&P>/);
});

test('shadow state produces a filter rather than being dropped', () => {
  const c = ctx();
  c.shadowColor = '#000000';
  c.shadowBlur = 4;
  c.shadowOffsetX = 2;
  c.shadowOffsetY = 2;
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, 10, 10);
  const svg = c.toSVG();
  assert.match(svg, /<filter id="shadow0"/);
  assert.match(svg, /feDropShadow/);
  assert.match(svg, /filter="url\(#shadow0\)"/);
});

test('background is optional so exports can be transparent', () => {
  assert.doesNotMatch(ctx().toSVG(), /<rect width="100"/);
  assert.match(
    ctx({ background: '#f5f5f5' }).toSVG(),
    /<rect width="100" height="100" fill="#f5f5f5"\/>/,
  );
});
