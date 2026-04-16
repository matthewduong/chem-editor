import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_CHEMDRAW_CAPTION_FONT_SIZE,
  DEFAULT_CHEMDRAW_LABEL_FONT_SIZE,
  DEFAULT_CANVAS_BOND_LENGTH,
  DEFAULT_CHEMDRAW_STYLE_SHEET,
  resolveArrowGeometryMetrics,
  resolveBondSpacing,
  resolveDocumentLabelFaceStyle,
  resolveDocumentCaptionTextStyle,
  resolveDocumentLabelTextStyle,
  resolveDocumentRenderMetrics,
} from '../.unit-test-dist/src/lib/chemdrawMetrics.js';
import { buildAtomLabelRuns } from '../.unit-test-dist/src/lib/atomLabelPresentation.js';
import {
  canvasStateToChemDrawDocument,
  chemDrawDocumentToCanvasState,
  mergeCanvasStateIntoChemDrawDocument,
} from '../.unit-test-dist/src/lib/chemdrawModel.js';
import {
  getAtomBondClipOffset,
  getBondVisualMetrics,
} from '../.unit-test-dist/src/lib/renderGeometry.js';
import {
  DEFAULT_DOCUMENT_VIEW_SETTINGS,
  DEFAULT_DOCUMENT_STYLE_SETTINGS,
  normalizeDocumentStyleSettings,
  resolveAtomLabelColor,
  resolveAtomLabelColorLayers,
  resolveBondColor,
} from '../.unit-test-dist/src/lib/settings.js';
import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
  stateToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';

