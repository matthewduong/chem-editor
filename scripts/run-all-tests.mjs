import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireExecutable } from './lib/command-utils.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Resolve through PATHEXT so this works on Windows, where the binary is pnpm.cmd.
const pnpm = requireExecutable('pnpm', 'pnpm');

const steps = [
  { label: 'JavaScript unit tests', args: ['test:js'] },
  { label: 'JavaScript UI tests', args: ['test:js:ui'] },
  { label: 'Python unit tests', args: ['test:py'] },
  { label: 'Rust tests', args: ['test:rust'] },
];

for (const step of steps) {
  console.log(`\n==> ${step.label}`);
  const result = spawnSync(pnpm, step.args, {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
