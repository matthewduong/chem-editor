import { homedir } from 'node:os';
import { existsSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { run } from './lib/command-utils.mjs';

const APP_IDENTIFIER = 'com.mrd.chem-editor';
const requestedBundles = process.env.CHEM_EDITOR_BUNDLE_TARGETS?.trim();
const defaultBundles = process.platform === 'darwin' ? 'app' : null;

function getSettingsPath() {
  const home = homedir();
  switch (process.platform) {
    case 'darwin':
      return path.join(home, 'Library', 'Application Support', APP_IDENTIFIER, 'settings.json');
    case 'win32': {
      const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming');
      return path.join(appData, APP_IDENTIFIER, 'settings.json');
    }
    default:
      return path.join(
        process.env.XDG_CONFIG_HOME ?? path.join(home, '.config'),
        APP_IDENTIFIER,
        'settings.json',
      );
  }
}

function clearPersistedSettings() {
  rmSync(getSettingsPath(), { force: true });
}

function hasForbiddenSidecarPayload(rootDir) {
  if (!existsSync(rootDir)) {
    return false;
  }
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'PIL' || entry.name === 'pillow.libs') {
          return true;
        }
        stack.push(fullPath);
      }
    }
  }
  return false;
}

clearPersistedSettings();

run(['node'], ['scripts/prepare-tauri-build.mjs'], { description: 'Node.js', env: process.env });

const tauriArgs = ['exec', 'tauri', 'build'];
if (requestedBundles || defaultBundles) {
  tauriArgs.push('--bundles', requestedBundles ?? defaultBundles);
} else {
  tauriArgs.push('--no-bundle');
}

run(['pnpm', 'pnpm.cmd'], tauriArgs, {
  description: 'pnpm',
  env: {
    ...process.env,
    CHEM_EDITOR_SKIP_BEFORE_BUILD: '1',
  },
});

const releaseSidecarDir = path.join(process.cwd(), 'src-tauri', 'target', 'release', 'bin');
if (hasForbiddenSidecarPayload(releaseSidecarDir)) {
  throw new Error(
    `Packaged sidecar under ${releaseSidecarDir} still contains forbidden PIL payload`,
  );
}
