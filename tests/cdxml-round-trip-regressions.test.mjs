import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';
import {
  chemDrawDocumentToCanvasState,
  createGroupFromSelection,
  mergeCanvasStateIntoChemDrawDocument,
  rotateSelectedObjects,
} from '../.unit-test-dist/src/lib/chemdrawModel.js';

const exportXml = (xml) => chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(xml).document);
// Font and colour tables have their own ID spaces, separate from drawing objects.
const idsOf = (xml) =>
  Array.from(
    xml.replace(/<fonttable>[\s\S]*?<\/fonttable>/, '').matchAll(/\sid="([^"]+)"/g),
    (m) => m[1],
  );

const TWO_PAGES = `<?xml version="1.0"?><CDXML BondLength="14.4">
<page id="40"><fragment id="2"><n id="3" p="0 0"/><n id="4" p="14.4 0"/><b id="5" B="3" E="4"/></fragment></page>
<page id="50"><fragment id="51"><n id="52" p="0 100"/><n id="53" p="14.4 100"/><b id="54" B="52" E="53"/></fragment></page>
</CDXML>`;

test('pages after the first are warned about and re-emitted instead of silently dropped', () => {
  const result = cdxmlToChemDrawDocument(TWO_PAGES);
  assert.ok(result.warnings.some((w) => /2 pages; only the first page is editable/.test(w)));
  const out = chemDrawDocumentToCDXML(result.document);
  assert.equal((out.match(/<page /g) ?? []).length, 2);
  assert.match(out, /<page id="50">/);
  assert.match(out, /<n id="52" p="0 100"\/>/);
});

test('exported IDs are unique even when fragments keep numeric IDs that nodes would reuse', () => {
  // Fragment ID 2 and a page ID of 40 sit inside the range freshly numbered nodes would occupy.
  const out = exportXml(TWO_PAGES);
  const ids = idsOf(out);
  assert.equal(new Set(ids).size, ids.length, `duplicate IDs in ${ids.join(',')}`);
  // And the file must survive its own validator.
  assert.doesNotThrow(() => cdxmlToChemDrawDocument(out));
});

test('lines and ovals export as <graphic GraphicType>, which is the only form CDXML defines', () => {
  const out = exportXml(`<?xml version="1.0"?><CDXML><page id="1">
    <graphic id="7" GraphicType="Oval" BoundingBox="0 0 40 30"/>
    <graphic id="8" GraphicType="Line" BoundingBox="50 0 90 30"/>
  </page></CDXML>`);
  assert.match(out, /<graphic id="7"[^>]*GraphicType="Oval"/);
  assert.match(out, /<graphic id="8"[^>]*GraphicType="Line"/);
  assert.doesNotMatch(out, /<oval[\s>]|<line[\s>]/);
});

test('closed polygons export as a closed <curve>, which is the only form CDXML defines', () => {
  const out = exportXml(`<?xml version="1.0"?><CDXML><page id="1">
    <graphic id="7" GraphicType="Polygon" Points="0 80 40 80 20 110"/>
  </page></CDXML>`);
  assert.doesNotMatch(out, /<polygon[\s>]/);
  const match = /<curve id="7"[^>]*Closed="yes"[^>]*CurvePoints="([^"]+)"/.exec(out);
  assert.ok(match, `expected a closed <curve id="7"> with CurvePoints in ${out}`);
  // Each vertex repeated three times (coincident Bezier control points) is what makes ChemDraw
  // draw a sharp corner instead of a smoothed curve through the points -- confirmed against real
  // ChemDraw, see development/gaps.md.
  const values = match[1].trim().split(/\s+/).map(Number);
  assert.deepEqual(
    values,
    [0, 80, 0, 80, 0, 80, 40, 80, 40, 80, 40, 80, 20, 110, 20, 110, 20, 110],
    'expected each vertex tripled',
  );
});

test('a closed <curve> re-imports with its vertices deduplicated back to one per corner', () => {
  const { document } = cdxmlToChemDrawDocument(`<?xml version="1.0"?><CDXML><page id="1">
    <curve id="7" Closed="yes" CurvePoints="0 80 0 80 0 80 40 80 40 80 40 80 20 110 20 110 20 110"/>
  </page></CDXML>`);
  const graphic = document.pages[0].objects.find((o) => o.id === '7');
  assert.equal(graphic?.graphicType, 'polygon');
  assert.equal(graphic?.points?.length, 3);
});

