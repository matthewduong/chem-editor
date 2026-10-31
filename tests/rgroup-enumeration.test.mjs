import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';
import { expandGenericStructures } from '../.unit-test-dist/src/lib/rGroupEnumeration.js';
import { DEFAULT_DOCUMENT_STYLE_SETTINGS } from '../.unit-test-dist/src/lib/settings.js';

const source = readFileSync(
  new URL('./fixtures/cdxml/rgroup-definition.cdxml', import.meta.url),
  'utf8',
);

test("an altgroup is read as an R-group definition with each member's attachment", () => {
  const { document } = cdxmlToChemDrawDocument(source);
  const [definition] = document.pages[0].rGroupDefinitions;
  assert.equal(definition.name, 'R1');
  assert.deepEqual(
    definition.members.map((m) => [m.fragmentId, m.attachmentNodeId]),
    [
      ['12', '13'],
      ['16', '17'],
    ],
  );
});

test('Expand Generic Structure draws one structure per member, each bonded where R was', () => {
  const { document } = cdxmlToChemDrawDocument(source);
  let n = 1000;
  const result = expandGenericStructures(document, new Set(), DEFAULT_DOCUMENT_STYLE_SETTINGS, () =>
    String(n++),
  );
  assert.equal(result.count, 2);
  const added = result.document.pages[0].objects.slice(document.pages[0].objects.length);
  const fragments = added.filter((o) => o.type === 'fragment');
  assert.equal(fragments.length, 2);
  const byId = new Map(result.document.pages[0].objects.map((o) => [o.id, o]));
  const elements = fragments.map((f) =>
    f.nodeIds
      .map((id) => byId.get(id).element ?? 'C')
      .sort()
      .join(''),
  );
  assert.deepEqual(elements, ['CCO', 'CCN']);
  for (const fragment of fragments) {
    assert.equal(fragment.bondIds.length, 2);
    // The heteroatom sits where the R was, one structure-width over.
    const hetero = fragment.nodeIds.map((id) => byId.get(id)).find((node) => node.element);
    const r = document.pages[0].objects.find((o) => o.id === '5');
    assert.ok(Math.abs(hetero.position.y - r.position.y) < 1e-9);
    assert.equal(hetero.preservation, undefined);
  }
  // The new structures are ordinary content: written once each, alongside the definition.
  const xml = chemDrawDocumentToCDXML(result.document);
  assert.equal((xml.match(/<fragment/g) ?? []).length, 5);
});
