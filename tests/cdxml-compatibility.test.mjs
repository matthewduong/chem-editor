import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canvasStateToChemDrawDocument,
  chemDrawDocumentToCanvasState,
} from '../.unit-test-dist/src/lib/chemdrawModel.js';
import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';

test('ChemDraw fragment-style alias nodes preserve node type and label alignment on export', () => {
  const document = {
    schemaVersion: 1,
    source: 'manual',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'n1',
            type: 'node',
            position: { x: 10, y: 20 },
            alias: 'MeLi',
            sourceNodeType: 'Fragment',
            labelAlignment: 'above',
            text: {
              runs: [{ text: 'MeLi' }],
              justification: 'left',
            },
          },
          {
            id: 'f1',
            type: 'fragment',
            nodeIds: ['n1'],
            bondIds: [],
          },
        ],
      },
    ],
  };

  const xml = chemDrawDocumentToCDXML(document);
  assert.match(xml, /NodeType="Fragment"/);
  assert.match(xml, /LabelAlignment="Above"/);
  assert.match(xml, />MeLi</);
});

test('skeletal carbon atoms stay unlabeled on ChemDraw export by default', () => {
  const document = {
    schemaVersion: 1,
    source: 'manual',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'c1',
            type: 'node',
            position: { x: 10, y: 20 },
            element: 'C',
          },
          {
            id: 'c2',
            type: 'node',
            position: { x: 24, y: 20 },
            element: 'C',
          },
          {
            id: 'o1',
            type: 'node',
            position: { x: 38, y: 20 },
            element: 'O',
          },
          {
            id: 'b1',
            type: 'bond',
            beginNodeId: 'c1',
            endNodeId: 'c2',
            order: 1,
          },
          {
            id: 'b2',
            type: 'bond',
            beginNodeId: 'c2',
            endNodeId: 'o1',
            order: 1,
          },
          {
            id: 'f1',
            type: 'fragment',
            nodeIds: ['c1', 'c2', 'o1'],
            bondIds: ['b1', 'b2'],
          },
        ],
      },
    ],
  };

  const xml = chemDrawDocumentToCDXML(document);
  const fragmentMatch = xml.match(/<fragment[^>]*>([\s\S]*?)<\/fragment>/);
  assert.ok(fragmentMatch, 'expected an exported fragment');

  const fragmentXml = fragmentMatch[1];
  assert.equal((fragmentXml.match(/<t\b/g) ?? []).length, 1);
  assert.match(fragmentXml, />OH?<\/s>/);
  assert.doesNotMatch(fragmentXml, />C<\/s>/);
  assert.doesNotMatch(fragmentXml, />CH/);
});

test('explicit ChemDraw-authored carbon labels are preserved on export', () => {
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
            position: { x: 10, y: 20 },
            element: 'C',
            text: {
              runs: [{ text: 'C' }],
              justification: 'center',
            },
          },
          {
            id: 'f1',
            type: 'fragment',
            nodeIds: ['n1'],
            bondIds: [],
          },
        ],
      },
    ],
  };

  const xml = chemDrawDocumentToCDXML(document);
  assert.match(xml, />C<\/s>/);
});

test('dashed curved arrows survive projection into canvas state and CDXML export', () => {
  const document = {
    schemaVersion: 1,
    source: 'manual',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'a1',
            type: 'arrow',
            arrowType: 'curved',
            tail: { x: 10, y: 10 },
            head: { x: 50, y: 30 },
            controlPoint: { x: 32, y: 2 },
            style: {
              lineType: 'dashed',
              strokeColor: '#ff0000',
            },
          },
        ],
      },
    ],
  };

  const { state } = chemDrawDocumentToCanvasState(document);
  assert.equal(state.arrows[0].lineStyle, 'dashed');
  assert.equal(state.arrows[0].strokeColor, '#ff0000');

  const xml = chemDrawDocumentToCDXML(document);
  assert.match(xml, /LineType="Dashed"/);
  assert.match(xml, /CurvePoints="/);
});

