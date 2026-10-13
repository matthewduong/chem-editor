import test from 'node:test';
import assert from 'node:assert/strict';
import { expandFormulaRuns, expandFormulaText } from '../.unit-test-dist/src/lib/formulaStyle.js';

const render = (text) =>
  expandFormulaText(text)
    .map((p) => (p.sub ? `_${p.text}_` : p.sup ? `^${p.text}^` : p.text))
    .join('');

// Labels ChemDraw 26.1.0.6801 draws with the formula face, as it showed them (PDF, 2026-10-13).
test('formula face subscripts digits and superscripts charges like ChemDraw', () => {
  assert.equal(render('Et3N'), 'Et_3_N');
  assert.equal(render('Pd(PPh3)4'), 'Pd(PPh_3_)_4_');
  assert.equal(render('LiAlH4'), 'LiAlH_4_');
  assert.equal(render('CO2Me'), 'CO_2_Me');
  assert.equal(render('C4H9'), 'C_4_H_9_');
  assert.equal(render('Co(CO)3'), 'Co(CO)_3_');
  assert.equal(render('NH4+'), 'NH_4_^+^');
  assert.equal(render('Mg2+'), 'Mg^2+^');
  assert.equal(render('SO42-'), 'SO_4_^2-^');
  assert.equal(render('2-Np'), '2-Np');
  assert.equal(render('DMF'), 'DMF');
});

test('only runs flagged as formula are expanded, and the flag is consumed', () => {
  const runs = [
    { text: 'CO2Et', formula: true },
    { text: 'CO2Et' },
    { text: 'H2', formula: true, sub: true },
  ];
  const out = expandFormulaRuns(runs);
  assert.deepEqual(
    out.map((r) => [r.text, Boolean(r.sub), Boolean(r.formula)]),
    [
      ['CO', false, false],
      ['2', true, false],
      ['Et', false, false],
      ['CO2Et', false, false],
      ['H2', true, true],
    ],
  );
});
