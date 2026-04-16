import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildChemicalTextMetadata,
  chemicalTextInputToFormula,
  evaluateTextBoxChemicalState,
  inspectChemicalText,
  normalizeChemicalTextRuns,
  resolveChemicalTextStructure,
} from '../.unit-test-dist/src/lib/chemicalText.js';

test('raw formula markup is normalized into formatted runs', () => {
  const runs = normalizeChemicalTextRuns([{ text: 'Co_2(CO)_8' }]);
  assert.deepEqual(
    runs.map((run) => ({ text: run.text, sub: Boolean(run.sub), sup: Boolean(run.sup) })),
    [
      { text: 'Co', sub: false, sup: false },
      { text: '2', sub: true, sup: false },
      { text: '(CO)', sub: false, sup: false },
      { text: '8', sub: true, sup: false },
    ],
  );
});

test('raw chemical text input converts into a formula string', () => {
  assert.equal(chemicalTextInputToFormula('Co_2(CO)_8'), 'Co2(CO)8');
  assert.equal(chemicalTextInputToFormula('CO₂'), 'CO2');
});

test('formula resolution accepts raw text markup', () => {
  const resolved = resolveChemicalTextStructure('Co_2(CO)_8');
  assert.equal(resolved.ok, true);
  assert.equal(resolved.normalizedInput, 'Co2(CO)8');
  assert.ok(resolved.smiles);
});

test('formatted chemistry text advertises chemical intent', () => {
  const inspection = inspectChemicalText([{ text: 'H' }, { text: '2', sub: true }, { text: 'O' }]);
  assert.equal(inspection.intent, true);
  assert.equal(inspection.formula, 'H2O');
  assert.equal(inspection.resolution.ok, true);
});

test('chemical metadata captures the resolved structure for intended text', () => {
  const metadata = buildChemicalTextMetadata([
    { text: 'Co' },
    { text: '2', sub: true },
    { text: '(CO)' },
    { text: '8', sub: true },
  ]);
  assert.deepEqual(
    metadata && {
      intent: metadata.intent,
      formula: metadata.formula,
      chemistryAvailable: metadata.chemistryAvailable,
      source: metadata.source,
    },
    {
      intent: true,
      formula: 'Co2(CO)8',
      chemistryAvailable: true,
      source: 'repeated-root',
    },
  );
  assert.ok(metadata?.smiles);
});

test('plain short annotations are not hijacked as molecules', () => {
  assert.equal(inspectChemicalText([{ text: 'No' }]).intent, false);
  assert.equal(buildChemicalTextMetadata([{ text: 'No' }]), null);
  assert.deepEqual(normalizeChemicalTextRuns([{ text: 'Room temp' }]), [{ text: 'Room temp' }]);
});

test('plain text mode keeps chemistry-like strings as plain annotations', () => {
  const state = evaluateTextBoxChemicalState([{ text: 'Co_2(CO)_8' }], 'plain');
  assert.deepEqual(state.normalizedRuns, [{ text: 'Co_2(CO)_8' }]);
  assert.equal(state.intent, false);
  assert.equal(state.metadata, null);
  assert.equal(state.conversionStatus, 'plain');
});

test('chemical text mode forces resolution attempts for short formulas', () => {
  const state = evaluateTextBoxChemicalState([{ text: 'CO' }], 'chemical');
  assert.equal(state.intent, true);
  assert.equal(state.conversionStatus, 'resolved');
  assert.equal(state.metadata?.chemistryAvailable, true);
  assert.equal(state.metadata?.formula, 'CO');
});