test(
  'ChemDraw arrow semantics import no-reaction, resonance, and angle-head retrosynthetic arrows',
  { skip: typeof DOMParser === 'undefined' },
  () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CDXML>
  <page id="page-1">
    <arrow id="a-no" Head3D="20 10 0" Tail3D="0 10 0" ArrowheadHead="Full" ArrowheadType="Solid" FillType="None" NoGo="Cross" HeadSize="800" ArrowheadCenterSize="700" ArrowheadWidth="200"/>
    <arrow id="a-res" Head3D="50 20 0" Tail3D="30 20 0" ArrowheadHead="Full" ArrowheadTail="Full" ArrowheadType="Solid" FillType="None" HeadSize="800" ArrowheadCenterSize="700" ArrowheadWidth="200"/>
    <arrow id="a-retro" Head3D="80 30 0" Tail3D="60 30 0" ArrowheadHead="Full" ArrowheadTail="Full" ArrowheadType="Angle" FillType="None" ArrowShaftSpacing="600" HeadSize="600" ArrowheadCenterSize="600" ArrowheadWidth="150"/>
  </page>
</CDXML>`;

    const arrows = cdxmlToChemDrawDocument(xml).document.pages[0].objects.filter(
      (object) => object.type === 'arrow',
    );

    assert.equal(arrows[0]?.arrowType, 'no-reaction');
    assert.equal(arrows[1]?.arrowType, 'resonance');
    assert.equal(arrows[2]?.arrowType, 'retrosynthetic');
    assert.equal(arrows[2]?.headType, 'angle');
    assert.equal(arrows[2]?.headSize, 6);
    assert.equal(arrows[2]?.headCenterSize, 6);
    assert.equal(arrows[2]?.headWidth, 1.5);
    assert.equal(arrows[2]?.shaftSpacing, 6);
  },
);

test('ChemDraw export preserves no-reaction, resonance, and retrosynthetic arrow semantics', () => {
  const document = {
    schemaVersion: 1,
    source: 'manual',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'a-no',
            type: 'arrow',
            arrowType: 'no-reaction',
            tail: { x: 0, y: 10 },
            head: { x: 20, y: 10 },
          },
          {
            id: 'a-res',
            type: 'arrow',
            arrowType: 'resonance',
            tail: { x: 30, y: 20 },
            head: { x: 50, y: 20 },
          },
          {
            id: 'a-retro',
            type: 'arrow',
            arrowType: 'retrosynthetic',
            tail: { x: 60, y: 30 },
            head: { x: 80, y: 30 },
          },
        ],
      },
    ],
  };

  const xml = chemDrawDocumentToCDXML(document);
  assert.match(xml, /<arrow id="a-no"[^>]*NoGo="Cross"/);
  assert.match(xml, /<arrow id="a-no"[^>]*ArrowheadType="Solid"/);
  assert.match(xml, /<arrow id="a-no"[^>]*FillType="None"/);
  assert.match(xml, /<arrow id="a-res"[^>]*ArrowheadTail="Full"/);
  assert.match(xml, /<arrow id="a-res"[^>]*ArrowheadType="Solid"/);
  assert.match(xml, /<arrow id="a-res"[^>]*FillType="None"/);
  assert.match(xml, /<arrow id="a-retro"[^>]*ArrowheadType="Angle"/);
  assert.match(xml, /<arrow id="a-retro"[^>]*ArrowShaftSpacing="/);
  assert.match(xml, /<arrow id="a-retro"[^>]*FillType="None"/);
});

test('ellipse-defined curved arrows preserve arc geometry and project to a curved control point', () => {
  const document = {
    schemaVersion: 1,
    source: 'manual',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'a-arc',
            type: 'arrow',
            arrowType: 'curved',
            tail: { x: 117.68, y: 28.09 },
            head: { x: 146.93, y: 44.98 },
            arcCenter: { x: 123.87, y: 51.16 },
            majorAxisEnd: { x: 147.75, y: 51.16 },
            minorAxisEnd: { x: 123.87, y: 75.04 },
            angularSize: -90,
            style: {
              lineType: 'dashed',
            },
          },
        ],
      },
    ],
  };

  const { state } = chemDrawDocumentToCanvasState(document);
  const arrow = state.arrows[0];
  assert.notEqual(arrow.cpx, (arrow.x1 + arrow.x2) / 2);
  assert.notEqual(arrow.cpy, (arrow.y1 + arrow.y2) / 2);

  const xml = chemDrawDocumentToCDXML(document);
  assert.match(xml, /Center3D="/);
  assert.match(xml, /MajorAxisEnd3D="/);
  assert.match(xml, /MinorAxisEnd3D="/);
  assert.match(xml, /AngularSize="-90"/);
});

test('symbol, bracket, and orbital graphics emit ChemDraw-specific attributes', () => {
  const document = {
    schemaVersion: 1,
    source: 'manual',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'g-bracket',
            type: 'graphic',
            graphicType: 'bracket',
            points: [
              { x: 20, y: 10 },
              { x: 20, y: 34 },
            ],
            bracketType: 'Round',
            bracketUsage: 'MultipleGroup',
            label: '2',
            lipSize: 10,
          },
          {
            id: 'g-symbol',
            type: 'graphic',
            graphicType: 'symbol',
            bounds: { left: 40, top: 10, right: 50, bottom: 20 },
            symbolType: 'CirclePlus',
            representedAttribute: 'Charge',
            representedObjectId: 'n1',
          },
          {
            id: 'g-orbital',
            type: 'graphic',
            graphicType: 'orbital',
            points: [
              { x: 70, y: 10 },
              { x: 70, y: 32 },
            ],
            orbitalType: 'p',
          },
        ],
      },
    ],
  };

  const xml = chemDrawDocumentToCDXML(document);
  assert.match(xml, /GraphicType="Bracket"/);
  assert.match(xml, /BracketUsage="MultipleGroup"/);
  assert.match(xml, /parameterizedBracketLabel/);
  assert.match(xml, /GraphicType="Symbol"/);
  assert.match(xml, /SymbolType="CirclePlus"/);
  assert.match(xml, /<represent attribute="Charge" object="n1"\/>/);
  assert.match(xml, /GraphicType="Orbital"/);
  assert.match(xml, /OrbitalType="p"/);
});

test('rounded rectangle graphics keep ChemDraw rectangle metadata on export', () => {
  const document = {
    schemaVersion: 1,
    source: 'cdxml-import',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'g-round',
            type: 'graphic',
            graphicType: 'rounded-rectangle',
            bounds: { left: 10, top: 20, right: 90, bottom: 50 },
            preservation: {
              capability: 'round-trip-only',
              rawAttributes: {
                RectangleType: 'RoundEdge Shadow',
                CornerRadius: '600',
                ShadowSize: '400',
              },
            },
          },
        ],
      },
    ],
  };

  const xml = chemDrawDocumentToCDXML(document);
  assert.match(xml, /GraphicType="Rectangle"/);
  assert.match(xml, /RectangleType="RoundEdge Shadow"/);
  assert.match(xml, /CornerRadius="600"/);
  assert.match(xml, /ShadowSize="400"/);
});

test(
  'node object tags import as typed annotations instead of raw preserved children',
  { skip: typeof DOMParser === 'undefined' },
  () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CDXML>
  <page id="page-1">
    <fragment id="f1">
      <n id="n1" p="40 40" Element="6">
        <objecttag id="ot1" TagType="Unknown" Name="stereo" PositioningType="offset" PositioningOffset="-10 6">
          <t p="46 47" BoundingBox="47 42 56 49"><s font="1" size="7.5" color="3" face="2">(R)</s></t>
        </objecttag>
      </n>
    </fragment>
  </page>
</CDXML>`;

    const document = cdxmlToChemDrawDocument(xml).document;
    const node = document.pages[0].objects.find((object) => object.type === 'node');
    assert.equal(node?.objectTags?.length, 1);
    assert.equal(node?.objectTags?.[0]?.name, 'stereo');
    assert.equal(node?.objectTags?.[0]?.text?.runs.map((run) => run.text).join(''), '(R)');
    assert.equal(
      node?.preservation?.rawChildrenXml?.some((childXml) => childXml.includes('objecttag')) ??
        false,
      false,
    );
  },
);

