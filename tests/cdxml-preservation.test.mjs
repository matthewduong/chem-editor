import test from 'node:test';
import assert from 'node:assert/strict';

import { chemDrawDocumentToCDXML } from '../.unit-test-dist/src/utils/cdxml.js';
import {
  getChemDrawObjectCapability,
  prepareChemDrawDocumentForSave,
  summarizeChemDrawCompatibility,
} from '../.unit-test-dist/src/lib/chemdrawDocumentCommands.js';
import {
  deleteSelectedObjects as deleteSelectedNativeObjects,
  applyNodeValueEdit as applyNativeNodeValueEdit,
} from '../.unit-test-dist/src/lib/chemdrawModel.js';

test('ChemDraw export preserves raw attributes, child XML, and unsupported page children', () => {
  const document = {
    schemaVersion: 1,
    source: 'cdxml-import',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'n1',
            type: 'node',
            position: { x: 10, y: 12 },
            alias: 'TMS',
            text: {
              runs: [{ text: 'TMS' }],
              justification: 'center',
            },
            preservation: {
              capability: 'round-trip-only',
              rawAttributes: { Z: '42' },
              rawChildrenXml: ['<fragment id="nested-frag"><n id="nested-n" p="1 1"/></fragment>'],
            },
          },
          {
            id: 'f1',
            type: 'fragment',
            nodeIds: ['n1'],
            bondIds: [],
          },
          {
            id: 't1',
            type: 'text',
            anchor: { x: 22, y: 24 },
            text: {
              runs: [{ text: 'Conditions' }],
              justification: 'left',
            },
            style: {
              fontFamily: 'Arial',
              fontSize: 12,
              color: '#000000',
            },
            preservation: {
              capability: 'round-trip-only',
              rawAttributes: { Interpretation: 'ChemDraw' },
              rawChildrenXml: ['<annotation id="ann1"/>'],
            },
          },
          {
            id: 'g1',
            type: 'graphic',
            graphicType: 'unknown',
            bounds: { left: 30, top: 10, right: 44, bottom: 18 },
            preservation: {
              capability: 'render-only',
              rawAttributes: { CustomKind: 'Cloud' },
              rawChildrenXml: ['<objecttag id="ot1" Name="extraTag"/>'],
            },
          },
        ],
        preservedPageChildren: [
          {
            tagName: 'table',
            xml: '<table id="tbl1"/>',
            capability: 'render-only',
            reason: 'Preserved raw page child.',
          },
        ],
      },
    ],
    metadata: {
      preservedDocumentAttributes: { CreationProgram: 'ChemDraw' },
      preservedPageAttributes: { CustomPageAttr: '1' },
    },
  };

  const xml = chemDrawDocumentToCDXML(document);
  assert.match(xml, /CreationProgram="ChemDraw"/);
  assert.match(xml, /CustomPageAttr="1"/);
  assert.match(xml, / Z="42"/);
  assert.match(xml, /<fragment id="nested-frag"><n id="nested-n" p="1 1"\/><\/fragment>/);
  assert.match(xml, /Interpretation="ChemDraw"/);
  assert.match(xml, /<annotation id="ann1"\/>/);
  assert.match(xml, /CustomKind="Cloud"/);
  assert.match(xml, /<objecttag id="ot1" Name="extraTag"\/>/);
  assert.match(xml, /<table id="tbl1"\/>/);
});

test('export keeps the default ChemDraw palette slots stable for preserved color indices', () => {
  const document = {
    schemaVersion: 1,
    source: 'cdxml-import',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 't1',
            type: 'text',
            anchor: { x: 22, y: 24 },
            text: {
              runs: [{ text: 'Numbering note', color: '#0000ff' }],
              justification: 'center',
            },
            style: {
              fontFamily: 'Helvetica',
              fontSize: 10,
              color: '#0000ff',
            },
            preservation: {
              capability: 'round-trip-only',
              rawAttributes: {
                color: '8',
                Warning: 'Chemical Interpretation is not possible for this label',
              },
            },
          },
        ],
      },
    ],
  };

  const xml = chemDrawDocumentToCDXML(document);
  const colorMatches = xml.match(/<color r="/g) ?? [];

  assert.ok(colorMatches.length >= 8, 'expected the default ChemDraw palette to be emitted');
  assert.match(xml, /color="8"/);
  assert.match(xml, /<color r="0\.0000" g="0\.0000" b="1\.0000"\/>/);
});

