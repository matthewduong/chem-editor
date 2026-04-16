import test from 'node:test';
import assert from 'node:assert/strict';

import {
  collectBondNeighborVectors,
  cycleDoubleBondMode,
  DEFAULT_DOUBLE_BOND_MODE,
  getBondVisualMetrics,
  getDoubleBondLineGeometry,
  getNextDoubleBondToolMode,
  getTripleBondLineGeometry,
  resolveDoubleBondMode,
} from '../.unit-test-dist/src/lib/renderGeometry.js';
import {
  applyBondEdit,
  canvasStateToChemDrawDocument,
  chemDrawDocumentToCanvasState,
} from '../.unit-test-dist/src/lib/chemdrawModel.js';
import { DEFAULT_DOCUMENT_STYLE_SETTINGS } from '../.unit-test-dist/src/lib/settings.js';
import { stateToCDXML } from '../.unit-test-dist/src/utils/cdxml.js';

function approxEqual(actual, expected, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

function makeAtom(id, x, y, element = 'C') {
  return { id, x, y, kind: 'element', element };
}

test('double bond mode cycles through auto, flipped, and symmetric', () => {
  assert.equal(DEFAULT_DOUBLE_BOND_MODE, 'auto');
  assert.equal(resolveDoubleBondMode(undefined), 'auto');
  assert.equal(cycleDoubleBondMode(undefined), 'flipped');
  assert.equal(cycleDoubleBondMode('auto'), 'flipped');
  assert.equal(cycleDoubleBondMode('flipped'), 'symmetric');
  assert.equal(cycleDoubleBondMode('symmetric'), 'auto');
});

test('plain double-bond activation cycles existing doubles the same way across input paths', () => {
  assert.equal(getNextDoubleBondToolMode({ order: 1 }), 'auto');
  assert.equal(getNextDoubleBondToolMode({ order: 2 }), 'flipped');
  assert.equal(getNextDoubleBondToolMode({ order: 2, doubleBondMode: 'auto' }), 'flipped');
  assert.equal(getNextDoubleBondToolMode({ order: 2, doubleBondMode: 'flipped' }), 'symmetric');
  assert.equal(getNextDoubleBondToolMode({ order: 2, doubleBondMode: 'symmetric' }), 'auto');
});

test('symmetric double bonds keep the gap centered on the atom axis', () => {
  const visual = getBondVisualMetrics(2, 45);
  const [lineA, lineB] = getDoubleBondLineGeometry({
    startX: 0,
    startY: 0,
    endX: 40,
    endY: 0,
    unitX: 1,
    unitY: 0,
    normalX: 0,
    normalY: visual.parallelOffset,
    mode: 'symmetric',
    visual,
    fromAtom: makeAtom('a1', 0, 0),
    toAtom: makeAtom('a2', 40, 0),
  });

  approxEqual((lineA.startY + lineB.startY) / 2, 0);
  approxEqual((lineA.endY + lineB.endY) / 2, 0);
  approxEqual(lineA.startY, visual.parallelOffset / 2);
  approxEqual(lineB.startY, -visual.parallelOffset / 2);
  approxEqual(lineA.startX, 0);
  approxEqual(lineB.startX, 0);
});

test('auto ring double bonds use the shortened inner line while flipped moves it outside', () => {
  const visual = getBondVisualMetrics(2, 45);
  const [autoPrimary, autoSecondary] = getDoubleBondLineGeometry({
    startX: 0,
    startY: 0,
    endX: 40,
    endY: 0,
    unitX: 1,
    unitY: 0,
    normalX: 0,
    normalY: visual.parallelOffset,
    mode: 'auto',
    visual,
    fromAtom: makeAtom('a1', 0, 0),
    toAtom: makeAtom('a2', 40, 0),
    ringCentroid: { cx: 20, cy: 10, n: 6 },
  });
  const [flippedPrimary, flippedSecondary] = getDoubleBondLineGeometry({
    startX: 0,
    startY: 0,
    endX: 40,
    endY: 0,
    unitX: 1,
    unitY: 0,
    normalX: 0,
    normalY: visual.parallelOffset,
    mode: 'flipped',
    visual,
    fromAtom: makeAtom('a1', 0, 0),
    toAtom: makeAtom('a2', 40, 0),
    ringCentroid: { cx: 20, cy: 10, n: 6 },
  });

  approxEqual(autoPrimary.startX, flippedPrimary.startX);
  approxEqual(autoPrimary.endX, flippedPrimary.endX);
  assert.ok(autoSecondary.startY > 0);
  assert.ok(flippedSecondary.startY < 0);
  approxEqual(autoSecondary.startX, flippedSecondary.startX);
  approxEqual(autoSecondary.endX, flippedSecondary.endX);
});

test('auto double bonds outside rings default to equal-length lines', () => {
  const visual = getBondVisualMetrics(2, 45);
  const [lineA, lineB] = getDoubleBondLineGeometry({
    startX: 0,
    startY: 0,
    endX: 40,
    endY: 0,
    unitX: 1,
    unitY: 0,
    normalX: 0,
    normalY: visual.parallelOffset,
    mode: 'auto',
    visual,
    fromAtom: makeAtom('a1', 0, 0),
    toAtom: makeAtom('a2', 40, 0),
  });

  approxEqual((lineA.startY + lineB.startY) / 2, 0);
  approxEqual((lineA.endY + lineB.endY) / 2, 0);
  approxEqual(lineA.startX, 0);
  approxEqual(lineB.startX, 0);
  approxEqual(lineA.endX, 40);
  approxEqual(lineB.endX, 40);
});

test('double bonds trim the secondary line away from acute adjacent single bonds', () => {
  const visual = getBondVisualMetrics(2, 45);
  const atoms = [
    makeAtom('a1', 0, 0),
    makeAtom('a2', 40, 0),
    makeAtom('a3', 10, 10),
    makeAtom('a4', 30, 10),
  ];
  const atomLookup = new Map(atoms.map((atom) => [atom.id, atom]));
  const bond = {
    id: 'b1',
    from: 'a1',
    to: 'a2',
    order: 2,
  };
  const neighborVectors = collectBondNeighborVectors({
    bond,
    fromAtom: atoms[0],
    toAtom: atoms[1],
    atomLookup,
    bonds: [
      bond,
      { id: 'b2', from: 'a1', to: 'a3', order: 1 },
      { id: 'b3', from: 'a2', to: 'a4', order: 1 },
    ],
  });

  const [, secondaryLine] = getDoubleBondLineGeometry({
    startX: 0,
    startY: 0,
    endX: 40,
    endY: 0,
    unitX: 1,
    unitY: 0,
    normalX: 0,
    normalY: visual.parallelOffset,
    mode: 'auto',
    visual,
    fromAtom: atoms[0],
    toAtom: atoms[1],
    ringCentroid: { cx: 20, cy: 10, n: 6 },
    startNeighborVectors: neighborVectors.from,
    endNeighborVectors: neighborVectors.to,
  });

  approxEqual(secondaryLine.startY, visual.parallelOffset);
  approxEqual(secondaryLine.endY, visual.parallelOffset);
  approxEqual(secondaryLine.startX, visual.parallelOffset);
  approxEqual(secondaryLine.endX, 40 - visual.parallelOffset);
});

test('triple bonds trim each outer line only on the side with acute adjacent bonds', () => {
  const visual = getBondVisualMetrics(2, 45);
  const atoms = [
    makeAtom('a1', 0, 0),
    makeAtom('a2', 40, 0),
    makeAtom('a3', 10, 10),
    makeAtom('a4', 30, 10),
  ];
  const atomLookup = new Map(atoms.map((atom) => [atom.id, atom]));
  const bond = {
    id: 'b1',
    from: 'a1',
    to: 'a2',
    order: 3,
  };
  const neighborVectors = collectBondNeighborVectors({
    bond,
    fromAtom: atoms[0],
    toAtom: atoms[1],
    atomLookup,
    bonds: [
      bond,
      { id: 'b2', from: 'a1', to: 'a3', order: 1 },
      { id: 'b3', from: 'a2', to: 'a4', order: 1 },
    ],
  });

  const [topLine, bottomLine] = getTripleBondLineGeometry({
    startX: 0,
    startY: 0,
    endX: 40,
    endY: 0,
    unitX: 1,
    unitY: 0,
    normalX: 0,
    normalY: visual.parallelOffset,
    visual,
    fromAtom: atoms[0],
    toAtom: atoms[1],
    startNeighborVectors: neighborVectors.from,
    endNeighborVectors: neighborVectors.to,
  });

  approxEqual(topLine.startY, visual.parallelOffset);
  approxEqual(topLine.endY, visual.parallelOffset);
  approxEqual(topLine.startX, visual.parallelOffset);
  approxEqual(topLine.endX, 40 - visual.parallelOffset);
  approxEqual(bottomLine.startY, -visual.parallelOffset);
  approxEqual(bottomLine.endY, -visual.parallelOffset);
  approxEqual(bottomLine.startX, visual.tripleInlineInset);
  approxEqual(bottomLine.endX, 40 - visual.tripleInlineInset);
});

test('ACS-scale ring double bonds use geometric flush insets; triple bonds use margin-width insets', () => {
  const visual = getBondVisualMetrics(
    DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLineWidth,
    DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength,
    {
      documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
    },
  );
  approxEqual(visual.ringInsetBase, DEFAULT_DOCUMENT_STYLE_SETTINGS.nativeMetrics.marginWidth);
  approxEqual(visual.tripleInlineInset, DEFAULT_DOCUMENT_STYLE_SETTINGS.nativeMetrics.marginWidth);

  const fromAtom = makeAtom('a1', 0, 0);
  const toAtom = makeAtom('a2', DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength, 0);
  const [, ringSecondary] = getDoubleBondLineGeometry({
    startX: 0,
    startY: 0,
    endX: DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength,
    endY: 0,
    unitX: 1,
    unitY: 0,
    normalX: 0,
    normalY: visual.parallelOffset,
    mode: 'auto',
    visual,
    fromAtom,
    toAtom,
    ringCentroid: {
      cx: DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength / 2,
      cy: visual.parallelOffset,
      n: 6,
    },
  });
  const expectedRingInset = visual.parallelOffset / Math.tan(((4 * Math.PI) / 6) / 2);
  approxEqual(ringSecondary.startX, expectedRingInset, 1e-4);
  approxEqual(ringSecondary.endX, DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength - expectedRingInset, 1e-4);

  const [tripleTop, tripleBottom] = getTripleBondLineGeometry({
    startX: 0,
    startY: 0,
    endX: DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength,
    endY: 0,
    unitX: 1,
    unitY: 0,
    normalX: 0,
    normalY: visual.parallelOffset,
    visual,
    fromAtom,
    toAtom,
  });
  approxEqual(tripleTop.startX, DEFAULT_DOCUMENT_STYLE_SETTINGS.nativeMetrics.marginWidth);
  approxEqual(tripleTop.endX, DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength - DEFAULT_DOCUMENT_STYLE_SETTINGS.nativeMetrics.marginWidth);
  approxEqual(tripleBottom.startX, DEFAULT_DOCUMENT_STYLE_SETTINGS.nativeMetrics.marginWidth);
  approxEqual(
    tripleBottom.endX,
    DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength - DEFAULT_DOCUMENT_STYLE_SETTINGS.nativeMetrics.marginWidth,
  );
});

test('double bond modes round-trip through the model and CDXML export', () => {
  const state = {
    atoms: [makeAtom('a1', 0, 0), makeAtom('a2', 40, 0)],
    bonds: [
      {
        id: 'b1',
        from: 'a1',
        to: 'a2',
        order: 2,
        doubleBondMode: 'symmetric',
      },
    ],
    arrows: [],
    groups: [],
    textBoxes: [],
  };

  const { document } = canvasStateToChemDrawDocument(state);
  const modelRoundTrip = chemDrawDocumentToCanvasState(document).state;
  assert.equal(modelRoundTrip.bonds[0].doubleBondMode, 'symmetric');

  const xml = stateToCDXML(state);
  assert.match(xml, /ChemEditorDoubleBondMode="symmetric"/);
});

test('native bond edits default newly doubled bonds to auto mode', () => {
  const initialState = {
    atoms: [makeAtom('a1', 0, 0), makeAtom('a2', 40, 0)],
    bonds: [
      {
        id: 'b1',
        from: 'a1',
        to: 'a2',
        order: 1,
      },
    ],
    arrows: [],
    groups: [],
    textBoxes: [],
  };

  const { document } = canvasStateToChemDrawDocument(initialState);
  const editedDocument = applyBondEdit(document, 'b1', { order: 2, stereo: 0 });
  const editedBond = editedDocument.pages[0].objects.find((object) => object.id === 'b1');

  assert.equal(editedBond?.type, 'bond');
  assert.equal(editedBond?.doubleBondMode, 'auto');
});
