import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';
import { toggleAtomNumbers } from '../.unit-test-dist/src/lib/atomNumbers.js';
import { generateDocumentSVG } from '../.unit-test-dist/src/lib/svgExport.js';

const source = `<?xml version="1.0"?><CDXML BondLength="14.4"><page id="1">
  <fragment id="2"><n id="3" p="0 0"/><n id="4" p="14.4 0"/><n id="5" p="21.6 12.5" AtomNumber="7" ShowAtomNumber="no"/>
  <b id="6" B="3" E="4"/><b id="7" B="4" E="5"/></fragment></page></CDXML>`;

test('atom numbers read, toggle on with their place in the structure, and write back', () => {
  const { document } = cdxmlToChemDrawDocument(source);
  const shown = toggleAtomNumbers(document, new Set(['4', '5']));
  const node = (doc, id) => doc.pages[0].objects.find((o) => o.id === id);
  assert.equal(node(shown, '4').atomNumber, '2');
  assert.equal(node(shown, '5').atomNumber, '7');
  assert.equal(node(shown, '4').showAtomNumber, true);
  const xml = chemDrawDocumentToCDXML(shown);
  assert.match(xml, /AtomNumber="2" ShowAtomNumber="yes"/);
  assert.equal(chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(xml).document), xml);
  const svg = generateDocumentSVG(shown);
  assert.ok(svg.includes('>2<') && svg.includes('>7<'));
  const hidden = toggleAtomNumbers(shown, new Set(['4', '5']));
  assert.equal(node(hidden, '4').showAtomNumber, false);
  assert.ok(!generateDocumentSVG(hidden).includes('>7<'));
});
