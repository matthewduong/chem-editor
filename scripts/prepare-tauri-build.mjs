import path from 'node:path';
import { run } from './lib/command-utils.mjs';
import { syncBuiltSidecars } from './lib/sidecar-sync.mjs';

if (process.env.CHEM_EDITOR_SKIP_BEFORE_BUILD === '1') {
  process.exit(0);
}

run(['pnpm', 'pnpm.cmd'], ['build:web'], { description: 'pnpm' });
run(['node'], ['src-tauri/build-sidecar.js'], { description: 'Node.js' });
syncBuiltSidecars({
  sourceBinDir: path.join(process.cwd(), 'src-tauri', 'bin'),
  targetBinDirs: ['debug', 'release'].map((profile) =>
    path.join(process.cwd(), 'src-tauri', 'target', profile, 'bin'),
  ),
});
