import path from 'node:path';
import { run } from './lib/command-utils.mjs';
import { syncBuiltSidecars } from './lib/sidecar-sync.mjs';

run(['node'], ['src-tauri/build-sidecar.js'], { description: 'Node.js' });
syncBuiltSidecars({
  sourceBinDir: path.join(process.cwd(), 'src-tauri', 'bin'),
  targetBinDirs: [path.join(process.cwd(), 'src-tauri', 'target', 'debug', 'bin')],
});
run(['pnpm', 'pnpm.cmd'], ['dev:web'], { description: 'pnpm' });
