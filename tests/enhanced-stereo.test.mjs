import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';
import { setEnhancedStereo } from '../.unit-test-dist/src/lib/enhancedStereo.js';
import { DEFAULT_DOCUMENT_STYLE_SETTINGS } from '../.unit-test-dist/src/lib/settings.js';
import { generateDocumentSVG } from '../.unit-test-dist/src/lib/svgExport.js';

// As ChemDraw writes it (RDKit External/ChemDraw/test.cpp).
const source = `<?xml version="1.0"?><CDXML BondLength="30"><page id="1"><fragment id="3">
  <n id="2" p="116 406"/>
  <n id="4" p="141.98 391" Geometry="Tetrahedral" AS="N" EnhancedStereoType="And" EnhancedStereoGroupNum="1"><objecttag TagType="Unknown" Name="enhancedstereo"><t p="137.96 401.37" BoundingBox="138.29 396 145.62 401.50" CaptionLineHeight="variable"><s font="21" size="7.5" color="0">&amp;1</s></t></objecttag></n>
  <n id="6" p="167.96 406"/>
  <b id="5" B="2" E="4"/><b id="7" B="4" E="6"/>
</fragment></page></CDXML>`;
const node = (doc, id) => doc.pages[0].objects.find((o) => o.id === id);

test("ChemDraw's enhanced stereo is read, drawn and written back unchanged", () => {
  const { document } = cdxmlToChemDrawDocument(source);
  assert.deepEqual(node(document, '4').enhancedStereo, { type: 'And', group: 1 });
  const once = chemDrawDocumentToCDXML(document);
  assert.match(once, /EnhancedStereoType="And" EnhancedStereoGroupNum="1"/);
  assert.equal(chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(once).document), once);
  assert.ok(generateDocumentSVG(document).includes('&amp;1'));
});

test('a new group is numbered past the others of its kind and labelled like ChemDraw', () => {
  const { document } = cdxmlToChemDrawDocument(source);
  const and = setEnhancedStereo(document, new Set(['6']), 'And', DEFAULT_DOCUMENT_STYLE_SETTINGS);
  assert.deepEqual(node(and, '6').enhancedStereo, { type: 'And', group: 2 });
  assert.equal(node(and, '6').objectTags[0].text.runs[0].text, '&2');
  const or = setEnhancedStereo(and, new Set(['6']), 'Or', DEFAULT_DOCUMENT_STYLE_SETTINGS);
  assert.equal(node(or, '6').objectTags.length, 1);
  assert.equal(node(or, '6').objectTags[0].text.runs[0].text, 'or1');
  const none = setEnhancedStereo(or, new Set(['6']), null, DEFAULT_DOCUMENT_STYLE_SETTINGS);
  assert.equal(node(none, '6').enhancedStereo, undefined);
  assert.equal(node(none, '6').objectTags, undefined);
});
