/**
 * Compares two ChemDraw fidelity runs.
 *
 * `run-summary.json` tells you where one run stands; this tells you whether a change moved it. Both
 * arguments are run directories under the artifact root:
 *
 *   node scripts/compare-chemdraw-runs.mjs .chemdraw-test-artifacts/<before> .chemdraw-test-artifacts/<after>
 *
 * Rendered extent is the number to watch. Differing-pixel counts are sensitive to font
 * rasterization and to how much of the page is inked, so they move for reasons that are not
 * fidelity; how far our drawing's width and height sit from ChemDraw's is not. A geometry mistake
 * shows up there first and unambiguously.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [beforeDir, afterDir] = process.argv.slice(2);
if (!beforeDir || !afterDir) {
  console.error('usage: node scripts/compare-chemdraw-runs.mjs <before-run-dir> <after-run-dir>');
  process.exit(1);
}

async function loadSummary(directory) {
  const summaryPath = path.resolve(directory, 'run-summary.json');
  try {
    return JSON.parse(await readFile(summaryPath, 'utf8'));
  } catch (error) {
    console.error(`Could not read ${summaryPath}: ${error.message}`);
    process.exit(1);
  }
}

const [before, after] = await Promise.all([loadSummary(beforeDir), loadSummary(afterDir)]);
const index = (summary) =>
  Object.fromEntries(summary.casesByVisualDiff.map((entry) => [entry.relativePath, entry.visual]));
const beforeCases = index(before);
const afterCases = index(after);
const shared = Object.keys(afterCases).filter((key) => beforeCases[key]);

if (shared.length === 0) {
  console.error('The two runs have no cases in common.');
  process.exit(1);
}

const widthError = (visual) =>
  Math.abs(visual.trimmed.chemEditor.width - visual.trimmed.chemdraw.width);
const heightError = (visual) =>
  Math.abs(visual.trimmed.chemEditor.height - visual.trimmed.chemdraw.height);
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
const sum = (values) => values.reduce((total, value) => total + value, 0);
const compare = (label, fn, unit = 'px') => {
  const from = mean(shared.map((key) => fn(beforeCases[key])));
  const to = mean(shared.map((key) => fn(afterCases[key])));
  // Compare at the precision shown, so a difference too small to print does not read as a verdict.
  const delta = Number(to.toFixed(1)) - Number(from.toFixed(1));
  const arrow = delta < 0 ? 'better' : delta > 0 ? 'WORSE' : 'unchanged';
  console.log(
    `  ${label.padEnd(28)} ${from.toFixed(1)}${unit} -> ${to.toFixed(1)}${unit}  ${arrow}`,
  );
};

console.log(`cases compared: ${shared.length}`);
console.log(
  `\npass/fail: ${before.passCount}/${before.failCount} -> ${after.passCount}/${after.failCount}`,
);
console.log('\nagainst ChemDraw, mean over all cases:');
compare('rendered width error', widthError);
compare('rendered height error', heightError);
console.log(
  `  ${'total differing pixels'.padEnd(28)} ${sum(shared.map((k) => beforeCases[k].diffPixels)).toLocaleString()} -> ${sum(shared.map((k) => afterCases[k].diffPixels)).toLocaleString()}`,
);

const moved = shared
  .map((key) => ({
    key,
    delta: heightError(afterCases[key]) - heightError(beforeCases[key]),
    widthDelta: widthError(afterCases[key]) - widthError(beforeCases[key]),
  }))
  .filter((entry) => Math.abs(entry.delta) > 2 || Math.abs(entry.widthDelta) > 2);

const worse = moved.filter((entry) => entry.delta > 2 || entry.widthDelta > 2);
console.log(`\ncases whose extent moved: ${moved.length} (${worse.length} further from ChemDraw)`);
for (const entry of worse
  .sort((a, b) => b.delta + b.widthDelta - (a.delta + a.widthDelta))
  .slice(0, 10)) {
  console.log(
    `  width ${entry.widthDelta > 0 ? '+' : ''}${entry.widthDelta}px  height ${entry.delta > 0 ? '+' : ''}${entry.delta}px   ${entry.key}`,
  );
}

const unexplained = (summary) =>
  Object.fromEntries(
    (summary.droppedOnImport?.unexplainedElements ?? []).map((e) => [e.name, e.caseCount]),
  );
const beforeDrops = unexplained(before);
const afterDrops = unexplained(after);
const dropKeys = [...new Set([...Object.keys(beforeDrops), ...Object.keys(afterDrops)])].sort();
if (dropKeys.length > 0) {
  console.log('\nunexplained import drops, by cases affected:');
  for (const key of dropKeys) {
    console.log(`  <${key}>`.padEnd(30) + `${beforeDrops[key] ?? 0} -> ${afterDrops[key] ?? 0}`);
  }
}
