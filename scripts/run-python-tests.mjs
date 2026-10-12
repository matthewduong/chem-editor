import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireExecutable } from './lib/command-utils.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Resolve through PATHEXT so this works on Windows, where the binary is uv.exe.
const uv = requireExecutable('uv', 'uv');
const uvCacheDir =
  process.env.UV_CACHE_DIR ??
  (process.platform === 'win32' ? path.join(rootDir, '.uv-cache') : '/tmp/uv-cache');

const integration = process.argv.includes('--qm');

const testRun = spawnSync(
  uv,
  [
    'run',
    '--locked',
    ...(integration ? ['--group', 'nmr-dft'] : []),
    '--project',
    'src-tauri',
    'python',
    '-m',
    'unittest',
    'discover',
    '-s',
    'src-tauri/tests',
    '-p',
    integration ? 'integration_*.py' : 'test_*.py',
  ],
  {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      UV_CACHE_DIR: uvCacheDir,
    },
  },
);

process.exit(testRun.status ?? 1);