test(
  'table cell text stays inside the table instead of becoming a top-level text object',
  { skip: typeof DOMParser === 'undefined' },
  () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CDXML>
  <page id="page-1">
    <table id="tbl1" BoundingBox="0 0 100 40">
      <page id="cell-1" BoundsInParent="0 0 50 20">
        <t p="25 10" BoundingBox="10 5 40 15"><s font="1" size="10">Head</s></t>
      </page>
      <page id="cell-2" BoundsInParent="50 0 100 20">
        <t p="75 10" BoundingBox="60 5 90 15"><s font="1" size="10">Tail</s></t>
      </page>
    </table>
  </page>
</CDXML>`;

    const document = cdxmlToChemDrawDocument(xml).document;
    const table = document.pages[0].objects.find((object) => object.type === 'table');
    const textObjects = document.pages[0].objects.filter((object) => object.type === 'text');

    assert.equal(table?.cells.length, 2);
    assert.equal(table?.cells[0]?.text?.runs[0]?.text, 'Head');
    assert.equal(table?.cells[1]?.text?.runs[0]?.text, 'Tail');
    assert.equal(textObjects.length, 0);

    const roundTripXml = chemDrawDocumentToCDXML(document);
    assert.match(roundTripXml, /<table id="tbl1"/);
    assert.match(roundTripXml, /BoundsInParent="0 0 50 20"/);
    assert.match(roundTripXml, />Head<\/s>/);
    assert.match(roundTripXml, />Tail<\/s>/);
  },
);

test('bend-enabled straight arrows keep their custom type and width metadata', () => {
  const state = {
    atoms: [],
    bonds: [],
    arrows: [
      {
        id: 'arrow-1',
        type: 'no-reaction',
        x1: 10,
        y1: 10,
        x2: 48,
        y2: 10,
        cpx: 29,
        cpy: -4,
        curveEnabled: true,
        lineWidth: 4,
        lineStyle: 'bold',
      },
    ],
    textBoxes: [],
    groups: [],
  };

  const { document } = canvasStateToChemDrawDocument(state);
  assert.equal(document.pages[0].objects[0].curveEnabled, true);

  const modelRoundTrip = chemDrawDocumentToCanvasState(document).state;
  assert.equal(modelRoundTrip.arrows[0].type, 'no-reaction');
  assert.equal(modelRoundTrip.arrows[0].curveEnabled, true);
  assert.equal(modelRoundTrip.arrows[0].lineWidth, 4);
  assert.equal(modelRoundTrip.arrows[0].lineStyle, 'bold');

  const xml = chemDrawDocumentToCDXML(document);
  assert.match(xml, /ChemEditorArrowType="no-reaction"/);
  assert.match(xml, /ChemEditorArrowCurveEnabled="true"/);
  assert.match(xml, /CurvePoints="/);
  assert.match(xml, /LineWidth="/);
});
