import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';
import {
  extractDocumentSelection,
  pasteDocumentFragment,
} from '../.unit-test-dist/src/lib/documentClipboard.js';

const FIXTURE_DIR = new URL('./fixtures/cdxml/', import.meta.url).pathname;
const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.cdxml'))
  .map((name) => ({ name, xml: readFileSync(FIXTURE_DIR + name, 'utf8') }));

function allIds(document) {
  const ids = [];
  for (const object of document.pages[0].objects) {
    ids.push(object.id);
    for (const tag of object.objectTags ?? []) if (tag.id) ids.push(tag.id);
    if (object.type === 'table') for (const cell of object.cells) ids.push(cell.id);
  }
  return ids;
}

function assertNoDanglingReferences(document, label) {
  const ids = new Set(document.pages[0].objects.map((object) => object.id));
  for (const object of document.pages[0].objects) {
    const refs = [];
    if (object.type === 'bond') refs.push(object.beginNodeId, object.endNodeId);
    if (object.type === 'fragment') refs.push(...object.nodeIds, ...object.bondIds);
    if (object.type === 'group') refs.push(...object.childIds);
    if (object.type === 'graphic' && object.representedObjectId)
      refs.push(object.representedObjectId);
    for (const ref of refs)
      assert.ok(ids.has(ref), `${label}: ${object.type} ${object.id} -> missing ${ref}`);
  }
}

const everything = (document) => new Set(document.pages[0].objects.map((object) => object.id));

let copied = 0;
for (const { name, xml } of fixtures) {
  test(`${name}: copy then paste duplicates the selection with fresh ids and no dangling refs`, () => {
    const { document } = cdxmlToChemDrawDocument(xml);
    const before = document.pages[0].objects.length;
    const fragment = extractDocumentSelection(document, everything(document));
    if (fragment === null) return; // opaque preserved children: the flat buffer handles these
    copied++;
    assert.equal(fragment.pages[0].objects.length, before, 'everything selected is copied');
    assertNoDanglingReferences(fragment, 'fragment');

    const result = pasteDocumentFragment(document, fragment, 30, 20);
    assert.equal(result.document.pages[0].objects.length, before * 2);
    const ids = allIds(result.document);
    assert.equal(new Set(ids).size, ids.length, 'ids stay unique after paste');
    assertNoDanglingReferences(result.document, 'pasted');
    assert.ok(result.objectIds.length > 0);

    // The original objects are untouched, byte for byte.
    const originalXml = chemDrawDocumentToCDXML(document);
    assert.deepEqual(result.document.pages[0].objects.slice(0, before), document.pages[0].objects);
    assert.equal(chemDrawDocumentToCDXML(document), originalXml, 'source document not mutated');

    // And the result is still a valid document that survives a round trip.
    const again = cdxmlToChemDrawDocument(chemDrawDocumentToCDXML(result.document));
    assert.equal(again.document.pages[0].objects.length >= before, true);
  });
}

test('some public fixtures take the document-level path', () => {
  assert.ok(copied > 0, 'every fixture fell back to the flat buffer');
});

test('pasted nodes are translated and the source keeps its position', () => {
  const xml =
    '<?xml version="1.0"?><CDXML><page id="1"><fragment id="2">' +
    '<n id="3" p="10 10"/><n id="4" p="24.4 10"/><b id="5" B="3" E="4"/></fragment></page></CDXML>';
  const { document } = cdxmlToChemDrawDocument(xml);
  const fragment = extractDocumentSelection(document, new Set(['2']));
  assert.ok(fragment);
  const { document: next } = pasteDocumentFragment(document, fragment, 100, 50);
  const nodes = next.pages[0].objects.filter((object) => object.type === 'node');
  assert.equal(nodes.length, 4);
  const originals = document.pages[0].objects.filter((object) => object.type === 'node');
  const pastedNodes = nodes.slice(originals.length);
  assert.equal(pastedNodes.length, originals.length);
  // The importer rescales coordinates, so assert the translation, not absolute positions.
  originals.forEach((node, index) => {
    assert.ok(Math.abs(pastedNodes[index].position.x - node.position.x - 100) < 1e-9);
    assert.ok(Math.abs(pastedNodes[index].position.y - node.position.y - 50) < 1e-9);
  });
  assert.deepEqual(
    nodes.slice(0, originals.length).map((node) => node.position),
    originals.map((node) => node.position),
  );
});

test('selecting one bond copies its two nodes; an empty selection copies nothing', () => {
  const xml =
    '<?xml version="1.0"?><CDXML><page id="1"><fragment id="2">' +
    '<n id="3" p="0 0"/><n id="4" p="14.4 0"/><n id="6" p="28.8 0"/>' +
    '<b id="5" B="3" E="4"/><b id="7" B="4" E="6"/></fragment></page></CDXML>';
  const { document } = cdxmlToChemDrawDocument(xml);
  const fragment = extractDocumentSelection(document, new Set(['5']));
  const kinds = fragment.pages[0].objects.map((object) => object.type).sort();
  assert.deepEqual(kinds, ['bond', 'node', 'node']);
  assert.equal(extractDocumentSelection(document, new Set()), null);
  assert.equal(extractDocumentSelection(document, new Set(['nope'])), null);
});

test('a selection with opaque preserved children falls back instead of copying wrongly', () => {
  const { document } = cdxmlToChemDrawDocument(
    '<?xml version="1.0"?><CDXML><page id="1"><fragment id="2"><n id="3" p="0 0"/></fragment></page></CDXML>',
  );
  const tampered = structuredClone(document);
  const node = tampered.pages[0].objects.find((object) => object.type === 'node');
  node.preservation = { rawChildrenXml: ['<annotation id="9"/>'] };
  assert.equal(extractDocumentSelection(tampered, new Set([node.id])), null);
});
