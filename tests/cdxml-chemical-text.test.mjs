import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canvasStateToChemDrawDocument,
  chemDrawDocumentToCanvasState,
} from '../.unit-test-dist/src/lib/chemdrawModel.js';
import { decodeCdxmlFaceStyles, stateToCDXML } from '../.unit-test-dist/src/utils/cdxml.js';

test('ChemDraw face=96 decodes as plain text while 32 and 64 remain sub/sup', () => {
  assert.deepEqual(
    [
      decodeCdxmlFaceStyles(96),
      decodeCdxmlFaceStyles(32),
      decodeCdxmlFaceStyles(64),
      decodeCdxmlFaceStyles(98),
    ],
    [{}, { sub: true }, { sup: true }, { italic: true }],
  );
});

test('text-box chemical metadata round-trips through the model and is emitted in CDXML', () => {
  const state = {
    atoms: [],
    bonds: [],
    arrows: [],
    textBoxes: [
      {
        id: 'tb1',
        x: 10,
        y: 20,
        runs: [
          { text: 'Co' },
          { text: '2', sub: true },
          { text: '(CO)' },
          { text: '8', sub: true },
        ],
        fontSize: 12,
        fontFamily: 'Arial',
        color: '#000000',
        semanticMode: 'chemical',
        conversionStatus: 'resolved',
        chemicalMetadata: {
          intent: true,
          formula: 'Co2(CO)8',
          chemistryAvailable: true,
          smiles: '[Co]([C-]#[O+])([C-]#[O+])([C-]#[O+])([C-]#[O+])',
          source: 'repeated-root',
        },
      },
    ],
  };

  const { document } = canvasStateToChemDrawDocument(state);
  const modelRoundTrip = chemDrawDocumentToCanvasState(document).state;
  assert.deepEqual(
    modelRoundTrip.textBoxes[0].chemicalMetadata,
    state.textBoxes[0].chemicalMetadata,
  );
  assert.equal(modelRoundTrip.textBoxes[0].semanticMode, 'chemical');
  assert.equal(modelRoundTrip.textBoxes[0].conversionStatus, 'resolved');

  const xml = stateToCDXML(state);
  assert.match(xml, /ChemEditorChemicalMetadata="/);
  assert.match(xml, /ChemEditorTextSemanticMode="chemical"/);
  assert.match(xml, /ChemEditorTextConversionStatus="resolved"/);
  assert.match(xml, /&quot;formula&quot;:&quot;Co2\(CO\)8&quot;/);
});
