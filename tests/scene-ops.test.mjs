import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import {
  goldenPathFor,
  listFixtures,
  readGolden,
  recordFixture,
} from '../scripts/lib/scene-goldens.mjs';

/**
 * Drawing-output regression for the live renderer.
 *
 * Each fixture is rendered through the real scene pipeline into a recorded op stream and
 * compared against a committed golden. Re-record with `pnpm goldens:record` and review the diff:
 * a change here means the picture changed.
 */
const fixtures = listFixtures();

test('the fixture corpus is not empty', () => {
  assert.ok(fixtures.length > 0, 'expected CDXML fixtures under tests/fixtures/cdxml');
});

for (const fixture of fixtures) {
  test(`scene ops match the golden for ${fixture}`, async () => {
    assert.ok(
      existsSync(goldenPathFor(fixture)),
      `missing golden for ${fixture}; run \`pnpm goldens:record\``,
    );

    const actual = await recordFixture(fixture);
    const expected = readGolden(fixture);

    // Compare op-by-op so a failure names the first divergent call rather than dumping
    // two multi-hundred-entry arrays.
    const shared = Math.min(actual.length, expected.length);
    for (let index = 0; index < shared; index += 1) {
      assert.deepEqual(
        actual[index],
        expected[index],
        `${fixture}: op ${index} diverged from the golden`,
      );
    }
    assert.equal(actual.length, expected.length, `${fixture}: op count changed`);
  });
}

test('every fixture draws something', async () => {
  for (const fixture of fixtures) {
    const ops = await recordFixture(fixture);
    const draws = ops.filter(
      (entry) =>
        entry.op === 'call' && ['stroke', 'fill', 'fillText', 'fillRect'].includes(entry.name),
    );
    assert.ok(draws.length > 0, `${fixture} recorded no drawing operations`);
  }
});
