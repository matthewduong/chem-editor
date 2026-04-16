import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const steps = [
  { label: 'JavaScript unit tests', command: 'pnpm', args: ['test:js'] },
  { label: 'JavaScript UI tests', command: 'pnpm', args: ['test:js:ui'] },
  { label: 'Python unit tests', command: 'pnpm', args: ['test:py'] },
  { label: 'Rust tests', command: 'pnpm', args: ['test:rust'] },
];

for (const step of steps) {
  console.log(`\n==> ${step.label}`);
  const result = spawnSync(step.command, step.args, {
    cwd: rootDir,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
