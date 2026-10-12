import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';
import { createGroupFromSelection } from '../.unit-test-dist/src/lib/chemdrawModel.js';

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
