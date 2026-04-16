import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DOCUMENT_STYLE_SETTINGS,
  DEFAULT_DOCUMENT_VIEW_SETTINGS,
  DEFAULT_TOOL_PALETTE_ORDER,
  DEFAULT_PAGE_SETUP,
  detectPagePreset,
  getPageSetupDimensionsPx,
  inferImportedPageSetup,
  normalizeAppPreferences,
  normalizeDocumentStyleSettings,
  normalizePageSetup,
  updatePageSetup,
} from '../.unit-test-dist/src/lib/settings.js';
import { canvasStateToChemDrawDocument } from '../.unit-test-dist/src/lib/chemdrawModel.js';
import { chemDrawDocumentToCDXML } from '../.unit-test-dist/src/utils/cdxml.js';

test('unit changes preserve physical size for custom finite pages', () => {
  const initial = normalizePageSetup({
    mode: 'finite',
    unit: 'in',
    presetId: 'custom',
    pageWidth: 8.5,
    pageHeight: 11,
    rows: 2,
    columns: 3,
  });
  const converted = updatePageSetup(
    initial,
    { unit: 'cm' },
    { preservePhysicalSizeOnUnitChange: true },
  );

  assert.equal(converted.unit, 'cm');
  assert.equal(converted.presetId, 'custom');
  assert.equal(converted.rows, 2);
  assert.equal(converted.columns, 3);
  assert.equal(converted.pageWidth, 21.59);
  assert.equal(converted.pageHeight, 27.94);
});

test('preset detection recognizes standard paper sizes and orientation', () => {
  assert.deepEqual(detectPagePreset(8.5, 11, 'in'), {
    presetId: 'letter',
    orientation: 'portrait',
  });
  assert.deepEqual(detectPagePreset(11.69, 8.27, 'in'), {
    presetId: 'a4',
    orientation: 'landscape',
  });
  assert.deepEqual(detectPagePreset(21, 29.7, 'cm'), {
    presetId: 'a4',
    orientation: 'portrait',
  });
});

test('finite page dimensions convert to tiled pixel bounds', () => {
  const dimensions = getPageSetupDimensionsPx(
    normalizePageSetup({
      mode: 'finite',
      unit: 'in',
      presetId: 'letter',
      orientation: 'portrait',
      rows: 2,
      columns: 3,
    }),
  );

  assert.equal(dimensions.pageWidthPx, 612);
  assert.equal(dimensions.pageHeightPx, 792);
  assert.equal(dimensions.totalWidthPx, 1836);
  assert.equal(dimensions.totalHeightPx, 1584);
});

test('ChemDraw document conversion carries finite page setup into page bounds', () => {
  const pageSetup = normalizePageSetup({
    mode: 'finite',
    unit: 'in',
    presetId: 'a4',
    orientation: 'landscape',
    rows: 2,
    columns: 1,
  });
  const document = canvasStateToChemDrawDocument(
    { atoms: [], bonds: [], arrows: [], groups: [], textBoxes: [] },
    { pageSetup },
  ).document;

  assert.equal(document.metadata?.pageSetup?.presetId, 'a4');
  assert.equal(document.metadata?.widthPages, 1);
  assert.equal(document.metadata?.heightPages, 2);
  assert.equal(document.pages[0]?.bounds?.right, 841.68);
  assert.equal(document.pages[0]?.bounds?.bottom, 1190.8799999999999);
});

test('import inference recognizes standard presets from generic page bounds', () => {
  const pageSetup = inferImportedPageSetup({
    unit: 'in',
    rows: 1,
    columns: 1,
    pageBounds: { left: 0, top: 0, right: 595.44, bottom: 841.68 },
  });

  assert.equal(pageSetup.mode, 'finite');
  assert.equal(pageSetup.presetId, 'a4');
  assert.equal(pageSetup.orientation, 'portrait');
  assert.equal(pageSetup.pageWidth, 8.27);
  assert.equal(pageSetup.pageHeight, 11.69);
});

test('CDXML export preserves finite page setup rows and columns in metadata', () => {
  const document = canvasStateToChemDrawDocument(
    { atoms: [], bonds: [], arrows: [], groups: [], textBoxes: [] },
    {
      pageSetup: normalizePageSetup({
        mode: 'finite',
        unit: 'cm',
        presetId: 'custom',
        orientation: 'portrait',
        pageWidth: 12,
        pageHeight: 18,
        rows: 3,
        columns: 2,
      }),
    },
  ).document;

  const cdxml = chemDrawDocumentToCDXML(document);
  assert.match(cdxml, /ChemEditorPageUnit="cm"/);
  assert.match(cdxml, /ChemEditorPageWidth="12"/);
  assert.match(cdxml, /ChemEditorPageHeight="18"/);
  assert.match(cdxml, /ChemEditorPageRows="3"/);
  assert.match(cdxml, /ChemEditorPageColumns="2"/);
  assert.match(cdxml, /WidthPages="2"/);
  assert.match(cdxml, /HeightPages="3"/);
});

