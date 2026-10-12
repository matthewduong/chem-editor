import test from 'node:test';
import assert from 'node:assert/strict';

import { parseDocumentRecovery } from '../.unit-test-dist/src/lib/recoveryFormat.js';

const document = {
  schemaVersion: 1,
  source: 'manual',
  pages: [{ id: 'p1', objects: [] }],
};
const valid = { version: 1, savedAt: '2026-10-12T00:00:00Z', path: null, document };

test('accepts a well-formed recovery snapshot', () => {
  const parsed = parseDocumentRecovery(JSON.stringify(valid));
  assert.equal(parsed.path, null);
  assert.equal(parsed.document.pages[0].id, 'p1');
});

const bad = [
  ['truncated JSON', '{"version":1,"savedAt":', /not valid JSON/],
  ['empty string', '', /not valid JSON/],
  ['non-object', '[1,2]', /not a recovery snapshot/],
  ['null', 'null', /not a recovery snapshot/],
  ['wrong version', JSON.stringify({ ...valid, version: 2 }), /unsupported version 2/],
  ['missing savedAt', JSON.stringify({ ...valid, savedAt: undefined }), /save time/],
  ['bad path type', JSON.stringify({ ...valid, path: 7 }), /document path/],
  ['missing document', JSON.stringify({ ...valid, document: undefined }), /unsupported schema/],
  [
    'wrong schemaVersion',
    JSON.stringify({ ...valid, document: { ...document, schemaVersion: 9 } }),
    /unsupported schema/,
  ],
  ['no pages', JSON.stringify({ ...valid, document: { ...document, pages: [] } }), /no pages/],
  [
    'pages not an array',
    JSON.stringify({ ...valid, document: { ...document, pages: {} } }),
    /no pages/,
  ],
  [
    'page without objects',
    JSON.stringify({ ...valid, document: { ...document, pages: [{ id: 'p1' }] } }),
    /malformed page/,
  ],
  [
    'object without type',
    JSON.stringify({
      ...valid,
      document: { ...document, pages: [{ id: 'p1', objects: [{ id: 'x' }] }] },
    }),
    /malformed object/,
  ],
  [
    'dangling reference',
    JSON.stringify({
      ...valid,
      document: {
        ...document,
        pages: [
          { id: 'p1', objects: [{ id: 'f', type: 'fragment', nodeIds: ['missing'], bondIds: [] }] },
        ],
      },
    }),
    null,
  ],
];

for (const [name, contents, pattern] of bad) {
  test(`rejects ${name} with a named Error`, () => {
    try {
      parseDocumentRecovery(contents);
    } catch (error) {
      assert.ok(error instanceof Error);
      assert.notEqual(error.constructor, TypeError, `got a stray TypeError: ${error.message}`);
      if (pattern) assert.match(error.message, pattern);
      return;
    }
    // The dangling-reference case is allowed to be tolerated by the projection; the rest must throw.
    assert.equal(pattern, null, `${name} was accepted`);
  });
}
