import assert from 'node:assert/strict';
import { readdirSync, realpathSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = realpathSync(process.argv[2]);
assert(
  !root.startsWith(realpathSync(process.cwd()) + path.sep),
  'Extract/install the package outside the checkout',
);
const files = [];
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(name);
    else files.push(name);
  }
}
walk(root);
const binaryName = process.platform === 'win32' ? 'chem-engine.exe' : 'chem-engine';
const engines = files.filter((file) => path.basename(file) === binaryName);
assert.equal(engines.length, 1, `Expected one bundled sidecar: ${engines}`);
for (const name of [
  'nmr_refs.json',
  'nmr_hose_db.sqlite',
  process.platform === 'win32' ? 'xtb.exe' : 'xtb',
]) {
  assert(
    files.some((file) => path.basename(file) === name),
    `Missing ${name}`,
  );
}
assert(
  files.some((file) => file.includes(`${path.sep}xtb-share${path.sep}`)),
  'Missing xTB parameters',
);
assert(
  !files.some((file) => file.includes(`${path.sep}PIL${path.sep}`)),
  'Unexpected Pillow payload',
);
const cwd = mkdtempSync(path.join(tmpdir(), 'chem-packaged-check-'));
const env = {
  ...process.env,
  PYTHONPATH: '',
  PYTHONHOME: '',
  OMP_NUM_THREADS: '1',
  OPENBLAS_NUM_THREADS: '1',
};
function run(args) {
  const result = spawnSync(engines[0], args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 120_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert(!payload.error, JSON.stringify(payload));
  return payload;
}
assert.equal(run(['protocol']).protocol, 1);
const dependencies = run(['self-check']);
assert.equal(dependencies.ok, true);
assert.equal(dependencies.frozen, true);
assert.equal(
  dependencies.pyscf,
  process.platform !== 'win32',
  'PySCF is required on supported native platforms',
);
assert(
  realpathSync(dependencies.resources).startsWith(root + path.sep),
  'Dependencies must load from the installed package',
);
assert(Object.keys(run(['properties', 'CCO'])).length > 0);
assert(run(['conformer', 'CCO', '--max', '1', '--ff', 'MMFF94s']).conformers.length === 1);
const evidence = {
  commit: process.env.GITHUB_SHA,
  platform: process.platform,
  architecture: process.arch,
  root,
  sidecar: engines[0],
  dependencies,
  checks: ['protocol', 'resources', 'native dependencies', 'properties', 'one MMFF conformer'],
};
writeFileSync(
  process.env.PACKAGE_CHECK_REPORT ?? path.join(cwd, 'package-check.json'),
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence, null, 2));
