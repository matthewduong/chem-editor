import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export async function buildUnitTestDist(rootDir, options = {}) {
  const tsconfigPath = options.tsconfigPath ?? 'tsconfig.unit.json';
  const outDir = options.outDir ?? path.join(rootDir, '.unit-test-dist');

  await rm(outDir, { recursive: true, force: true });

  const tsc = spawnSync('pnpm', ['exec', 'tsc', '-p', tsconfigPath], {
    cwd: rootDir,
    stdio: 'inherit',
  });

  if (tsc.status !== 0) {
    process.exit(tsc.status ?? 1);
  }

  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 2));
  return outDir;
}
