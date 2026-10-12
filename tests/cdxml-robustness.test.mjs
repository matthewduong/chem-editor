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

// Importing must either succeed or fail with a plain Error naming the problem. A TypeError or
// RangeError means a parser assumption leaked, and in the app that is how a bad file turns into
// a blank "successfully opened" document.
function expectRejected(xml, pattern, label) {
  assert.throws(
    () => cdxmlToChemDrawDocument(xml),
    (error) =>
      error instanceof Error && !(error instanceof TypeError) && pattern.test(error.message),
    label,
  );
}

test('malformed CDXML is rejected with a descriptive error, not a blank document', () => {
  expectRejected('<CDXML><page>', /Invalid CDXML/, 'truncated');
  expectRejected('<notcdxml/>', /Invalid CDXML/, 'wrong root');
  expectRejected('', /Invalid CDXML/, 'empty');
  expectRejected(
    wrap('<fragment id="2"><n id="3" p="0 0"/><n id="3" p="1 1"/></fragment>'),
    /duplicate or empty object ID/,
    'duplicate id',
  );
  expectRejected(
    wrap('<fragment id="2"><n id="3" p="0 NaN"/></fragment>'),
    /invalid coordinates/,
    'NaN coordinate',
  );
  expectRejected(
    wrap('<fragment id="2"><n id="3" p="0 0"/><b id="4" B="3" E="99"/></fragment>'),
    /references missing node/,
    'dangling bond end',
  );
  expectRejected(
    wrap(
      '<fragment id="2"><n id="3" p="0 0"/></fragment><bracketedgroup id="5" BracketedObjectIDs="42"/>',
    ),
    /missing bracketed object/,
    'dangling bracketed object',
  );
});

// ChemDraw gives each <graphic GraphicType="Bracket">'s own <objecttag> children (the hidden
// "parameterizedBracketLabel"/"bracketusage" pair a multiplied-group bracket carries) their own
// id namespace, scoped per bracket rather than per page. A real ChemDraw file with several such
// brackets legitimately reuses id="1"/id="2" once per bracket; minimized from a real-ChemDraw
// corpus file that first surfaced this.
const bracketWithObjectTags = (id) =>
  `<graphic id="${id}" GraphicType="Bracket" BracketType="Round" BracketUsage="MultipleGroup" BoundingBox="0 0 10 10">` +
  `<objecttag id="1" TagType="Unknown" Name="parameterizedBracketLabel"><t p="0 0"><s font="1" size="6">4</s></t></objecttag>` +
  `<objecttag id="2" TagType="Unknown" Name="bracketusage"><t p="0 0"><s font="1" size="6">4</s></t></objecttag>` +
  `</graphic>`;

test('objecttag ids reused across separate bracket graphics are not rejected', () => {
  const xml = wrap(
    `<fragment id="3"><n id="4" p="0 0"/></fragment>${bracketWithObjectTags(10)}${bracketWithObjectTags(11)}`,
  );
  assert.doesNotThrow(() => cdxmlToChemDrawDocument(xml));
});

test('the bracket-objecttag exemption does not widen into a general duplicate-id pass', () => {
  expectRejected(
    wrap('<fragment id="2"><n id="3" p="0 0"/><n id="3" p="1 1"/></fragment>'),
    /duplicate or empty object ID/,
    'two plain nodes sharing an id must still be rejected',
  );
  expectRejected(
    wrap(
      '<fragment id="2"><n id="3" p="0 0"/></fragment>' +
        '<objecttag id="9" TagType="Unknown"><t p="0 0"><s font="1" size="6">x</s></t></objecttag>' +
        '<objecttag id="9" TagType="Unknown"><t p="0 0"><s font="1" size="6">y</s></t></objecttag>',
    ),
    /duplicate or empty object ID/,
    'objecttags outside a bracket must still be unique',
  );
});

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
