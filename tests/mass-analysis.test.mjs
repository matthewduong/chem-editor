import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formatElementalAnalysis,
  formatMassPeaks,
  isotopePeaks,
  parseFormula,
} from '../.unit-test-dist/src/lib/massAnalysis.js';

test('formulas are read with their charge', () => {
  assert.deepEqual(parseFormula('C6H5O-'), { counts: { C: 6, H: 5, O: 1 }, charge: -1 });
  assert.deepEqual(parseFormula('C2H8N2+2'), { counts: { C: 2, H: 8, N: 2 }, charge: 2 });
  assert.equal(parseFormula('C6Xx'), null);
});

test('glucose analyses by weight and isotope peaks', () => {
  const glucose = parseFormula('C6H12O6');
  assert.equal(formatElementalAnalysis(glucose.counts), 'C, 40.00; H, 6.71; O, 53.28');
  assert.equal(
    formatMassPeaks(isotopePeaks(glucose)),
    '180.06 (100.0%), 181.07 (6.9%), 182.07 (1.4%)',
  );
});

test('a bromide shows its two near-equal isotope peaks', () => {
  const peaks = isotopePeaks(parseFormula('CH3Br'));
  assert.equal(peaks.length, 4);
  assert.ok(Math.abs(peaks[0].mz - 93.9418) < 1e-3);
  assert.ok(Math.abs(peaks[2].relative - 97.3) < 0.2);
});
