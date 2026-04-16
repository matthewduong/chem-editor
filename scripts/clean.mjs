import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const srcTauriDir = path.join(repoRoot, 'src-tauri');
const binDir = path.join(srcTauriDir, 'bin');

const directTargets = [
  path.join(repoRoot, 'dist'),
  path.join(repoRoot, '.unit-test-dist'),
  path.join(srcTauriDir, 'dist'),
  path.join(srcTauriDir, 'build'),
  path.join(srcTauriDir, '.venv'),
  path.join(repoRoot, 'development', '__pycache__'),
  path.join(srcTauriDir, 'bin', '__pycache__'),
  path.join(srcTauriDir, 'tests', '__pycache__'),
  path.join(binDir, 'nmr_hose_db.json'),
  path.join(binDir, 'nmr_hose_db.sqlite'),
  path.join(binDir, 'xtb'),
  path.join(binDir, 'xtb.exe'),
  path.join(binDir, 'xtb-share'),
  path.join(repoRoot, 'node_modules'),
];

for (const target of directTargets) {
  rmSync(target, { recursive: true, force: true });
}

if (existsSync(binDir)) {
  for (const entry of readdirSync(binDir, { withFileTypes: true })) {
    if (!entry.name.startsWith('chem-engine-')) {
      continue;
    }
    rmSync(path.join(binDir, entry.name), { recursive: true, force: true });
  }
}
