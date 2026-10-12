import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { listFixtures, FIXTURE_DIR } from '../scripts/lib/scene-goldens.mjs';
import { cdxmlToChemDrawDocument } from '../.unit-test-dist/src/utils/cdxml.js';
import { generateDocumentSVG } from '../.unit-test-dist/src/lib/svgExport.js';
import { generateDocumentSVGFromScene } from '../.unit-test-dist/src/lib/sceneSvgExport.js';

/**
 * Parity gate for retiring the hand-maintained SVG renderer in svgExport.ts.
 *
 * `generateDocumentSVGFromScene` draws through `renderDocumentScene` (the on-screen path) and
 * takes its bounds from what was actually painted. The legacy exporter re-derives both. Until
 * the two agree on the corpus, or every difference is listed here with a reason, the legacy
 * path must stay.
 */

/** Fixtures where the legacy exporter's size is not a valid lower bound, and why. */
const KNOWN_SIZE_DIVERGENCES = new Map([
  [
    'orbitals.cdxml',
    'legacy lays out all orbital types with its own heuristic extents and rotates the drawn lobes; the scene draws only the s/p types, axis-aligned (see the fixture comment)',
  ],
]);

/** Fixtures whose visible text legitimately differs, and why. */
const KNOWN_TEXT_DIVERGENCES = new Map([
  [
    'object-tags.cdxml',
    'the scene draws the node object tag ("C1") that the legacy exporter omits; neither draws the bond tag, which bondModule does not implement',
  ],
]);

const visibleText = (svg) =>
  svg
    .replace(/<defs>[\s\S]*?<\/defs>/g, '')
    .replace(/<[^>]+>/g, '|')
    .split('|')
    .filter(Boolean)
    .sort();

const size = (svg) => {
  const match = /<svg[^>]* width="([\d.]+)" height="([\d.]+)"/.exec(svg);
  assert.ok(match, 'svg has width/height');
  return { width: Number(match[1]), height: Number(match[2]) };
};

for (const fixture of listFixtures()) {
  test(`${fixture}: scene export agrees with the legacy exporter`, () => {
    const document = cdxmlToChemDrawDocument(
      readFileSync(path.join(FIXTURE_DIR, fixture), 'utf8'),
    ).document;
    const legacy = generateDocumentSVG(document);
    const scene = generateDocumentSVGFromScene(document);

    assert.doesNotMatch(scene, /NaN|undefined|Infinity/);
    if (!KNOWN_TEXT_DIVERGENCES.has(fixture)) {
      assert.deepEqual(visibleText(scene), visibleText(legacy), 'same text content');
    }

    if (KNOWN_SIZE_DIVERGENCES.has(fixture)) return;
    const a = size(legacy);
    const b = size(scene);
    // The scene export is sized from painted ink, so it may be larger where the legacy
    // heuristics clipped labels, but it must never be smaller.
    assert.ok(b.width >= a.width - 1, `${fixture}: scene ${b.width} < legacy ${a.width} wide`);
    assert.ok(b.height >= a.height - 1, `${fixture}: scene ${b.height} < legacy ${a.height} high`);
  });
}

test('an empty document exports a placeholder canvas instead of throwing', () => {
  const svg = generateDocumentSVGFromScene({
    schemaVersion: 1,
    source: 'manual',
    pages: [{ id: 'page-1', objects: [] }],
  });
  assert.match(svg, /^<svg /);
});

test('transparent export omits the background rect', () => {
  const document = cdxmlToChemDrawDocument(
    readFileSync(path.join(FIXTURE_DIR, 'bond-orders.cdxml'), 'utf8'),
  ).document;
  assert.match(generateDocumentSVGFromScene(document), /<rect [^>]*fill="#f5f5f5"/);
  assert.doesNotMatch(
    generateDocumentSVGFromScene(document, { transparent: true }),
    /<rect [^>]*fill="#f5f5f5"/,
  );
});
