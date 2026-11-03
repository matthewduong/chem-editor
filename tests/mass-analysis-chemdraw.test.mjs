// Values read from ChemDraw 26.1.0.6801 (Selection: Molecular Weight / Exact Mass / Elemental
// Analysis) for structures drawn from SMILES. See development/gaps.md, "Analysis values".
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  exactMass,
  formatElementalAnalysis,
  molecularWeight,
  parseFormula,
} from '../.unit-test-dist/src/lib/massAnalysis.js';

const CASES = [
  // formula, MW, exact mass, elemental analysis
  ['C6H12O6', 180.156, 180.063388116, 'C, 40.00; H, 6.71; O, 53.28'],
  ['C9H8O4', 180.159, 180.042258744, 'C, 60.00; H, 4.48; O, 35.52'],
  ['CHCl3', 119.369, 117.914383132, 'C, 10.06; H, 0.84; Cl, 89.09'],
  ['C7H5F3', 146.112209489, 146.034334649, 'C, 57.54; H, 3.45; F, 39.01'],
  ['C6H5NO2', 123.111, 123.032028408, 'C, 58.54; H, 4.09; N, 11.38; O, 25.99'],
  // Ions: the electrons come off a cation and go onto an anion.
  ['C4H12N+', 74.14645142, 74.096425808, 'C, 64.80; H, 16.31; N, 18.89'],
  ['HO-', 17.00754858, 17.003288234, 'H, 5.93; O, 94.07'],
  ['C2H3O2-', 59.04454858, 59.01385292, 'C, 40.68; H, 5.12; O, 54.19'],
  ['Fe+2', 55.84390284, 55.93383884, 'Fe, 100.00'],
  ['O-2', 16.00009716, 15.996011782, 'O, 99.99'],
];

for (const [formula, mw, em, ea] of CASES) {
  test(`${formula} matches ChemDraw's weight, exact mass and elemental analysis`, () => {
    const parsed = parseFormula(formula);
    assert.ok(parsed, `${formula} parses`);
    assert.ok(
      Math.abs(molecularWeight(parsed) - mw) < 5e-4,
      `MW ${molecularWeight(parsed)} vs ${mw}`,
    );
    assert.ok(Math.abs(exactMass(parsed) - em) < 5e-6, `EM ${exactMass(parsed)} vs ${em}`);
    assert.equal(formatElementalAnalysis(parsed.counts, 2, parsed.charge), ea);
  });
}
