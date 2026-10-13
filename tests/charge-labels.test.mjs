import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChargeRuns } from '../.unit-test-dist/src/lib/atomLabelPresentation.js';
import { asGeneratedLabelAtom } from '../.unit-test-dist/src/lib/atomLabels.js';
import { getSuperscriptBaselineShift } from '../.unit-test-dist/src/lib/chemdrawMetrics.js';
import { isAtomLabelVisible } from '../.unit-test-dist/src/lib/renderGeometry.js';

// ChemDraw 26.1.0.6801 (2026-10-13) writes a charge into the label text: NH3+, O-, C2+, with the
// sign as a plain ASCII hyphen or plus and the magnitude as its own superscript run.
test('a charge is a superscript sign, preceded by its magnitude when it is not one', () => {
  assert.deepEqual(buildChargeRuns(1), [{ text: '+', sup: true }]);
  assert.deepEqual(buildChargeRuns(-1), [{ text: '-', sup: true }]);
  assert.deepEqual(buildChargeRuns(2), [
    { text: '2', sup: true },
    { text: '+', sup: true },
  ]);
  assert.deepEqual(buildChargeRuns(-2, '#f00'), [
    { text: '2', sup: true, color: '#f00' },
    { text: '-', sup: true, color: '#f00' },
  ]);
  assert.deepEqual(buildChargeRuns(0), []);
});

test('a charged carbon is labelled, an uncharged one with a bond is not', () => {
  const carbon = { id: 'c', x: 0, y: 0, kind: 'element', element: 'C' };
  assert.equal(isAtomLabelVisible(carbon, 2), false);
  assert.equal(isAtomLabelVisible({ ...carbon, charge: 1 }, 3), true);
  assert.equal(isAtomLabelVisible({ ...carbon, charge: -1 }, 2), true);
});

const N = { id: 'n', x: 0, y: 0, kind: 'alias', element: 'N', charge: 1 };
const bonds = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `b${i}`, from: 'n', to: `x${i}`, order: 1 }));

test('a file label that is exactly the generated one is generated', () => {
  // N+ with one bond holds three hydrogens: NH3+ is the generated label.
  const generated = asGeneratedLabelAtom({ ...N, alias: 'NH3+' }, bonds(1));
  assert.equal(generated.kind, 'element');
  assert.equal(generated.alias, undefined);
  // The wrong hydrogen count, a charge that disagrees, or carbon are left as written.
  assert.equal(asGeneratedLabelAtom({ ...N, alias: 'NH2+' }, bonds(1)).kind, 'alias');
  assert.equal(asGeneratedLabelAtom({ ...N, alias: 'NH3-' }, bonds(1)).kind, 'alias');
  assert.equal(asGeneratedLabelAtom({ ...N, element: 'C', alias: 'CH2+' }, bonds(1)).kind, 'alias');
});

test('a superscript moves the label baseline down by the amount ChemDraw does', () => {
  assert.equal(getSuperscriptBaselineShift([{ text: 'N' }, { text: 'H3' }]), 0);
  assert.equal(getSuperscriptBaselineShift([{ text: 'O' }, { text: '-', sup: true }]), 0.042);
  assert.equal(
    getSuperscriptBaselineShift([
      { text: 'C' },
      { text: '2', sup: true },
      { text: '+', sup: true },
    ]),
    0.091,
  );
});