test('<group> is modeled rather than flattened, and round-trips as a fixed point', () => {
  const xml = `<?xml version="1.0"?><CDXML BondLength="14.4"><page id="1">
    <fragment id="10"><n id="11" p="100 0"/></fragment>
    <group id="100">
      <fragment id="2"><n id="3" p="0 0"/><n id="4" p="14.4 0"/><b id="5" B="3" E="4"/></fragment>
      <t id="6" p="20 20"><s>hello</s></t>
    </group>
  </page></CDXML>`;
  const { document, warnings } = cdxmlToChemDrawDocument(xml);
  assert.deepEqual(warnings, []);
  const group = document.pages[0].objects.find((o) => o.type === 'group');
  assert.ok(group, 'expected a modeled group object');
  assert.deepEqual(group.childIds, ['2', '6']);

  const out = chemDrawDocumentToCDXML(document);
  const groupMatch = /<group id="100">([\s\S]*?)<\/group>/.exec(out);
  assert.ok(groupMatch, `expected a non-empty <group id="100"> in ${out}`);
  assert.match(groupMatch[1], /<fragment id="2">/);
  assert.match(groupMatch[1], /<t [^>]*>/);

  const second = cdxmlToChemDrawDocument(out);
  const out2 = chemDrawDocumentToCDXML(second.document);
  assert.equal(out, out2, 'expected export to be a fixed point after one round trip');
});

test('a nested <group> inside another <group> is modeled at both levels', () => {
  const xml = `<?xml version="1.0"?><CDXML BondLength="14.4"><page id="1">
    <group id="200">
      <group id="100">
        <fragment id="2"><n id="3" p="0 0"/></fragment>
      </group>
      <t id="6" p="20 20"><s>outer</s></t>
    </group>
  </page></CDXML>`;
  const { document } = cdxmlToChemDrawDocument(xml);
  const outer = document.pages[0].objects.find((o) => o.id === '200');
  const inner = document.pages[0].objects.find((o) => o.id === '100');
  assert.equal(outer?.type, 'group');
  assert.equal(inner?.type, 'group');
  assert.deepEqual(outer.childIds, ['100', '6']);
  assert.deepEqual(inner.childIds, ['2']);

  const out = chemDrawDocumentToCDXML(document);
  const outerMatch = /<group id="200">([\s\S]*)<\/group>\s*$/.exec(out.split('</page>')[0]);
  assert.ok(outerMatch, `expected outer <group id="200"> wrapping the inner group in ${out}`);
  assert.match(outerMatch[1], /<group id="100">[\s\S]*<fragment id="2">/);
});

test('a group with no modeled descendants still models the group and preserves its content', () => {
  const xml = `<?xml version="1.0"?><CDXML BondLength="14.4"><page id="1">
    <group id="100" Z="5" Visible="no">
      <chemicalproperty id="9" Name="FOO" Value="BAR"/>
    </group>
  </page></CDXML>`;
  const { document, warnings } = cdxmlToChemDrawDocument(xml);
  assert.deepEqual(warnings, []);
  const group = document.pages[0].objects.find((o) => o.type === 'group');
  assert.equal(group?.childIds.length, 0);
  assert.equal(group?.style?.zIndex, 5);
  assert.equal(group?.style?.visible, false);
  assert.ok(
    group?.preservation?.rawChildrenXml?.some((xml) => /<chemicalproperty/.test(xml)),
    'unmodeled group content must be preserved, not silently dropped',
  );

  const out = chemDrawDocumentToCDXML(document);
  assert.match(out, /<group id="100"[^>]*>[\s\S]*<chemicalproperty id="9"[\s\S]*<\/group>/);
});