function approxEqual(actual, expected, epsilon = 1e-6) {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`,
  );
}

const HIGH_FIDELITY_STYLE = normalizeDocumentStyleSettings({
  bondLength: 60,
  textFormat: {
    fontFamily: 'Times New Roman',
    fontSize: 28,
    color: '#000000',
    textAlign: 'center',
  },
  colors: DEFAULT_DOCUMENT_STYLE_SETTINGS.colors,
  nativeMetrics: {
    ...DEFAULT_CHEMDRAW_STYLE_SHEET,
    lineWidth: 2,
    boldWidth: 6,
    bondSpacingPct: 20,
    marginWidth: 4,
    hashSpacing: 5,
    labelSize: 12,
    captionSize: 14,
    labelFace: 96,
    captionFace: 2,
    labelFontFamily: 'Helvetica',
    captionFontFamily: 'Times New Roman',
  },
});

const IMPORTED_NATIVE_BOND_LENGTH = 40;
const IMPORTED_NATIVE_SCALE = DEFAULT_CANVAS_BOND_LENGTH / IMPORTED_NATIVE_BOND_LENGTH;
const IMPORTED_NATIVE_SETTINGS = normalizeDocumentStyleSettings({
  bondLength: DEFAULT_CANVAS_BOND_LENGTH,
  textFormat: {
    fontFamily: 'Times New Roman',
    fontSize: 13 * IMPORTED_NATIVE_SCALE,
    color: '#000000',
    textAlign: 'center',
  },
  colors: DEFAULT_DOCUMENT_STYLE_SETTINGS.colors,
  nativeMetrics: {
    ...DEFAULT_CHEMDRAW_STYLE_SHEET,
    bondLength: IMPORTED_NATIVE_BOND_LENGTH,
    lineWidth: 1.25,
    boldWidth: 5.5,
    bondSpacingPct: 18,
    marginWidth: 3,
    hashSpacing: 4,
    labelSize: 11,
    captionSize: 13,
    labelFace: 96,
    captionFace: 2,
    labelFontFamily: 'Helvetica',
    captionFontFamily: 'Times New Roman',
  },
});

const IMPORTED_NATIVE_DOCUMENT = {
  schemaVersion: 1,
  source: 'cdxml-import',
  pages: [
    {
      id: 'page-1',
      objects: [
        {
          id: 'n1',
          type: 'node',
          position: { x: 40 * IMPORTED_NATIVE_SCALE, y: 50 * IMPORTED_NATIVE_SCALE },
          element: 'C',
          text: { runs: [{ text: 'C' }], justification: 'center' },
          style: { fontFamily: 'Helvetica', fontSize: 11 },
        },
        {
          id: 'n2',
          type: 'node',
          position: { x: 80 * IMPORTED_NATIVE_SCALE, y: 50 * IMPORTED_NATIVE_SCALE },
          element: 'O',
          text: { runs: [{ text: 'O' }], justification: 'center' },
          style: { fontFamily: 'Helvetica', fontSize: 11 },
        },
        {
          id: 'b1',
          type: 'bond',
          beginNodeId: 'n1',
          endNodeId: 'n2',
          order: 2,
          bondSpacingPct: 22,
          style: { lineWidth: 1.5 },
        },
        {
          id: 'frag-1',
          type: 'fragment',
          nodeIds: ['n1', 'n2'],
          bondIds: ['b1'],
        },
        {
          id: 'a1',
          type: 'arrow',
          arrowType: 'reaction',
          tail: { x: 100 * IMPORTED_NATIVE_SCALE, y: 60 * IMPORTED_NATIVE_SCALE },
          head: { x: 130 * IMPORTED_NATIVE_SCALE, y: 60 * IMPORTED_NATIVE_SCALE },
          headSize: 8,
          headCenterSize: 6,
          headWidth: 4,
          shaftSpacing: 3,
          equilibriumRatio: 0.82,
          style: { lineWidth: 1.4 },
        },
        {
          id: 't1',
          type: 'text',
          anchor: { x: 40 * IMPORTED_NATIVE_SCALE, y: 90 * IMPORTED_NATIVE_SCALE },
          text: { runs: [{ text: 'note' }], justification: 'center' },
          style: { fontFamily: 'Times New Roman', fontSize: 13, color: '#000000' },
        },
      ],
    },
  ],
  metadata: {
    bondLength: IMPORTED_NATIVE_SETTINGS.nativeMetrics.bondLength,
    labelSize: IMPORTED_NATIVE_SETTINGS.nativeMetrics.labelSize,
    captionSize: IMPORTED_NATIVE_SETTINGS.nativeMetrics.captionSize,
    documentStyleSettings: IMPORTED_NATIVE_SETTINGS,
  },
};

const NATIVE_STYLE_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<CDXML BondLength="40" BoldWidth="5.5" LineWidth="1.25" BondSpacing="18" MarginWidth="3" HashSpacing="4" LabelFont="2" CaptionFont="3" LabelSize="11" CaptionSize="13" LabelFace="96" CaptionFace="2">
  <colortable>
    <color r="0" g="0" b="0"/>
    <color r="1" g="0" b="0"/>
  </colortable>
  <fonttable>
    <font id="1" charset="iso-8859-1" name="Arial"/>
    <font id="2" charset="iso-8859-1" name="Helvetica"/>
    <font id="3" charset="iso-8859-1" name="Times New Roman"/>
  </fonttable>
  <page id="page-1" BoundingBox="0 0 220 180">
    <fragment id="frag-1">
      <n id="n1" p="40 50" Element="6">
        <t p="40 50">
          <s font="2" size="11" face="96" color="0">C</s>
        </t>
      </n>
      <n id="n2" p="80 50" Element="8">
        <t p="80 50">
          <s font="2" size="11" face="96" color="0">O</s>
        </t>
      </n>
      <b id="b1" B="n1" E="n2" Order="2" LineWidth="1.5" BondSpacing="22"/>
    </fragment>
    <arrow id="a1" Head3D="130 60 0" Tail3D="100 60 0" LineWidth="1.4" HeadSize="800" ArrowheadCenterSize="600" ArrowheadWidth="400" ArrowShaftSpacing="300" ArrowEquilibriumRatio="0.82" ArrowheadHead="Full" ArrowheadType="Solid" FillType="None"/>
    <t p="40 90" Justification="Center">
      <s font="3" size="13" face="2" color="0">note</s>
    </t>
  </page>
</CDXML>`;

test('default style settings match the ACS 1996 ChemDraw metrics', () => {
  assert.equal(DEFAULT_CANVAS_BOND_LENGTH, 14.4);
  assert.equal(DEFAULT_CHEMDRAW_STYLE_SHEET.bondLength, 14.4);
  assert.equal(DEFAULT_CHEMDRAW_STYLE_SHEET.lineWidth, 0.6);
  assert.equal(DEFAULT_CHEMDRAW_STYLE_SHEET.boldWidth, 2);
  assert.equal(DEFAULT_CHEMDRAW_STYLE_SHEET.bondSpacingPct, 18);
  assert.equal(DEFAULT_CHEMDRAW_STYLE_SHEET.marginWidth, 1.6);
  assert.equal(DEFAULT_CHEMDRAW_STYLE_SHEET.hashSpacing, 2.5);
  assert.equal(DEFAULT_CHEMDRAW_STYLE_SHEET.labelSize, 10);
  assert.equal(DEFAULT_CHEMDRAW_STYLE_SHEET.captionSize, 10);
  assert.equal(DEFAULT_CHEMDRAW_STYLE_SHEET.labelFontFamily, 'Helvetica');
  assert.equal(DEFAULT_CHEMDRAW_STYLE_SHEET.captionFontFamily, 'Helvetica');
  approxEqual(DEFAULT_CHEMDRAW_LABEL_FONT_SIZE, 10);
  approxEqual(DEFAULT_CHEMDRAW_CAPTION_FONT_SIZE, 10);

  assert.equal(DEFAULT_DOCUMENT_STYLE_SETTINGS.textFormat.fontFamily, 'Helvetica');
  assert.equal(DEFAULT_DOCUMENT_STYLE_SETTINGS.colors.monochrome, true);
  approxEqual(DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLength, 14.4);
  approxEqual(DEFAULT_DOCUMENT_STYLE_SETTINGS.bondLineWidth, 0.6);
  approxEqual(DEFAULT_DOCUMENT_STYLE_SETTINGS.textFormat.fontSize, 10);
  assert.equal(DEFAULT_DOCUMENT_VIEW_SETTINGS.atomColorViewMode, 'enhanced-defaults');
});

test('shared text-style resolvers keep label and caption sizing document-driven', () => {
  const labelDefaults = resolveDocumentLabelTextStyle(HIGH_FIDELITY_STYLE);
  approxEqual(labelDefaults.fontSize, 50);
  assert.equal(labelDefaults.fontFamily, 'Helvetica');
  assert.deepEqual(resolveDocumentLabelFaceStyle(HIGH_FIDELITY_STYLE), {});

  const labelFromNative = resolveDocumentLabelTextStyle(HIGH_FIDELITY_STYLE, {
    nativeStyle: { fontFamily: 'Arial', fontSize: 11 },
  });
  approxEqual(labelFromNative.fontSize, (11 * HIGH_FIDELITY_STYLE.bondLength) / 14.4);
  assert.equal(labelFromNative.fontFamily, 'Arial');

  const labelFromAuthor = resolveDocumentLabelTextStyle(HIGH_FIDELITY_STYLE, {
    authored: { fontFamily: 'Courier', fontSize: 18 },
    nativeStyle: { fontFamily: 'Arial', fontSize: 11 },
  });
  approxEqual(labelFromAuthor.fontSize, 18);
  assert.equal(labelFromAuthor.fontFamily, 'Courier');

  const captionDefaults = resolveDocumentCaptionTextStyle(HIGH_FIDELITY_STYLE);
  approxEqual(captionDefaults.fontSize, HIGH_FIDELITY_STYLE.textFormat.fontSize);
  assert.equal(captionDefaults.fontFamily, 'Times New Roman');

  const captionFromNative = resolveDocumentCaptionTextStyle(HIGH_FIDELITY_STYLE, {
    nativeStyle: { fontFamily: 'Georgia', fontSize: 13 },
  });
  approxEqual(captionFromNative.fontSize, (13 * HIGH_FIDELITY_STYLE.bondLength) / 14.4);
  assert.equal(captionFromNative.fontFamily, 'Georgia');
});

test('implicit atom labels stay plain-weight by default while explicit bold runs remain explicit', () => {
  const implicitRuns = buildAtomLabelRuns(
    { id: 'o1', x: 0, y: 0, kind: 'element', element: 'O' },
    'O',
    '#ff0000',
    DEFAULT_DOCUMENT_STYLE_SETTINGS,
    DEFAULT_DOCUMENT_VIEW_SETTINGS,
    false,
  );
  assert.equal(implicitRuns.length, 1);
  assert.equal(implicitRuns[0].bold, undefined);
  assert.equal(implicitRuns[0].italic, undefined);

  const explicitRuns = buildAtomLabelRuns(
    {
      id: 'a1',
      x: 0,
      y: 0,
      kind: 'alias',
      element: 'C',
      alias: 'Me',
      labelRuns: [{ text: 'Me', bold: true }],
    },
    'Me',
    '#000000',
    DEFAULT_DOCUMENT_STYLE_SETTINGS,
    DEFAULT_DOCUMENT_VIEW_SETTINGS,
    false,
  );
  assert.deepEqual(explicitRuns, [{ text: 'Me', bold: true }]);

  const boldFaceSettings = normalizeDocumentStyleSettings({
    nativeMetrics: {
      ...DEFAULT_CHEMDRAW_STYLE_SHEET,
      labelFace: 97,
    },
  });
  assert.deepEqual(resolveDocumentLabelFaceStyle(boldFaceSettings), { bold: true });
});

test('explicit authored colors survive monochrome ChemDraw document defaults', () => {
  const settings = normalizeDocumentStyleSettings({
    colors: {
      ...DEFAULT_DOCUMENT_STYLE_SETTINGS.colors,
      monochrome: true,
    },
  });

  assert.equal(resolveBondColor('#ff0000', settings, false), '#ff0000');
  assert.equal(resolveBondColor('#000000', settings, true), '#ffffff');
  assert.equal(resolveAtomLabelColor('#00aa00', 'O', settings, false), '#00aa00');
  assert.equal(resolveAtomLabelColor('#000000', 'N', settings, true), '#ffffff');
  assert.equal(resolveBondColor(undefined, settings, false), '#000000');
});

test('enhanced atom-color view only overlays implicit atom labels', () => {
  const settings = normalizeDocumentStyleSettings({
    colors: {
      ...DEFAULT_DOCUMENT_STYLE_SETTINGS.colors,
      monochrome: true,
    },
  });
  const enhancedViewSettings = { atomColorViewMode: 'enhanced-defaults' };

  const oxygen = resolveAtomLabelColorLayers(undefined, 'O', settings, false, enhancedViewSettings);
  const carbon = resolveAtomLabelColorLayers(undefined, 'C', settings, false, enhancedViewSettings);

  assert.equal(oxygen.documentDefaultColor, '#000000');
  assert.equal(oxygen.displayOverlayColor, settings.colors.atomColors.O);
  assert.equal(oxygen.resolvedColor, settings.colors.atomColors.O);
  assert.equal(carbon.documentDefaultColor, '#000000');
  assert.equal(carbon.displayOverlayColor, settings.colors.atomColors.C);
  assert.equal(carbon.resolvedColor, settings.colors.atomColors.C);
  assert.equal(
    resolveAtomLabelColor('#00aa00', 'O', settings, false, enhancedViewSettings),
    '#00aa00',
  );
  assert.equal(resolveBondColor(undefined, settings, false), '#000000');
});

test('resolved native document metrics drive bond, hash, and label spacing', () => {
  const metrics = resolveDocumentRenderMetrics(HIGH_FIDELITY_STYLE);
  approxEqual(metrics.canvasScale, 60 / 14.4);
  approxEqual(metrics.lineWidth, 8.333333333333334);
  approxEqual(metrics.boldWidth, 25);
  approxEqual(metrics.bondSpacing, 12);
  approxEqual(metrics.marginWidth, 16.666666666666668);
  approxEqual(metrics.hashSpacing, 20.833333333333336);
  approxEqual(metrics.labelFontSize, 50);
  approxEqual(metrics.captionFontSize, 28);

  const baseVisual = getBondVisualMetrics(metrics.lineWidth, HIGH_FIDELITY_STYLE.bondLength, {
    documentStyleSettings: HIGH_FIDELITY_STYLE,
  });
  approxEqual(baseVisual.parallelOffset, 12);
  approxEqual(baseVisual.boldWidth, 25);
  approxEqual(baseVisual.ringInsetBase, metrics.marginWidth);
  approxEqual(baseVisual.tripleInlineInset, metrics.marginWidth);
  assert.equal(baseVisual.hashStepCount, 3);

  approxEqual(resolveBondSpacing(HIGH_FIDELITY_STYLE, { bondSpacingPct: 25 }), 15);
  approxEqual(resolveBondSpacing(HIGH_FIDELITY_STYLE, { bondSpacingAbs: 8 }), 33.333333333333336);

  const overriddenVisual = getBondVisualMetrics(metrics.lineWidth, HIGH_FIDELITY_STYLE.bondLength, {
    documentStyleSettings: HIGH_FIDELITY_STYLE,
    nativeBond: { bondSpacingAbs: 8 },
  });
  approxEqual(overriddenVisual.parallelOffset, 33.333333333333336);

  const oxygen = { id: 'o1', x: 0, y: 0, kind: 'element', element: 'O' };
  const defaultClip = getAtomBondClipOffset(
    oxygen,
    [oxygen],
    [],
    1,
    0,
    DEFAULT_DOCUMENT_STYLE_SETTINGS,
  );
  const customClip = getAtomBondClipOffset(oxygen, [oxygen], [], 1, 0, HIGH_FIDELITY_STYLE);
  assert.ok(customClip > defaultClip, 'expected larger MarginWidth to widen label clipping');
});

test('arrow geometry honors native defaults and explicit ChemDraw overrides across arrow types', () => {
  const arrowTypes = [
    'reaction',
    'equilibrium',
    'retrosynthetic',
    'curved',
    'half-curved',
    'no-reaction',
    'resonance',
    'fat',
  ];

  for (const type of arrowTypes) {
    const defaults = resolveArrowGeometryMetrics({ type }, HIGH_FIDELITY_STYLE);
    assert.ok(defaults.lineWidth > 0, `${type} should resolve a positive line width`);
    assert.ok(defaults.headSize >= defaults.lineWidth, `${type} head should scale with line width`);
    assert.ok(defaults.headWidth > 0, `${type} head width should stay positive`);
    assert.ok(defaults.headCenterSize > 0, `${type} center head size should stay positive`);
  }

  const boldReaction = resolveArrowGeometryMetrics(
    { type: 'reaction', lineStyle: 'bold' },
    HIGH_FIDELITY_STYLE,
  );
  approxEqual(boldReaction.lineWidth, 25);

  const fatArrow = resolveArrowGeometryMetrics({ type: 'fat' }, HIGH_FIDELITY_STYLE);
  approxEqual(fatArrow.lineWidth, 50);

  const nativeOverride = {
    headSize: 9,
    headCenterSize: 7,
    headWidth: 5,
    shaftSpacing: 4,
    equilibriumRatio: 0.82,
    style: { lineWidth: 1.6, lineType: 'solid' },
  };

  for (const type of arrowTypes) {
    const overridden = resolveArrowGeometryMetrics({ type }, HIGH_FIDELITY_STYLE, nativeOverride);
    approxEqual(overridden.lineWidth, 6.666666666666668);
    approxEqual(overridden.headSize, 37.5);
    approxEqual(overridden.headCenterSize, 29.166666666666668);
    approxEqual(overridden.headWidth, 20.833333333333336);
    approxEqual(overridden.shaftSpacing, 16.666666666666668);
    approxEqual(overridden.equilibriumRatio, 0.82);
  }
});

test('app-authored canvas documents export ACS 1996 ChemDraw defaults and round-trip through the document model without geometry drift', () => {
  const state = {
    atoms: [
      { id: 'a1', x: 0, y: 0, kind: 'element', element: 'C' },
      { id: 'a2', x: DEFAULT_CANVAS_BOND_LENGTH, y: 0, kind: 'element', element: 'O' },
    ],
    bonds: [{ id: 'b1', from: 'a1', to: 'a2', order: 1, stereo: 0 }],
    arrows: [],
    groups: [],
    textBoxes: [],
  };

  const xml = stateToCDXML(state, { documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS });
  assert.match(xml, /\bBondLength="14\.4(?:0+)?"/);
  assert.match(xml, /\bLineWidth="0\.6(?:0+)?"/);
  assert.match(xml, /\bBoldWidth="2(?:\.0+)?"/);
  assert.match(xml, /\bBondSpacing="18(?:\.0+)?"/);
  assert.match(xml, /\bMarginWidth="1\.6(?:0+)?"/);
  assert.match(xml, /\bHashSpacing="2\.5(?:0+)?"/);
  assert.match(xml, /\bLabelFont="2"/);
  assert.match(xml, /\bCaptionFont="2"/);
  assert.match(xml, /\bChemEditorBondLength="14\.4(?:0+)?"/);
  assert.match(xml, /\bChemEditorMonochrome="true"/);

  const { document } = canvasStateToChemDrawDocument(state, {
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
  });
  approxEqual(document.metadata.documentStyleSettings.nativeMetrics.bondLength, 14.4);
  approxEqual(document.metadata.documentStyleSettings.bondLength, 14.4);

  const projected = chemDrawDocumentToCanvasState(document).state;
  const byId = new Map(projected.atoms.map((atom) => [atom.id, atom]));
  approxEqual(byId.get('a1').x, 0);
  approxEqual(byId.get('a1').y, 0);
  approxEqual(byId.get('a2').x, DEFAULT_CANVAS_BOND_LENGTH);
  approxEqual(byId.get('a2').y, 0);
});

test('native document style-sheet metrics and explicit arrow geometry survive project-save round-trips', () => {
  const importedSettings = IMPORTED_NATIVE_DOCUMENT.metadata.documentStyleSettings;
  assert.equal(importedSettings.nativeMetrics.bondLength, 40);
  assert.equal(importedSettings.nativeMetrics.lineWidth, 1.25);
  assert.equal(importedSettings.nativeMetrics.boldWidth, 5.5);
  assert.equal(importedSettings.nativeMetrics.bondSpacingPct, 18);
  assert.equal(importedSettings.nativeMetrics.marginWidth, 3);
  assert.equal(importedSettings.nativeMetrics.hashSpacing, 4);
  assert.equal(importedSettings.nativeMetrics.labelSize, 11);
  assert.equal(importedSettings.nativeMetrics.captionSize, 13);
  assert.equal(importedSettings.nativeMetrics.labelFace, 96);
  assert.equal(importedSettings.nativeMetrics.captionFace, 2);
  assert.equal(importedSettings.nativeMetrics.labelFontFamily, 'Helvetica');
  assert.equal(importedSettings.nativeMetrics.captionFontFamily, 'Times New Roman');
  approxEqual(importedSettings.textFormat.fontSize, 13 * IMPORTED_NATIVE_SCALE);

  const projected = chemDrawDocumentToCanvasState(IMPORTED_NATIVE_DOCUMENT).state;
  const merged = mergeCanvasStateIntoChemDrawDocument(IMPORTED_NATIVE_DOCUMENT, projected).document;
  const exported = chemDrawDocumentToCDXML(merged);

  assert.match(exported, /\bBondLength="40(?:\.0+)?"/);
  assert.match(exported, /\bLineWidth="1\.25(?:0+)?"/);
  assert.match(exported, /\bBoldWidth="5\.5(?:0+)?"/);
  assert.match(exported, /\bBondSpacing="18(?:\.0+)?"/);
  assert.match(exported, /\bMarginWidth="3(?:\.0+)?"/);
  assert.match(exported, /\bHashSpacing="4(?:\.0+)?"/);
  assert.match(exported, /\bLabelSize="11(?:\.0+)?"/);
  assert.match(exported, /\bCaptionSize="13(?:\.0+)?"/);
  assert.match(exported, /\bLabelFace="96"/);
  assert.match(exported, /\bCaptionFace="2"/);
  assert.match(exported, /\bp="40(?:\.0+)? 50(?:\.0+)?"/);
  assert.match(exported, /\bp="80(?:\.0+)? 50(?:\.0+)?"/);
  assert.match(exported, /\bHead3D="130(?:\.0+)? 60(?:\.0+)? 0"/);
  assert.match(exported, /\bTail3D="100(?:\.0+)? 60(?:\.0+)? 0"/);
  assert.match(exported, /\bHeadSize="800(?:\.0+)?"/);
  assert.match(exported, /\bArrowheadCenterSize="600(?:\.0+)?"/);
  assert.match(exported, /\bArrowheadWidth="400(?:\.0+)?"/);
  assert.match(exported, /\bArrowShaftSpacing="300(?:\.0+)?"/);
  assert.match(exported, /\bArrowheadType="Solid"/);
  assert.match(exported, /\bArrowEquilibriumRatio="0\.82(?:0+)?"/);
});

test('document atom-color view mode does not change exported CDXML semantics', () => {
  const state = {
    atoms: [
      { id: 'a1', x: 0, y: 0, kind: 'element', element: 'C' },
      { id: 'a2', x: DEFAULT_CANVAS_BOND_LENGTH, y: 0, kind: 'element', element: 'O' },
    ],
    bonds: [{ id: 'b1', from: 'a1', to: 'a2', order: 1, stereo: 0 }],
    arrows: [],
    groups: [],
    textBoxes: [],
  };
  const document = canvasStateToChemDrawDocument(state, {
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
  }).document;

  const enhancedXml = chemDrawDocumentToCDXML({
    ...document,
    metadata: {
      ...document.metadata,
      documentViewSettings: { atomColorViewMode: 'enhanced-defaults' },
    },
  });
  const fidelityXml = chemDrawDocumentToCDXML({
    ...document,
    metadata: {
      ...document.metadata,
      documentViewSettings: { atomColorViewMode: 'chemdraw-fidelity' },
    },
  });

  assert.equal(enhancedXml, fidelityXml);
});

test(
  'native CDXML import preserves standard style-sheet metrics when DOMParser is available',
  { skip: typeof DOMParser === 'undefined' },
  () => {
    const imported = cdxmlToChemDrawDocument(NATIVE_STYLE_FIXTURE);
    const importedSettings = imported.document.metadata.documentStyleSettings;
    assert.equal(importedSettings.nativeMetrics.bondLength, 40);
    assert.equal(importedSettings.nativeMetrics.lineWidth, 1.25);
    assert.equal(importedSettings.nativeMetrics.boldWidth, 5.5);
    assert.equal(importedSettings.nativeMetrics.bondSpacingPct, 18);
    assert.equal(importedSettings.nativeMetrics.marginWidth, 3);
    assert.equal(importedSettings.nativeMetrics.hashSpacing, 4);
    assert.equal(importedSettings.nativeMetrics.labelSize, 11);
    assert.equal(importedSettings.nativeMetrics.captionSize, 13);
    assert.equal(importedSettings.nativeMetrics.labelFace, 96);
    assert.equal(importedSettings.nativeMetrics.captionFace, 2);
    assert.equal(importedSettings.nativeMetrics.labelFontFamily, 'Helvetica');
    assert.equal(importedSettings.nativeMetrics.captionFontFamily, 'Times New Roman');

    const arrow = imported.document.pages[0].objects.find((object) => object.type === 'arrow');
    assert.equal(arrow?.headType, 'solid');
    approxEqual(arrow?.headSize ?? 0, 8);
    approxEqual(arrow?.headCenterSize ?? 0, 6);
    approxEqual(arrow?.headWidth ?? 0, 4);
    approxEqual(arrow?.shaftSpacing ?? 0, 3);
  },
);