test(
  'embedded objects import and export as typed non-structure page objects',
  { skip: typeof DOMParser === 'undefined' },
  () => {
    const pngHex =
      '89504E470D0A1A0A0000000D4948445200000001000000010802000000907753DE0000000C49444154789C636060000000040001F61738550000000049454E44AE426082';
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CDXML>
  <page id="page-1">
    <embeddedobject id="img1" BoundingBox="10 20 42 52" PNG="${pngHex}" Z="7"/>
  </page>
</CDXML>`;

    const document = chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(xml).document);
    const parsed = cdxmlToChemDrawDocument(xml).document.pages[0].objects.find(
      (object) => object.type === 'embedded-object',
    );

    assert.equal(parsed?.payloadKind, 'png');
    assert.match(parsed?.previewDataUrl ?? '', /^data:image\/png;base64,/);
    assert.match(document, /<embeddedobject id="img1"[^>]*PNG="/);
    assert.match(document, / Z="7"/);
  },
);

test('compatibility summary counts limited-editing objects and preserved page children', () => {
  const document = {
    schemaVersion: 1,
    source: 'cdxml-import',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'n1',
            type: 'node',
            position: { x: 0, y: 0 },
            element: 'C',
          },
          {
            id: 'g1',
            type: 'graphic',
            graphicType: 'line',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 10 },
            ],
            preservation: {
              capability: 'round-trip-only',
              reasons: ['Graphic preserved.'],
            },
          },
          {
            id: 'g2',
            type: 'graphic',
            graphicType: 'unknown',
            bounds: { left: 0, top: 0, right: 10, bottom: 10 },
            preservation: {
              capability: 'render-only',
              reasons: ['Unknown graphic preserved only for export.'],
            },
          },
        ],
        preservedPageChildren: [
          {
            tagName: 'table',
            xml: '<table id="tbl1"/>',
            capability: 'render-only',
            reason: 'Preserved raw page child.',
          },
        ],
      },
    ],
  };

  const summary = summarizeChemDrawCompatibility(document, ['warn-1', 'warn-2']);
  assert.deepEqual(summary, {
    warningCount: 2,
    preservedObjectCount: 3,
    roundTripOnlyCount: 1,
    renderOnlyCount: 1,
    preservedPageChildCount: 1,
    graphicCount: 2,
    objectTagCount: 0,
    embeddedObjectCount: 0,
    tableCount: 0,
  });
  assert.equal(getChemDrawObjectCapability(document.pages[0].objects[0]), 'editable');
  assert.equal(getChemDrawObjectCapability(document.pages[0].objects[1]), 'round-trip-only');
  assert.equal(getChemDrawObjectCapability(document.pages[0].objects[2]), 'render-only');
});

test('save preparation keeps preserved page children attached to the merged document', () => {
  const document = {
    schemaVersion: 1,
    source: 'cdxml-import',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'n1',
            type: 'node',
            position: { x: 5, y: 5 },
            element: 'C',
          },
          {
            id: 'f1',
            type: 'fragment',
            nodeIds: ['n1'],
            bondIds: [],
          },
        ],
        preservedPageChildren: [
          {
            tagName: 'table',
            xml: '<table id="tbl1"/>',
            capability: 'render-only',
            reason: 'Preserved raw page child.',
          },
        ],
      },
    ],
  };

  const prepared = prepareChemDrawDocumentForSave({
    canvasState: {
      atoms: [{ id: 'n1', x: 5, y: 5, kind: 'element', element: 'C' }],
      bonds: [],
      arrows: [],
      groups: [],
      textBoxes: [],
    },
    document,
    documentStyleSettings: {
      bondLength: 45,
      bondLineWidth: 2,
      textFormat: {
        fontFamily: 'Arial',
        fontSize: 14,
        color: '#000000',
        textAlign: 'center',
      },
      colors: {
        bondColor: '#000000',
        monochrome: false,
        atomColors: {},
      },
    },
    pageSetup: {
      mode: 'infinite',
      unit: 'in',
      presetId: 'letter',
      orientation: 'portrait',
      pageWidth: 8.5,
      pageHeight: 11,
      rows: 1,
      columns: 1,
    },
  });

  assert.ok(prepared.document);
  assert.equal(prepared.document.pages[0].preservedPageChildren.length, 1);
  assert.match(prepared.xml, /<table id="tbl1"\/>/);
});

test('render-only objects are protected from deletion and round-trip-only nodes block semantic edits', () => {
  const document = {
    schemaVersion: 1,
    source: 'cdxml-import',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'n1',
            type: 'node',
            position: { x: 10, y: 10 },
            alias: 'R',
            query: {
              type: 'r-group',
              label: 'R',
              rGroupName: 'R',
            },
            preservation: {
              capability: 'round-trip-only',
              reasons: ['Query node preserved.'],
            },
          },
          {
            id: 'g1',
            type: 'graphic',
            graphicType: 'unknown',
            bounds: { left: 0, top: 0, right: 10, bottom: 10 },
            preservation: {
              capability: 'render-only',
              reasons: ['Render-only import.'],
            },
          },
        ],
      },
    ],
  };

  const deleted = deleteSelectedNativeObjects(document, new Set(['g1']));
  assert.equal(
    deleted.pages[0].objects.some((object) => object.id === 'g1'),
    true,
  );

  const edited = applyNativeNodeValueEdit(document, 'n1', 'Ph');
  const editedNode = edited.pages[0].objects.find((object) => object.id === 'n1');
  assert.equal(editedNode.alias, 'R');
});