test('grouping a selection of raw node/bond ids resolves them to their owning fragment', () => {
  // The live UI's selectedObjectIds can carry node/bond ids directly (e.g. a box-select inside
  // one molecule), but <group> can only nest page-level containers, not loose atoms/bonds.
  const xml = `<?xml version="1.0"?><CDXML BondLength="14.4"><page id="1">
    <fragment id="2"><n id="3" p="0 0"/><n id="4" p="14.4 0"/><b id="5" B="3" E="4"/></fragment>
    <fragment id="10"><n id="11" p="100 0"/><n id="12" p="114.4 0"/><b id="13" B="11" E="12"/></fragment>
  </page></CDXML>`;
  const { document } = cdxmlToChemDrawDocument(xml);

  // Two bonds that both belong to the SAME fragment collapse to one id, which is below the
  // size-2 threshold for forming a group: no group should be created.
  const sameFragment = createGroupFromSelection(document, new Set(['3', '4']));
  assert.ok(
    !sameFragment.pages[0].objects.some((o) => o.type === 'group'),
    'a selection confined to one fragment must not create a group',
  );

  // Atoms from two DIFFERENT fragments should group the fragments themselves, not the atoms.
  const twoFragments = createGroupFromSelection(document, new Set(['3', '11']));
  const group = twoFragments.pages[0].objects.find((o) => o.type === 'group');
  assert.ok(group, 'expected a group spanning both fragments');
  assert.deepEqual(new Set(group.childIds), new Set(['2', '10']));

  const out = chemDrawDocumentToCDXML(twoFragments);
  const groupMatch = /<group id="[^"]*">([\s\S]*?)<\/group>/.exec(out);
  assert.ok(groupMatch, `expected a non-empty <group> in ${out}`);
  assert.match(groupMatch[1], /<fragment id="2">/);
  assert.match(groupMatch[1], /<fragment id="10">/);
});

test('a superseded arrow is skipped on import, like a superseded graphic already is', () => {
  // Real ChemDraw marks a stale arrow SupersededBy="<new id>" rather than deleting it -- observed
  // on every resave of a line-as-arrow conversion (development/gaps.md). Importing both would
  // leave a dead duplicate object in the document.
  const { document } = cdxmlToChemDrawDocument(`<?xml version="1.0"?><CDXML><page id="1">
    <arrow id="5" SupersededBy="8" Head3D="0 0 0" Tail3D="10 10 0"/>
    <arrow id="8" Head3D="0 0 0" Tail3D="10 10 0"/>
  </page></CDXML>`);
  const arrows = document.pages[0].objects.filter((o) => o.type === 'arrow');
  assert.equal(arrows.length, 1);
  assert.equal(arrows[0].id, '8');
});

test('an infinite-canvas page does not become a finite letter page after one save and reopen', () => {
  const first = exportXml(`<?xml version="1.0"?><CDXML><page id="1">
    <fragment id="2"><n id="3" p="0 0"/></fragment></page></CDXML>`);
  assert.match(first, /ChemEditorPageMode="infinite"/);
  const reopened = cdxmlToChemDrawDocument(first).document;
  assert.equal(reopened.metadata.pageSetup.mode, 'infinite');
});

test('formula-face labels are written with plain digits, not pre-subscripted Unicode', () => {
  const out = exportXml(`<?xml version="1.0"?><CDXML BondLength="14.4"><page id="1">
    <fragment id="2"><n id="3" p="0 0" Element="6"/><n id="4" p="14.4 0" Element="7"/>
    <b id="5" B="3" E="4"/></fragment></page></CDXML>`);
  assert.doesNotMatch(out, /[₀-₉]/);
});

test('arrowheads are written back as the file gave them, so a plain line gains no head', () => {
  // ChemDraw draws a line as an <arrow> with neither ArrowheadHead nor ArrowheadTail (59 of 160
  // arrows in its own templates); exporting each through its type used to add a full head.
  const out = exportXml(`<?xml version="1.0"?><CDXML><page id="100">
    <arrow id="11" ArrowheadType="Solid" Head3D="80 20 0" Tail3D="10 20 0"/>
    <arrow id="12" ArrowheadType="Solid" AngularSize="-90" Head3D="110 70 0" Tail3D="150 30 0" Center3D="110 30 0" MajorAxisEnd3D="150 30 0" MinorAxisEnd3D="110 70 0"/>
    <arrow id="13" ArrowheadTail="Full" ArrowheadType="Solid" Head3D="80 100 0" Tail3D="10 100 0"/>
    <arrow id="14" ArrowheadHead="HalfLeft" ArrowheadTail="HalfLeft" ArrowheadType="Solid" Head3D="80 140 0" Tail3D="10 140 0"/>
  </page></CDXML>`);
  const arrow = (id) => new RegExp(`<arrow id="${id}"[^>]*>`).exec(out)?.[0] ?? '';
  assert.doesNotMatch(arrow(11), /ArrowheadHead|ArrowheadTail/);
  assert.doesNotMatch(arrow(12), /ArrowheadHead|ArrowheadTail/);
  assert.match(arrow(12), /AngularSize="-90"/);
  assert.match(arrow(13), /ArrowheadTail="Full"/);
  assert.doesNotMatch(arrow(13), /ArrowheadHead/);
  assert.match(arrow(14), /ArrowheadHead="HalfLeft" ArrowheadTail="HalfLeft"/);
  assert.equal(exportXml(out), out);
});

