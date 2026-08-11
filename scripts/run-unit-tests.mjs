import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { buildUnitTestDist } from './lib/unit-test-build.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await buildUnitTestDist(rootDir);

const testRun = spawnSync(
  'node',
  [
    '--import',
    pathToFileURL(path.join(rootDir, 'scripts', 'lib', 'dom-globals.mjs')).href,
    '--test',
    path.join('tests', '*.test.mjs'),
  ],
  {
    cwd: rootDir,
    stdio: 'inherit',
  },
);

process.exit(testRun.status ?? 1);
