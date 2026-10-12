import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';

const FIXTURE_DIR = new URL('./fixtures/cdxml/', import.meta.url).pathname;
const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.cdxml'))
  .map((name) => ({ name, xml: readFileSync(join(FIXTURE_DIR, name), 'utf8') }));

const wrap = (body) => `<?xml version="1.0"?><CDXML><page id="1">${body}</page></CDXML>`;

// The malformed-input rejection test lives with cdxmlValidation.ts, which is not part of this
// commit's tree.

for (const { name, xml } of fixtures) {
  test(`${name}: re-export is a fixed point after one round trip`, () => {
    const first = chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(xml).document);
    const second = chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(first).document);
    assert.equal(second, first);
  });

  test(`${name}: truncations and byte damage never escape as non-Error crashes`, () => {
    const cuts = [0.1, 0.25, 0.5, 0.75, 0.9].map((f) => Math.floor(xml.length * f));
    const variants = cuts.map((cut) => xml.slice(0, cut));
    // Deterministic damage: corrupt a numeric attribute and drop a closing tag.
    variants.push(xml.replace(/ p="[^"]*"/, ' p="x y"'));
    variants.push(xml.replace(/<\/fragment>/, ''));
    for (const variant of variants) {
      try {
        const { document } = cdxmlToChemDrawDocument(variant);
        chemDrawDocumentToCDXML(document);
      } catch (error) {
        assert.ok(
          error instanceof Error && !(error instanceof TypeError),
          `unexpected ${error?.constructor?.name}: ${error?.message}`,
        );
      }
    }
  });
}
