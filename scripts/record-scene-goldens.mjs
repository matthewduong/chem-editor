import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildUnitTestDist } from './lib/unit-test-build.mjs';
import { ensureDomParserGlobals } from './lib/dom-globals.mjs';
import {
  FIXTURE_DIR,
  GOLDEN_DIR,
  goldenPathFor,
  listFixtures,
  recordFixture,
} from './lib/scene-goldens.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

await buildUnitTestDist(rootDir);
ensureDomParserGlobals();
mkdirSync(GOLDEN_DIR, { recursive: true });

const only = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const fixtures = only.length > 0 ? only : listFixtures();

let written = 0;
const failures = [];

for (const fixture of fixtures) {
  try {
    const ops = await recordFixture(fixture);
    writeFileSync(goldenPathFor(fixture), `${JSON.stringify(ops, null, 2)}\n`);
    console.log(`recorded ${fixture} (${ops.length} ops)`);
    written += 1;
  } catch (error) {
    failures.push({ fixture, message: error instanceof Error ? error.message : String(error) });
  }
}

if (failures.length > 0) {
  console.error(`\n${failures.length} fixture(s) could not be recorded:`);
  for (const failure of failures) {
    console.error(`  ${failure.fixture}: ${failure.message}`);
  }
  console.error(
    `\nFixtures whose scenes contain atom labels, text boxes or object tags cannot render` +
      ` headlessly yet: those paths measure text through a DOM canvas.`,
  );
}

console.log(`\n${written} golden(s) written to ${path.relative(rootDir, GOLDEN_DIR)}`);
console.log(`fixtures read from ${path.relative(rootDir, FIXTURE_DIR)}`);
process.exit(failures.length > 0 ? 1 : 0);
