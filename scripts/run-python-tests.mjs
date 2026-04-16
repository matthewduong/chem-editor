import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uvCacheDir =
  process.env.UV_CACHE_DIR ??
  (process.platform === 'win32' ? path.join(rootDir, '.uv-cache') : '/tmp/uv-cache');

const testRun = spawnSync(
  'uv',
  [
    'run',
    '--project',
    'src-tauri',
    'python',
    '-m',
    'unittest',
    'discover',
    '-s',
    'src-tauri/tests',
    '-p',
    'test_*.py',
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