test('a plain line is not taken as the reaction arrow when inferring roles', () => {
  const result = cdxmlToChemDrawDocument(`<?xml version="1.0"?><CDXML><page id="100">
    <fragment id="2"><n id="3" p="0 0"/></fragment>
    <arrow id="11" ArrowheadType="Solid" Head3D="80 20 0" Tail3D="10 20 0"/>
  </page></CDXML>`);
  assert.ok(!result.warnings.some((w) => /inferred heuristically/.test(w)));
});

test('reversing a one-ended arrow carries its head; retyping it drops the recorded heads', () => {
  const { document } = cdxmlToChemDrawDocument(`<?xml version="1.0"?><CDXML><page id="100">
    <arrow id="13" ArrowheadTail="Full" ArrowheadType="Solid" Head3D="80 100 0" Tail3D="10 100 0"/>
  </page></CDXML>`);
  const { state } = chemDrawDocumentToCanvasState(document);
  const [flat] = state.arrows;
  const reversed = { ...flat, x1: flat.x2, y1: flat.y2, x2: flat.x1, y2: flat.y1 };
  const swapped = mergeCanvasStateIntoChemDrawDocument(document, {
    ...state,
    arrows: [reversed],
  }).document.pages[0].objects.find((o) => o.type === 'arrow');
  assert.equal(swapped.headEnd, 'full');
  assert.equal(swapped.tailEnd, 'none');

  const retyped = mergeCanvasStateIntoChemDrawDocument(document, {
    ...state,
    arrows: [{ ...flat, type: 'equilibrium' }],
  }).document.pages[0].objects.find((o) => o.type === 'arrow');
  assert.equal(retyped.headEnd, undefined);
  assert.equal(retyped.tailEnd, undefined);
});

