import { mkdirSync, existsSync, copyFileSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const srcBase = join(root, 'node_modules/@rdkit/rdkit/dist');
const destDir = join(root, 'public/rdkit');

mkdirSync(destDir, { recursive: true });

for (const file of ['RDKit_minimal.js', 'RDKit_minimal.wasm']) {
  const src = join(srcBase, file);
  const dest = join(destDir, file);
  const srcMtime = statSync(src).mtimeMs;
  const needsCopy = !existsSync(dest) || srcMtime > statSync(dest).mtimeMs;
  if (needsCopy) {
    copyFileSync(src, dest);
    console.log(`Copied ${file} to public/rdkit/`);
  }
}
