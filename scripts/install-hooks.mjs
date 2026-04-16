import { existsSync, copyFileSync, chmodSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const gitDir = join(root, '.git');

if (existsSync(gitDir)) {
  const src = join(root, 'scripts', 'pre-commit.sh');
  const dest = join(gitDir, 'hooks', 'pre-commit');
  copyFileSync(src, dest);
  try {
    chmodSync(dest, 0o755);
  } catch {
    /* no-op on Windows */
  }
  console.log('Installed .git/hooks/pre-commit');
} else {
  console.log('No .git directory found — skipping hook install');
}