test('an open <curve> keeps its element, control points and arrowheads', () => {
  // Read as an unknown graphic, an open curve used to come back as <graphic Points> with its
  // CurvePoints, CurveType and heads gone.
  const source = `<?xml version="1.0"?><CDXML><page id="100">
    <curve id="12" LineType="Dashed" CurveType="26" ArrowheadHead="Full" ArrowheadTail="Full" ArrowheadType="Solid" CurvePoints="109.29 114.88 109.29 106.46 109.29 98.04 121.92 86.81 129.87 89.62 134.08 90.55 139.7 92.89 144.38 93.83 149.05 94.76"/>
    <curve id="11" CurveType="1" CurvePoints="29.22 41.6 39.55 39.41 49.92 37.18 57.79 32.63 57.11 29.27 56.33 25.81 47.28 24.81 36.95 27.04 26.58 29.22 18.76 33.77 19.49 37.23 20.21 40.64"/>
  </page></CDXML>`;
  const { document } = cdxmlToChemDrawDocument(source);
  const [open, closed] = ['12', '11'].map((id) =>
    document.pages[0].objects.find((o) => o.id === id),
  );
  assert.equal(open.graphicType, 'curve');
  assert.equal(open.points.length, 9);
  assert.equal(open.headEnd, 'full');
  assert.equal(open.tailEnd, 'full');
  // A smooth closed curve is not one of our tripled-vertex polygons and keeps its control points.
  assert.equal(closed.graphicType, 'curve');
  assert.equal(closed.points.length, 12);
  const out = exportXml(source);
  const curve12 = /<curve id="12"[^>]*>/.exec(out)?.[0] ?? '';
  assert.match(curve12, /CurveType="26"/);
  assert.match(curve12, /ArrowheadHead="Full" ArrowheadTail="Full" ArrowheadType="Solid"/);
  assert.match(curve12, /CurvePoints="109.29 114.88 109.29 106.46/);
  assert.doesNotMatch(out, /<graphic id="12"/);
  assert.match(/<curve id="11"[^>]*>/.exec(out)?.[0] ?? '', /CurveType="1"/);
  assert.equal(exportXml(out), out);
});

test('a graphic of an unknown type is written back attribute for attribute', () => {
  const out = exportXml(`<?xml version="1.0"?><CDXML><page id="100">
    <graphic id="7" GraphicType="Fancy" BoundingBox="0 0 40 30" Mystery="1"/>
  </page></CDXML>`);
  const graphic = /<graphic id="7"[^>]*>/.exec(out)?.[0] ?? '';
  assert.match(graphic, /GraphicType="Fancy"/);
  assert.match(graphic, /Mystery="1"/);
  assert.equal((graphic.match(/BoundingBox=/g) ?? []).length, 1);
});

test('rectangles and ovals keep their style words and axis ends; symbols keep their two points', () => {
  const source = `<?xml version="1.0"?><CDXML><page id="100">
    <graphic id="11" BoundingBox="80 50 10 10" GraphicType="Rectangle" RectangleType="Filled Dashed" Center3D="45 30 0" MajorAxisEnd3D="80 30 0" MinorAxisEnd3D="45 50 0"/>
    <graphic id="15" BoundingBox="100 70 170 120" GraphicType="Oval" OvalType="Dashed" Center3D="135 95 0" MajorAxisEnd3D="163.28 66.72 0" MinorAxisEnd3D="149.14 109.14 0"/>
    <graphic id="21" BoundingBox="20 150 12.5 150" GraphicType="Symbol" SymbolType="Plus"/>
  </page></CDXML>`;
  const out = exportXml(source);
  const tag = (id) => new RegExp(`<graphic id="${id}"[^>]*>`).exec(out)?.[0] ?? '';
  assert.match(tag(11), /RectangleType="Filled Dashed"/);
  assert.match(tag(11), /Center3D="45 30 0" MajorAxisEnd3D="80 30 0" MinorAxisEnd3D="45 50 0"/);
  assert.match(tag(15), /OvalType="Dashed"/);
  assert.match(tag(15), /MajorAxisEnd3D="163.28 66.72 0"/);
  // The symbol's first point is where it sits; the order must survive.
  assert.match(tag(21), /BoundingBox="20 150 12.5 150"/);
  assert.equal(exportXml(out), out);
});

test('rotating an oval or rectangle turns its axes, not just its bounding box', () => {
  const { document } = cdxmlToChemDrawDocument(`<?xml version="1.0"?><CDXML><page id="100">
    <graphic id="15" BoundingBox="0 0 40 20" GraphicType="Oval" Center3D="20 10 0" MajorAxisEnd3D="40 10 0" MinorAxisEnd3D="20 20 0"/>
  </page></CDXML>`);
  const scale = document.pages[0].objects[0].majorAxisEnd.x - document.pages[0].objects[0].center.x;
  const center = document.pages[0].objects[0].center;
  const rotated = rotateSelectedObjects(document, new Set(['15']), center, Math.PI / 2).pages[0]
    .objects[0];
  assert.ok(Math.abs(rotated.majorAxisEnd.x - center.x) < 1e-9);
  assert.ok(Math.abs(rotated.majorAxisEnd.y - (center.y + scale)) < 1e-9);
  assert.deepEqual(rotated.center, center);
});

test('a transformed arc arrow carries its centre and axes, so it stays the same arc', () => {
  const { document } = cdxmlToChemDrawDocument(`<?xml version="1.0"?><CDXML><page id="100">
    <arrow id="12" ArrowheadType="Solid" AngularSize="-90" Head3D="110 70 0" Tail3D="150 30 0" Center3D="110 30 0" MajorAxisEnd3D="150 30 0" MinorAxisEnd3D="110 70 0"/>
  </page></CDXML>`);
  const before = document.pages[0].objects[0];
  const turned = rotateSelectedObjects(document, new Set(['12']), before.arcCenter, Math.PI / 2)
    .pages[0].objects[0];
  assert.deepEqual(turned.arcCenter, before.arcCenter);
  const radius = Math.hypot(
    turned.majorAxisEnd.x - turned.arcCenter.x,
    turned.majorAxisEnd.y - turned.arcCenter.y,
  );
  assert.ok(
    Math.abs(
      Math.hypot(turned.tail.x - turned.arcCenter.x, turned.tail.y - turned.arcCenter.y) - radius,
    ) < 1e-9,
  );
  assert.ok(Math.abs(turned.majorAxisEnd.x - turned.arcCenter.x) < 1e-9);
});

test('a quadruple bond stays quadruple and formula text keeps face 96', () => {
  const source = `<?xml version="1.0"?><CDXML BondLength="14.4"><page id="100">
    <fragment id="1"><n id="2" p="0 0" Element="42"/><n id="3" p="14.4 0" Element="42"/><b id="4" B="2" E="3" Order="4"/></fragment>
    <t id="5" p="0 40"><s font="3" size="10" face="96">CH3OH</s></t>
  </page></CDXML>`;
  const { document } = cdxmlToChemDrawDocument(source);
  assert.equal(document.pages[0].objects.find((o) => o.id === '4').order, 4);
  const out = exportXml(source);
  assert.match(out, /<b [^>]*Order="4"/);
  assert.match(out, /face="96"[^>]*>CH3OH</);
});

test('a charge symbol follows its atom through export renumbering', async () => {
  const { toggleChargeSymbol } = await import('../.unit-test-dist/src/lib/chargeSymbols.js');
  const { canvasStateToChemDrawDocument } =
    await import('../.unit-test-dist/src/lib/chemdrawModel.js');
  const { document } = canvasStateToChemDrawDocument({
    atoms: [{ id: 'atom-uuid', x: 40, y: 40, kind: 'element', element: 'N' }],
    bonds: [],
    arrows: [],
    groups: [],
    textBoxes: [],
  });
  const withSymbol = toggleChargeSymbol(
    document,
    'atom-uuid',
    'CirclePlus',
    { x: 50, y: 30 },
    8,
    () => 'sym',
  );
  const out = chemDrawDocumentToCDXML(withSymbol);
  const nodeId = /<n id="(\d+)"/.exec(out)?.[1];
  assert.match(out, new RegExp(`<represent attribute="Charge" object="${nodeId}"/>`));
  assert.match(out, /<n [^>]*Charge="1"/);
  // Applying it again removes the symbol and the charge.
  const removed = toggleChargeSymbol(
    withSymbol,
    'atom-uuid',
    'CirclePlus',
    { x: 0, y: 0 },
    8,
    () => 'x',
  );
  assert.equal(
    removed.pages[0].objects.some((o) => o.type === 'graphic'),
    false,
  );
  assert.equal(removed.pages[0].objects[0].charge, undefined);
});

test('caption line spacing reads and writes LineHeight', () => {
  const source = `<?xml version="1.0"?><CDXML BondLength="14.4"><page id="100">
    <t id="5" p="0 40" LineHeight="18"><s font="3" size="10" face="0">two\nlines</s></t>
    <t id="6" p="0 90" LineHeight="variable"><s font="3" size="10" face="0">var</s></t>
    <t id="7" p="0 120" LineHeight="auto"><s font="3" size="10" face="0">auto</s></t>
  </page></CDXML>`;
  const { document } = cdxmlToChemDrawDocument(source);
  const text = (id) => document.pages[0].objects.find((o) => o.id === id);
  assert.equal(text('5').lineHeight, 18);
  assert.equal(text('6').lineHeight, 'variable');
  assert.equal(text('7').lineHeight, undefined);
  const out = exportXml(source);
  assert.match(/<t id="5"[^>]*>/.exec(out)?.[0] ?? '', /LineHeight="18"/);
  assert.match(/<t id="6"[^>]*>/.exec(out)?.[0] ?? '', /LineHeight="variable"/);
  assert.doesNotMatch(/<t id="7"[^>]*>/.exec(out)?.[0] ?? '', /LineHeight/);
});

test('an atom carries its object tags through rotation', () => {
  const { document } =
    cdxmlToChemDrawDocument(`<?xml version="1.0"?><CDXML BondLength="14.4"><page id="100">
    <fragment id="1"><n id="2" p="20 20"><objecttag id="9" TagType="Unknown" Name="stereo"><t id="10" p="30 20"><s font="3" size="8" face="0">(R)</s></t></objecttag></n></fragment>
  </page></CDXML>`);
  const node = document.pages[0].objects.find((o) => o.id === '2');
  const anchor = node.objectTags[0].textAnchor;
  const turned = rotateSelectedObjects(
    document,
    new Set(['2']),
    node.position,
    Math.PI,
  ).pages[0].objects.find((o) => o.id === '2');
  const moved = turned.objectTags[0].textAnchor;
  assert.ok(Math.abs(moved.x - (2 * node.position.x - anchor.x)) < 1e-9);
});

test('a bond keeps its E/Z object tag through a round trip, and draws it', async () => {
  const { generateDocumentSVG } = await import('../.unit-test-dist/src/lib/svgExport.js');
  const source = `<?xml version="1.0"?><CDXML BondLength="14.4"><page id="100">
    <fragment id="1"><n id="2" p="20 20"/><n id="3" p="34 20"/>
    <b id="4" B="2" E="3" Order="2"><objecttag id="9" TagType="Unknown" Name="stereo"><t id="10" p="25 14"><s font="3" size="8" face="0">(E)</s></t></objecttag></b></fragment>
  </page></CDXML>`;
  const { document } = cdxmlToChemDrawDocument(source);
  const bond = document.pages[0].objects.find((o) => o.id === '4');
  assert.equal(bond.objectTags?.[0]?.name, 'stereo');
  const once = chemDrawDocumentToCDXML(document);
  assert.equal((once.match(/<objecttag/g) ?? []).length, 1);
  const twice = chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(once).document);
  assert.equal(twice, once);
  assert.ok(generateDocumentSVG(document).includes('(E)'));
});

