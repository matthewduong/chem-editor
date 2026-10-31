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

test('a background colour is written through the colour table and read back', async () => {
  const { setDocumentBackground } =
    await import('../.unit-test-dist/src/lib/documentProperties.js');
  const { document } = cdxmlToChemDrawDocument(
    source.replace('<CDXML ', '<CDXML color="0" bgcolor="1" '),
  );
  // ChemDraw's reserved white stays exactly as read.
  assert.match(chemDrawDocumentToCDXML(document), /bgcolor="1"/);
  const tinted = setDocumentBackground(document, '#FFF2CC');
  const xml = chemDrawDocumentToCDXML(tinted);
  const index = Number(/ bgcolor="(\d+)"/.exec(xml)[1]);
  assert.ok(index >= 2);
  assert.equal((xml.match(/bgcolor=/g) ?? []).length, 1);
  const back = cdxmlToChemDrawDocument(xml).document;
  assert.equal(back.metadata.backgroundColor, '#fff2cc');
  assert.equal(chemDrawDocumentToCDXML(back), xml);
  assert.equal(setDocumentBackground(tinted, null).metadata.backgroundColor, undefined);
});
