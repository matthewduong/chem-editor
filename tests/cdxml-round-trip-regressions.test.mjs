import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';

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