test('a ChemDraw generic keeps its GenericNickname under a numbered label', () => {
  // As ChemDraw 23.1 wrote an "R1" label.
  const source = `<?xml version="1.0"?><CDXML><page id="1"><fragment id="2"><n id="3" p="50 23"/><n id="58" p="70 23" NodeType="GenericNickname" NumHydrogens="0" GenericNickname="R"><t p="66.39 26.58" LabelJustification="Left" LabelAlignment="Left"><s font="3" size="10" color="0" face="96">R1</s></t></n><b id="4" B="3" E="58"/></fragment></page></CDXML>`;
  const once = chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(source).document);
  assert.match(once, /GenericNickname="R"/);
  assert.ok(!/GenericNickname="R1"/.test(once));
  assert.equal(chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(once).document), once);
});

test('a label typed as a generic is written as ChemDraw writes one', async () => {
  const { canvasStateToChemDrawDocument } =
    await import('../.unit-test-dist/src/lib/chemdrawModel.js');
  const { setAliasAtomValue } = await import('../.unit-test-dist/src/lib/atomIdentity.js');
  const exported = (label) => {
    const atoms = [
      { id: 'a', x: 0, y: 0, kind: 'element', element: 'C' },
      setAliasAtomValue({ id: 'b', x: 30, y: 0, kind: 'element', element: 'C' }, label),
    ];
    const { document } = canvasStateToChemDrawDocument({
      atoms,
      bonds: [{ id: 'ab', from: 'a', to: 'b', order: 1 }],
      arrows: [],
      groups: [],
      textBoxes: [],
    });
    return chemDrawDocumentToCDXML(document);
  };
  assert.match(exported('R1'), /NodeType="GenericNickname" NumHydrogens="0" GenericNickname="R"/);
  assert.match(exported('X'), /GenericNickname="X"/);
  assert.ok(!/GenericNickname/.test(exported('OMe')));
  const again = chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(exported('R1')).document);
  assert.equal(again, exported('R1'));
});

test("an R-group definition's members are drawn but written once", async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(
    new URL('./fixtures/cdxml/rgroup-definition.cdxml', import.meta.url),
    'utf8',
  );
  const { document } = cdxmlToChemDrawDocument(source);
  const member = document.pages[0].objects.find((o) => o.id === '12');
  assert.equal(member.preservation.capability, 'render-only');
  assert.equal(member.preservation.ownedBy, '10');
  const once = chemDrawDocumentToCDXML(document);
  assert.equal((once.match(/<fragment/g) ?? []).length, 3);
  assert.equal((once.match(/<altgroup/g) ?? []).length, 1);
  assert.equal(chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(once).document), once);
});
