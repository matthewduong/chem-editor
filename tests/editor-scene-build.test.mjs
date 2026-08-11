import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDocumentSceneState,
  buildLegacySceneState,
} from '../.unit-test-dist/src/editor/scene/buildScene.js';
import { cdxmlToChemDrawDocument } from '../.unit-test-dist/src/utils/cdxml.js';
import { chemDrawDocumentToCanvasState } from '../.unit-test-dist/src/lib/chemdrawModel.js';
import {
  DEFAULT_DOCUMENT_STYLE_SETTINGS,
  DEFAULT_DOCUMENT_VIEW_SETTINGS,
  DEFAULT_PAGE_SETUP,
} from '../.unit-test-dist/src/lib/settings.js';

// Propene: a labelled terminal carbon plus a double bond, so the scene has to derive ring-free
// bond geometry, an adjacency map, and native-object overlays.
const CDXML = `<?xml version="1.0" encoding="UTF-8"?>
<CDXML BondLength="14.4">
  <page id="page-1">
    <fragment id="f1">
      <n id="1" p="0 0" Element="6"/>
      <n id="2" p="14.4 0" Element="6"/>
      <n id="3" p="21.6 12.5" Element="8"/>
      <b id="4" B="1" E="2" Order="1"/>
      <b id="5" B="2" E="3" Order="2"/>
    </fragment>
  </page>
</CDXML>`;

function buildFromCdxml(interaction) {
  const document = cdxmlToChemDrawDocument(CDXML).document;
  const canvasState = chemDrawDocumentToCanvasState(document).state;
  return buildDocumentSceneState({
    document,
    canvasState: {
      atoms: canvasState.atoms,
      bonds: canvasState.bonds,
      arrows: canvasState.arrows,
      groups: canvasState.groups ?? [],
      textBoxes: canvasState.textBoxes ?? [],
    },
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
    documentViewSettings: DEFAULT_DOCUMENT_VIEW_SETTINGS,
    pageSetup: DEFAULT_PAGE_SETUP,
    interaction,
  });
}

test('scene assembly runs without a DOM', () => {
  // The whole point of the builder: the draw path has to be reachable under `node --test`.
  assert.equal(typeof globalThis.document, 'undefined');
  const scene = buildFromCdxml();
  assert.ok(scene.index);
  assert.equal(scene.legacy.atoms.length, 3);
  assert.equal(scene.legacy.bonds.length, 2);
});

test('scene assembly derives lookups that agree with the flat arrays', () => {
  const scene = buildFromCdxml();
  const { legacy } = scene;

  for (const atom of legacy.atoms) {
    assert.equal(legacy.atomById.get(atom.id), atom);
  }
  for (const bond of legacy.bonds) {
    assert.equal(legacy.bondById.get(bond.id), bond);
    // Every bond must appear in the adjacency list of both endpoints.
    assert.ok(legacy.bondsByAtomId.get(bond.from)?.includes(bond));
    assert.ok(legacy.bondsByAtomId.get(bond.to)?.includes(bond));
    // Every bond gets crossing intervals, even when nothing crosses it.
    assert.ok(legacy.bondVisibleIntervals.has(bond.id));
  }

  // Native overlays are indexed off the document, not the projection.
  assert.equal(legacy.nativeNodes.size, 3);
  assert.equal(legacy.nativeBonds.size, 2);
  assert.equal(legacy.nativeArrows.size, 0);
});

test('interaction state defaults to empty and is overridable', () => {
  const defaults = buildFromCdxml();
  assert.equal(defaults.isDarkMode, false);
  assert.equal(defaults.hoveredAtomId, null);
  assert.equal(defaults.selectedAtomIds.size, 0);

  const overridden = buildFromCdxml({ isDarkMode: true, hoveredAtomId: 'n-1' });
  assert.equal(overridden.isDarkMode, true);
  assert.equal(overridden.hoveredAtomId, 'n-1');
  // Unspecified fields keep their defaults rather than becoming undefined.
  assert.equal(overridden.showHydrogens, true);
  assert.equal(overridden.selectedBondIds.size, 0);
});

test('a document with no native objects still yields a usable scene', () => {
  const legacy = buildLegacySceneState(
    { atoms: [], bonds: [], arrows: [], groups: [], textBoxes: [] },
    null,
    DEFAULT_DOCUMENT_STYLE_SETTINGS,
  );

  assert.equal(legacy.atoms.length, 0);
  assert.equal(legacy.nativeNodes.size, 0);
  assert.equal(legacy.ringCentroids.size, 0);
  assert.equal(legacy.bondVisibleIntervals.size, 0);
});
