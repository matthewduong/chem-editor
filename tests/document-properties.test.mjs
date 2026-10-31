import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';
import {
  readDocumentProperties,
  setDocumentProperties,
} from '../.unit-test-dist/src/lib/documentProperties.js';

const source = `<?xml version="1.0"?><CDXML CreationProgram="ChemDraw 23.1.2.7" Name="old.cdxml"><page id="1"><fragment id="2"><n id="3" p="0 0"/></fragment></page></CDXML>`;

test("document properties are the file's root attributes, edited and written back", () => {
  const { document } = cdxmlToChemDrawDocument(source);
  assert.deepEqual(readDocumentProperties(document), {
    Name: 'old.cdxml',
    CreationProgram: 'ChemDraw 23.1.2.7',
  });
  const edited = setDocumentProperties(document, {
    Name: '',
    Comment: 'Route B',
    CreationProgram: 'x',
  });
  const xml = chemDrawDocumentToCDXML(edited);
  assert.match(xml, /Comment="Route B"/);
  assert.match(xml, /CreationProgram="ChemDraw 23.1.2.7"/);
  assert.ok(!/ Name="old.cdxml"/.test(xml));
  assert.equal(setDocumentProperties(edited, { Comment: 'Route B' }), edited);
});
