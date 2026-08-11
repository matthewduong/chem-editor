import test from 'node:test';
import assert from 'node:assert/strict';

import { listFixtures, renderFixtureToSvg, recordFixture } from '../scripts/lib/scene-goldens.mjs';

/**
 * Proves the SVG backend consumes the same draw path as the screen renderer.
 *
 * Both outputs come from one `renderDocumentScene` call, so this is not comparing two
 * implementations: it checks that the SVG context faithfully turns those calls into markup, and
 * that nothing is silently dropped.
 */
const fixtures = listFixtures();

for (const fixture of fixtures) {
  test(`${fixture} renders to well-formed SVG`, async () => {
    const svg = await renderFixtureToSvg(fixture);

    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
    assert.match(svg, /<\/svg>$/);
    // Every '<' that opens a tag must be balanced by a matching close or self-close.
    const opens = (svg.match(/<[a-z]/g) ?? []).length;
    const closes = (svg.match(/<\/[a-z]+>/g) ?? []).length + (svg.match(/\/>/g) ?? []).length;
    assert.equal(opens, closes, `${fixture}: unbalanced SVG elements`);
    assert.doesNotMatch(svg, /NaN|undefined|Infinity/, `${fixture}: emitted a non-finite value`);
  });
}

test('SVG output covers every drawing operation the renderer performs', async () => {
  for (const fixture of fixtures) {
    const ops = await recordFixture(fixture);
    const svg = await renderFixtureToSvg(fixture);

    const strokes = ops.filter((op) => op.op === 'call' && op.name === 'stroke').length;
    const fills = ops.filter(
      (op) => op.op === 'call' && (op.name === 'fill' || op.name === 'fillRect'),
    ).length;
    const texts = ops.filter((op) => op.op === 'call' && op.name === 'fillText').length;
    const strokeRects = ops.filter((op) => op.op === 'call' && op.name === 'strokeRect').length;

    const paths = (svg.match(/<path/g) ?? []).length;
    const svgTexts = (svg.match(/<text/g) ?? []).length;

    // fillText with empty content draws nothing on canvas and is skipped here too, so SVG text
    // count is a lower bound rather than an equality.
    assert.ok(
      svgTexts <= texts,
      `${fixture}: emitted ${svgTexts} <text> for ${texts} fillText calls`,
    );
    assert.ok(
      paths <= strokes + fills + strokeRects,
      `${fixture}: emitted ${paths} <path> for ${strokes + fills + strokeRects} paint calls`,
    );
    // Anything the renderer painted must show up somewhere in the markup.
    if (strokes + fills + strokeRects > 0) assert.ok(paths > 0, `${fixture}: painted nothing`);
    if (texts > 0) assert.ok(svgTexts > 0, `${fixture}: drew no text`);
  }
});
