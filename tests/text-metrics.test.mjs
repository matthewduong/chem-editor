import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getFaceMetrics,
  measureAdvance,
  measureText,
  resolveMetricFamily,
  getPaintFontFamily,
} from '../.unit-test-dist/src/lib/textMetrics.js';
import { measureRunWidth } from '../.unit-test-dist/src/lib/textRunPresentation.js';

test('measurement needs no DOM', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.ok(measureAdvance('CH3', { family: 'Arial', sizePx: 10 }) > 0);
});

test('families resolve to the metric-compatible face', () => {
  // Liberation Sans carries Arial's advance widths, and Helvetica shares them.
  for (const family of ['Arial', 'Helvetica', 'helvetica neue', 'Verdana', 'sans-serif', '']) {
    assert.equal(resolveMetricFamily(family), 'sans', family);
  }
  for (const family of ['Times New Roman', 'times', 'Georgia', 'serif']) {
    assert.equal(resolveMetricFamily(family), 'serif', family);
  }
  for (const family of ['Courier New', 'Consolas', 'monospace']) {
    assert.equal(resolveMetricFamily(family), 'mono', family);
  }
  // Family stacks and quoting are tolerated, since CSS values reach us verbatim.
  assert.equal(resolveMetricFamily('"Times New Roman", serif'), 'serif');
  assert.equal(resolveMetricFamily("'Courier New', monospace"), 'mono');
});

test('the painted family matches the measured family', () => {
  // If these ever disagree the app paints with a face it did not measure, which is the whole
  // class of bug this module exists to remove.
  assert.match(getPaintFontFamily('Helvetica'), /Liberation Sans/);
  assert.match(getPaintFontFamily('Times New Roman'), /Liberation Serif/);
  assert.match(getPaintFontFamily('Courier New'), /Liberation Mono/);
});

test('advance scales linearly with point size', () => {
  const at10 = measureAdvance('Benzene', { family: 'Arial', sizePx: 10 });
  const at20 = measureAdvance('Benzene', { family: 'Arial', sizePx: 20 });
  assert.ok(Math.abs(at20 - at10 * 2) < 1e-9);
});

test('advance is additive across a string', () => {
  const font = { family: 'Arial', sizePx: 12 };
  const whole = measureAdvance('CH3CH2OH', font);
  const parts = ['CH3', 'CH2', 'OH'].reduce((sum, part) => sum + measureAdvance(part, font), 0);
  // Kerning is deliberately not modelled, and the draw path disables it, so the two must match.
  assert.ok(Math.abs(whole - parts) < 1e-9);
});

test('bold and italic have their own advances', () => {
  const regular = measureAdvance('Chemistry', { family: 'Arial', sizePx: 12 });
  const bold = measureAdvance('Chemistry', { family: 'Arial', sizePx: 12, bold: true });
  assert.notEqual(regular, bold);
});

test('monospace advances are uniform', () => {
  const font = { family: 'Courier New', sizePx: 12 };
  const i = measureAdvance('i', font);
  const w = measureAdvance('W', font);
  assert.ok(Math.abs(i - w) < 1e-9, 'monospace glyphs must share one advance');
});

test('vertical metrics are real font data, not ratio guesses', () => {
  const metrics = getFaceMetrics({ family: 'Arial', sizePx: 100 });
  // Liberation Sans: capHeight 1409/2048, xHeight 1082/2048 em.
  assert.ok(Math.abs(metrics.capHeight - 68.8) < 0.2, `capHeight was ${metrics.capHeight}`);
  assert.ok(Math.abs(metrics.xHeight - 52.8) < 0.2, `xHeight was ${metrics.xHeight}`);
  // Both ascent and descent are reported as positive distances from the baseline.
  assert.ok(metrics.ascent > 0 && metrics.descent > 0);
  assert.ok(metrics.capHeight < metrics.ascent);
  assert.ok(metrics.xHeight < metrics.capHeight);
});

test('unknown codepoints fall back rather than measuring as zero', () => {
  // A private-use character has no glyph; it must still consume width so layout does not collapse.
  assert.ok(measureAdvance('', { family: 'Arial', sizePx: 10 }) > 0);
});

test('astral characters consume a single advance', () => {
  const font = { family: 'Arial', sizePx: 10 };
  // Iterating by UTF-16 unit would double-count a surrogate pair.
  assert.equal(measureAdvance('\u{1D400}', font), measureAdvance('', font));
});

test('subscripts and superscripts measure at 65% of the base size', () => {
  const base = measureRunWidth({ text: '2' }, 10, 'Arial');
  const sub = measureRunWidth({ text: '2', sub: true }, 10, 'Arial');
  assert.ok(Math.abs(sub - base * 0.65) < 1e-9);
});

test('run measurement agrees with direct measurement', () => {
  // measureRunWidth is the cached front door; it must not drift from the underlying table.
  const direct = measureText('OH', { family: 'Arial', sizePx: 14, bold: true }).advance;
  assert.ok(Math.abs(measureRunWidth({ text: 'OH', bold: true }, 14, 'Arial') - direct) < 1e-9);
});

test('a known advance is pinned so a font swap cannot pass silently', () => {
  // Liberation Sans 'A' is 1366/2048 em; at 100px that is 66.6992...
  const advance = measureAdvance('A', { family: 'Arial', sizePx: 100 });
  assert.ok(Math.abs(advance - 66.6992) < 0.001, `expected ~66.6992, got ${advance}`);
});
