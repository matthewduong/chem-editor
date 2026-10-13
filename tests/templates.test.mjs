import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTemplateLibrary,
  saveSelectionTemplate,
  placeTemplate,
} from '../.unit-test-dist/src/lib/templates.js';
import {
  chemDrawDocumentToCDXML,
  cdxmlToChemDrawDocument,
} from '../.unit-test-dist/src/utils/cdxml.js';
const node = (id, x, y = 0) => ({ id, type: 'node', element: 'C', position: { x, y } });
const bond = (id, a, b) => ({ id, type: 'bond', beginNodeId: a, endNodeId: b, order: 1 });
const doc = (objects) => ({
  schemaVersion: 1,
  source: 'canvas-state',
  pages: [{ id: 'page', objects }],
});
const source = () =>
  doc([
    node('a', 0),
    node('b', 30),
    bond('bond', 'a', 'b'),
    { id: 'f', type: 'fragment', nodeIds: ['a', 'b'], bondIds: ['bond'] },
    { id: 'g', type: 'group', childIds: ['f'] },
  ]);

test('versioned templates preserve styles and references through repeated placement and reopen', () => {
  const original = source();
  original.pages[0].objects[1].element = 'N';
  original.pages[0].objects[1].style = { color: '#123456' };
  const template = saveSelectionTemplate(original, new Set(['g']), 'ethyl', ['alkyl']);
  const library = parseTemplateLibrary(JSON.stringify({ version: 1, templates: [template] }));
  const first = placeTemplate(doc([]), library.templates[0], { x: 100, y: 100 });
  const second = placeTemplate(first.document, template, { x: 200, y: 200 });
  const objects = second.document.pages[0].objects;
  assert.equal(new Set(objects.map((o) => o.id)).size, objects.length);
  const ids = new Set(objects.map((o) => o.id));
  for (const o of objects)
    if (o.type === 'bond') assert.ok(ids.has(o.beginNodeId) && ids.has(o.endNodeId));
  assert.equal(objects.filter((o) => o.type === 'node' && o.style?.color === '#123456').length, 2);
  const xml = chemDrawDocumentToCDXML(second.document);
  assert.equal(chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(xml).document), xml);
});
test('annotations can be stored standalone; opaque selections and newer libraries are refused', () => {
  const annotation = doc([
    { id: 't', type: 'text', anchor: { x: 0, y: 0 }, text: { runs: [{ text: 'hello' }] } },
  ]);
  const template = saveSelectionTemplate(annotation, new Set(['t']), 'note', []);
  assert.equal(
    placeTemplate(doc([]), template, { x: 30, y: 40 }).document.pages[0].objects[0].text.runs[0]
      .text,
    'hello',
  );
  annotation.pages[0].objects[0].preservation = { rawChildrenXml: ['<unknown/>'] };
  assert.throws(() => saveSelectionTemplate(annotation, new Set(['t']), 'bad', []), /faithfully/);
  assert.throws(() => parseTemplateLibrary('{"version":2,"templates":[]}'), /version/);
  assert.throws(() => parseTemplateLibrary('{"version":1,"templates":[{}]}'), /template/);
});
test('atom attachment merges the designated atom and remaps bonds without mutating target', () => {
  const template = saveSelectionTemplate(source(), new Set(['g']), 'ethyl', [], { atomId: 'a' });
  const target = doc([node('target', 100, 100)]),
    before = structuredClone(target);
  const result = placeTemplate(target, template, { x: 0, y: 0 }, 'target');
  assert.deepEqual(target, before);
  assert.equal(result.document.pages[0].objects.filter((o) => o.type === 'node').length, 2);
  const b = result.document.pages[0].objects.find((o) => o.type === 'bond');
  assert.equal(b.beginNodeId, 'target');
  const conflict = doc([{ ...node('target', 100), element: 'O' }]);
  assert.throws(() => placeTemplate(conflict, template, { x: 0, y: 0 }, 'target'), /conflict/);
});
test('bond attachment rotates the fragment and retains the target bond', () => {
  const fragment = source();
  fragment.pages[0].objects.push(node('c', 30, 30), bond('extra', 'b', 'c'));
  fragment.pages[0].objects.find((o) => o.id === 'f').nodeIds.push('c');
  fragment.pages[0].objects.find((o) => o.id === 'f').bondIds.push('extra');
  const template = saveSelectionTemplate(fragment, new Set(['g']), 'corner', [], {
    bondId: 'bond',
  });
  const target = doc([node('x', 100, 100), node('y', 100, 130), bond('target', 'x', 'y')]);
  const result = placeTemplate(target, template, { x: 0, y: 0 }, 'target');
  assert.equal(result.document.pages[0].objects.filter((o) => o.type === 'node').length, 3);
  assert.equal(result.document.pages[0].objects.filter((o) => o.type === 'bond').length, 2);
  assert.ok(result.document.pages[0].objects.some((o) => o.id === 'target'));
  const xml = chemDrawDocumentToCDXML(result.document);
  assert.doesNotThrow(() => cdxmlToChemDrawDocument(xml));
});

test('attachment to a molecular fragment retains a single fragment owner per node', () => {
  const target = source();
  const template = saveSelectionTemplate(source(), new Set(['g']), 'ethyl', [], { atomId: 'a' });
  const result = placeTemplate(target, template, { x: 0, y: 0 }, 'b');
  const fragments = result.document.pages[0].objects.filter((o) => o.type === 'fragment');
  assert.equal(fragments.length, 1);
  assert.equal(fragments[0].id, 'f');
  assert.equal(fragments[0].nodeIds.length, 3);
  const xml = chemDrawDocumentToCDXML(result.document);
  assert.doesNotThrow(() => cdxmlToChemDrawDocument(xml));
});