test('normalizePageSetup keeps infinite mode defaults stable', () => {
  const normalized = normalizePageSetup(undefined);

  assert.equal(normalized.mode, DEFAULT_PAGE_SETUP.mode);
  assert.equal(normalized.unit, DEFAULT_PAGE_SETUP.unit);
  assert.equal(normalized.presetId, DEFAULT_PAGE_SETUP.presetId);
});

test('toolbar preferences backfill the text palette for older saved layouts', () => {
  const normalized = normalizeAppPreferences({
    toolPalettes: {
      order: ['tools', 'ring', 'arrow', 'atom', 'charge'],
      items: {
        tools: { docked: true, collapsed: false, position: { x: 1, y: 2 } },
        ring: { docked: false, collapsed: true, position: { x: 3, y: 4 } },
        arrow: { docked: true, collapsed: false, position: { x: 5, y: 6 } },
        atom: { docked: true, collapsed: true, position: { x: 7, y: 8 } },
        charge: { docked: false, collapsed: false, position: { x: 9, y: 10 } },
      },
    },
  });

  assert.deepEqual(DEFAULT_TOOL_PALETTE_ORDER, [
    'tools',
    'ring',
    'arrow',
    'text',
    'atom',
    'charge',
  ]);
  assert.equal(normalized.toolPalettes.order.at(-1), 'text');
  assert.equal(normalized.toolPalettes.items.text.docked, true);
  assert.equal(normalized.toolPalettes.items.text.collapsed, true);
  assert.equal(normalized.toolPalettes.items.text.position.x, 88);
  assert.equal(normalized.toolPalettes.items.text.position.y, 324);
  assert.equal(normalized.toolPalettes.items.tools.collapsed, false);
  assert.equal(normalized.toolPalettes.items.ring.docked, false);
});

test('viewer preferences normalize hartree-fock orbital defaults and persisted values', () => {
  const normalized = normalizeAppPreferences({
    viewer: {
      forceField: 'hartree-fock',
      orbitals: {
        basis: '6-31G*',
        opacity: 0.7,
        positiveColor: '#123456',
        negativeColor: '#654321',
        material: 'glassy',
        outline: false,
        isovalue: 0.06,
        showPositivePhase: false,
        showNegativePhase: true,
      },
    },
  });

  assert.equal(normalized.version, 8);
  assert.equal(normalized.viewer.forceField, 'hartree-fock');
  assert.equal(normalized.viewer.orbitals.basis, '6-31G*');
  assert.equal(normalized.viewer.orbitals.opacity, 0.7);
  assert.equal(normalized.viewer.orbitals.positiveColor, '#123456');
  assert.equal(normalized.viewer.orbitals.negativeColor, '#654321');
  assert.equal(normalized.viewer.orbitals.material, 'glassy');
  assert.equal(normalized.viewer.orbitals.outline, false);
  assert.equal(normalized.viewer.orbitals.isovalue, 0.06);
  assert.equal(normalized.viewer.orbitals.showPositivePhase, false);
  assert.equal(normalized.viewer.orbitals.showNegativePhase, true);
});

test('viewer orbital preferences backfill defaults for older saved settings', () => {
  const normalized = normalizeAppPreferences({
    viewer: {
      forceField: 'hartree-fock',
    },
  });

  assert.equal(normalized.viewer.orbitals.basis, '3-21G');
  assert.equal(normalized.viewer.orbitals.opacity, 0.52);
  assert.equal(normalized.viewer.orbitals.positiveColor, '#2563eb');
  assert.equal(normalized.viewer.orbitals.negativeColor, '#ef4444');
  assert.equal(normalized.viewer.orbitals.material, 'solid');
  assert.equal(normalized.viewer.orbitals.outline, true);
  assert.equal(normalized.viewer.orbitals.isovalue, 0.045);
  assert.equal(normalized.viewer.orbitals.showPositivePhase, true);
  assert.equal(normalized.viewer.orbitals.showNegativePhase, true);
});

test('legacy untouched drawing defaults migrate to the ACS 1996 baseline', () => {
  const legacyDefaultDrawing = normalizeDocumentStyleSettings({
    bondLength: 45,
    textFormat: {
      fontFamily: 'Helvetica',
      fontSize: 31.25,
      color: '#000000',
      textAlign: 'center',
    },
    colors: DEFAULT_DOCUMENT_STYLE_SETTINGS.colors,
    nativeMetrics: DEFAULT_DOCUMENT_STYLE_SETTINGS.nativeMetrics,
  });

  const normalized = normalizeAppPreferences({
    version: 7,
    drawing: legacyDefaultDrawing,
    documentView: { atomColorViewMode: 'enhanced-defaults' },
  });

  assert.equal(normalized.version, 8);
  assert.equal(normalized.drawing.bondLength, DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength);
  assert.equal(normalized.drawing.bondLineWidth, DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLineWidth);
  assert.equal(
    normalized.documentView.atomColorViewMode,
    DEFAULT_DOCUMENT_VIEW_SETTINGS.atomColorViewMode,
  );
});
