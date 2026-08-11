import { createHash } from 'crypto';
import {
  cpSync,
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { spawnSync } from 'child_process';
import { tmpdir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { findExecutable, requireExecutable, run } from '../scripts/lib/command-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcTauri = __dirname;
const repoRoot = path.join(srcTauri, '..');
const binDir = path.join(srcTauri, 'bin');
const cacheDir = path.join(srcTauri, '.cache');
const stampPath = path.join(cacheDir, 'build-sidecar-stamp.json');
const pyprojectPath = path.join(srcTauri, 'pyproject.toml');
const uvLockPath = path.join(srcTauri, 'uv.lock');
const pythonSourceDir = path.join(srcTauri, 'bin');
const pyinstallerHooksDir = path.join(srcTauri, 'pyinstaller-hooks');
const hoseSourcePath = path.join(
  repoRoot,
  'development',
  'nmr_model',
  'data',
  'nmrshiftdb2withsignals.sd',
);
const hoseBuilderPath = path.join(repoRoot, 'development', 'build_nmr_hose_db.py');
const nmrRefsPath = path.join(binDir, 'nmr_refs.json');
const tauriConfigPath = path.join(srcTauri, 'tauri.conf.json');
const xtbStageRoot = path.join(cacheDir, 'xtb');

const XTB_VERSION = '6.7.1';
const NMR_SDF_URL =
  'https://sourceforge.net/projects/nmrshiftdb2/files/data/nmrshiftdb2withsignals.sd/download';
const pyinstallerPathSep = process.platform === 'win32' ? ';' : ':';
const exeSuffix = process.platform === 'win32' ? '.exe' : '';
const args = new Set(process.argv.slice(2));
const prepareOnly = args.has('--prepare-only');
const forceClean = process.env.CHEM_EDITOR_SIDECAR_CLEAN === '1';
const defaultUvCacheDir = path.join(tmpdir(), 'uv-cache');
const defaultPyinstallerConfigDir = path.join(cacheDir, 'pyinstaller');
const uvEnv = {
  ...process.env,
  UV_CACHE_DIR: process.env.UV_CACHE_DIR ?? defaultUvCacheDir,
  PYINSTALLER_CONFIG_DIR: process.env.PYINSTALLER_CONFIG_DIR ?? defaultPyinstallerConfigDir,
};

function createSidecarManifest() {
  return {
    trackedInputs: ['bin/chem-engine.py', 'bin/nmr_hose.py', 'bin/nmr_refs.json'],
    requiredRuntimeAssets: [
      { id: 'hoseDb', kind: 'data', source: 'bin/nmr_hose_db.sqlite', destination: '.' },
      { id: 'xtbBinary', kind: 'binary', source: `bin/xtb${exeSuffix}`, destination: '.' },
      { id: 'xtbShare', kind: 'data', source: 'bin/xtb-share', destination: 'xtb-share' },
    ],
    bundledResources: [
      'bin/chem-engine-*/**/*',
      'bin/nmr_refs.json',
      'bin/nmr_hose_db.sqlite',
      'bin/xtb*',
      'bin/xtb-share/**/*',
    ],
  };
}

function ensureDir(dir) {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function statSignature(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  const stats = statSync(filePath);
  if (stats.isDirectory()) {
    return {
      path: path.relative(repoRoot, filePath),
      type: 'dir',
      mtimeMs: stats.mtimeMs,
    };
  }
  return {
    path: path.relative(repoRoot, filePath),
    type: 'file',
    size: stats.size,
    mtimeMs: stats.mtimeMs,
  };
}

function collectFiles(dir, predicate) {
  if (!existsSync(dir)) {
    return [];
  }
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip generated sidecar bundles when fingerprinting source files.
      if (entry.name.startsWith('chem-engine-')) {
        continue;
      }
      files.push(...collectFiles(fullPath, predicate));
      continue;
    }
    if (predicate(fullPath)) {
      files.push(fullPath);
    }
  }
  return files.sort();
}

function hashPayload(payload) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function buildFingerprint(paths) {
  return hashPayload(paths.map((filePath) => statSignature(filePath)));
}

function readStamp() {
  if (!existsSync(stampPath)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(stampPath, 'utf8'));
  } catch {
    return {};
  }
}

function writeStamp(stamp) {
  ensureDir(cacheDir);
  writeFileSync(stampPath, `${JSON.stringify(stamp, null, 2)}\n`);
}

function validateTauriBundleResources(expectedResources) {
  const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, 'utf8'));
  const actualResources = tauriConfig.bundle?.resources ?? [];
  if (JSON.stringify(actualResources) !== JSON.stringify(expectedResources)) {
    throw new Error(
      `tauri.conf.json bundle.resources drifted from build-sidecar manifest.\nExpected: ${JSON.stringify(expectedResources)}\nActual: ${JSON.stringify(actualResources)}`,
    );
  }
}

function findTreeEntry(rootDir, predicate) {
  if (!existsSync(rootDir)) {
    return null;
  }
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (predicate(fullPath, entry)) {
        return fullPath;
      }
      if (entry.isDirectory()) {
        stack.push(fullPath);
      }
    }
  }
  return null;
}

function inferHostTriple() {
  const envTriple = process.env.TAURI_ENV_TARGET_TRIPLE ?? process.env.CARGO_BUILD_TARGET;
  if (envTriple) {
    return envTriple;
  }

  const archMap = {
    x64: 'x86_64',
    arm64: 'aarch64',
  };
  const arch = archMap[process.arch];
  if (!arch) {
    throw new Error(`Unsupported architecture for sidecar build: ${process.arch}`);
  }

  if (process.platform === 'linux') {
    return `${arch}-unknown-linux-gnu`;
  }
  if (process.platform === 'darwin') {
    return `${arch}-apple-darwin`;
  }
  if (process.platform === 'win32') {
    return `${arch}-pc-windows-msvc`;
  }

  throw new Error(`Unsupported platform for sidecar build: ${process.platform}`);
}

function assertRequiredTooling() {
  requireExecutable(['uv', 'uv.exe'], 'uv');
}

function getStagedXtbPaths() {
  return {
    xtbPath: path.join(binDir, `xtb${exeSuffix}`),
    xtbShareDir: path.join(binDir, 'xtb-share'),
  };
}

function clearStagedXtb() {
  rmSync(path.join(binDir, 'xtb'), { force: true });
  rmSync(path.join(binDir, 'xtb.exe'), { force: true });
  rmSync(path.join(binDir, 'xtb-share'), { recursive: true, force: true });
}

function stageXtb(binarySource, shareSource) {
  const { xtbPath, xtbShareDir } = getStagedXtbPaths();
  clearStagedXtb();
  cpSync(binarySource, xtbPath);
  cpSync(shareSource, xtbShareDir, { recursive: true });
  if (process.platform !== 'win32') {
    chmodSync(xtbPath, 0o755);
  }
  return { xtbPath, xtbShareDir };
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'chem-editor-build-sidecar',
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function downloadFile(url, destination) {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'chem-editor-build-sidecar' },
  });
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  writeFileSync(destination, new Uint8Array(arrayBuffer));
}

function archivePreference(asset) {
  if (asset.name.endsWith('.zip')) {
    return 0;
  }
  if (asset.name.endsWith('.tar.xz')) {
    return 1;
  }
  return 10;
}

async function resolveReleaseAsset() {
  const release = await fetchJson(
    `https://api.github.com/repos/grimme-lab/xtb/releases/tags/v${XTB_VERSION}`,
  );
  const assets = release.assets ?? [];
  const matches = assets
    .filter((asset) => {
      const name = asset.name.toLowerCase();
      if (process.platform === 'linux') {
        return process.arch === 'x64' && name.includes('linux') && name.includes('x86_64');
      }
      if (process.platform === 'win32') {
        return (
          process.arch === 'x64' &&
          name.includes('windows') &&
          (name.includes('x86_64') || name.includes('amd64'))
        );
      }
      return false;
    })
    .sort((left, right) => archivePreference(left) - archivePreference(right));

  if (matches.length === 0) {
    throw new Error(
      `No upstream xtb ${XTB_VERSION} asset found for ${process.platform}/${process.arch}`,
    );
  }

  return matches[0];
}

function extractArchive(archivePath, outputDir) {
  ensureDir(outputDir);
  if (archivePath.endsWith('.zip')) {
    run(
      [process.platform === 'win32' ? 'powershell.exe' : 'pwsh', 'powershell', 'pwsh'],
      [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${outputDir.replace(/'/g, "''")}' -Force`,
      ],
      { description: 'PowerShell' },
    );
    return;
  }
  run(['tar', 'tar.exe'], ['-xf', archivePath, '-C', outputDir], { description: 'tar' });
}

function findMacXtbInstall() {
  const checked = [];
  const addCheck = (candidate) => {
    if (candidate && !checked.includes(candidate)) {
      checked.push(candidate);
    }
  };

  const fromRoot = (root) => {
    if (!root) {
      return null;
    }
    addCheck(root);
    const binary = path.join(root, 'bin', 'xtb');
    const shareCandidates = [path.join(root, 'share', 'xtb'), path.join(root, 'xtb-share')];
    if (!existsSync(binary)) {
      return null;
    }
    const shareDir = shareCandidates.find((candidate) => existsSync(candidate));
    if (!shareDir) {
      return null;
    }
    return { binary, shareDir };
  };

  const envRoot = process.env.CHEM_EDITOR_XTB_ROOT;
  const envInstall = fromRoot(envRoot);
  if (envInstall) {
    return envInstall;
  }

  if (process.env.XTBPATH) {
    addCheck(process.env.XTBPATH);
  }

  const xtbOnPath = findExecutable(['xtb']);
  if (xtbOnPath) {
    const resolvedBinary = realpathSync(xtbOnPath);
    const pathCandidates = [
      path.dirname(path.dirname(resolvedBinary)),
      '/opt/homebrew',
      '/usr/local',
      process.env.CONDA_PREFIX,
      process.env.MAMBA_ROOT_PREFIX,
    ];
    for (const root of pathCandidates) {
      const install = fromRoot(root);
      if (install) {
        return install;
      }
    }
    if (process.env.XTBPATH && existsSync(process.env.XTBPATH)) {
      return { binary: resolvedBinary, shareDir: process.env.XTBPATH };
    }
  }

  throw new Error(
    `xtb ${XTB_VERSION} is required for macOS builds but was not found with share data. ` +
      `Install xtb via Homebrew or conda, or set CHEM_EDITOR_XTB_ROOT to an installation root containing bin/xtb and share/xtb. ` +
      `Checked: ${checked.join(', ') || 'PATH and default prefixes'}`,
  );
}

async function resolveOrProvisionXtb() {
  const staged = getStagedXtbPaths();
  if (existsSync(staged.xtbPath) && existsSync(staged.xtbShareDir)) {
    console.log('xtb bundle inputs present, skipping provisioning.');
    return staged;
  }

  if (process.platform === 'darwin') {
    console.log('Staging xtb from local macOS installation...');
    const install = findMacXtbInstall();
    const result = stageXtb(install.binary, install.shareDir);
    console.log(`xtb ${XTB_VERSION} staged from ${install.binary}`);
    return result;
  }

  if (!((process.platform === 'linux' || process.platform === 'win32') && process.arch === 'x64')) {
    throw new Error(`Bundled xtb is not supported on ${process.platform}/${process.arch}`);
  }

  ensureDir(xtbStageRoot);
  const asset = await resolveReleaseAsset();
  const archivePath = path.join(xtbStageRoot, asset.name);
  const extractDir = path.join(xtbStageRoot, `${process.platform}-${process.arch}`);
  rmSync(extractDir, { recursive: true, force: true });
  if (!existsSync(archivePath)) {
    console.log(`Downloading xtb ${XTB_VERSION} from ${asset.browser_download_url}`);
    await downloadFile(asset.browser_download_url, archivePath);
  } else {
    console.log(`Using cached xtb archive ${path.relative(repoRoot, archivePath)}`);
  }

  extractArchive(archivePath, extractDir);
  const binaryPath = findTreeEntry(
    extractDir,
    (fullPath, entry) =>
      entry.isFile() &&
      entry.name === `xtb${exeSuffix}` &&
      fullPath.split(path.sep).includes('bin'),
  );
  const shareDir = findTreeEntry(
    extractDir,
    (fullPath, entry) =>
      entry.isDirectory() && entry.name === 'xtb' && fullPath.split(path.sep).includes('share'),
  );
  if (!binaryPath || !shareDir) {
    throw new Error(
      `Extracted xtb archive did not contain the expected binary/share layout: ${asset.name}`,
    );
  }

  const result = stageXtb(binaryPath, shareDir);
  console.log(`xtb ${XTB_VERSION} ready at ${path.relative(repoRoot, result.xtbPath)}`);
  return result;
}

function syncPythonEnv(groups) {
  const commandArgs = ['sync', '--project', srcTauri];
  for (const group of groups) {
    commandArgs.push('--group', group);
  }
  console.log(`Syncing Python environment (${groups.join(', ')})...`);
  run(['uv', 'uv.exe'], commandArgs, { cwd: repoRoot, env: uvEnv, description: 'uv' });
}

async function maybeDownloadNmrShiftDbSdf() {
  if (existsSync(hoseSourcePath)) return;

  console.log('[sidecar] nmrshiftdb2withsignals.sd not found — downloading from NMRShiftDB2...');
  mkdirSync(path.dirname(hoseSourcePath), { recursive: true });

  const response = await fetch(NMR_SDF_URL, {
    headers: { 'User-Agent': 'chem-editor-build-sidecar' },
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(
      `Failed to download NMRShiftDB2 SDF: ${response.status} ${response.statusText}`,
    );
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  let received = 0;
  const file = createWriteStream(hoseSourcePath);

  for await (const chunk of response.body) {
    file.write(chunk);
    received += chunk.length;
    if (total) {
      process.stdout.write(
        `\r[sidecar] downloading NMRShiftDB2 SDF... ${((received / total) * 100).toFixed(1)}%`,
      );
    }
  }
  await new Promise((resolve, reject) => file.end((err) => (err ? reject(err) : resolve())));
  if (total) process.stdout.write('\n');
  console.log('[sidecar] NMRShiftDB2 SDF downloaded.');
}

function maybeBuildHoseDb() {
  const hoseDbPath = path.join(binDir, 'nmr_hose_db.sqlite');
  if (!existsSync(hoseSourcePath)) {
    console.log('HOSE training SDF not found, skipping nmr_hose_db.sqlite build.');
    return hoseDbPath;
  }

  console.log('Building nmr_hose_db.sqlite...');
  run(
    ['uv', 'uv.exe'],
    ['run', '--project', srcTauri, 'python', 'development/build_nmr_hose_db.py'],
    {
      cwd: repoRoot,
      env: uvEnv,
      description: 'uv',
    },
  );
  return hoseDbPath;
}

function isNewerThan(filePath, inputs) {
  if (!existsSync(filePath)) {
    return false;
  }
  const outputMtime = statSync(filePath).mtimeMs;
  return inputs.every((input) => !existsSync(input) || outputMtime >= statSync(input).mtimeMs);
}

function buildPyinstallerArgs(manifest) {
  const pyinstallerArgs = [
    'run',
    '--group',
    'build',
    'pyinstaller',
    '--onedir',
    '--noupx',
    'bin/chem-engine.py',
    '--noconfirm',
    '--exclude-module',
    '_tkinter',
    '--exclude-module',
    'tkinter',
    '--exclude-module',
    'tcl',
    '--exclude-module',
    'tk',
    '--exclude-module',
    'PIL',
    '--exclude-module',
    'PIL.Image',
    '--exclude-module',
    'PIL.ImageFile',
    '--exclude-module',
    'PIL.ImageOps',
    '--exclude-module',
    'PIL._avif',
    '--additional-hooks-dir',
    pyinstallerHooksDir,
  ];

  if (forceClean) {
    pyinstallerArgs.push('--clean');
  }

  for (const mod of [
    'pyscf',
    'pyscf.lib',
    'pyscf.gto',
    'pyscf.scf',
    'pyscf.dft',
    'pyscf.ao2mo',
    'pyscf.df',
    'pyscf.grad',
    'pyscf.prop',
    'pyscf.data',
    'pyscf.fci',
    'scipy',
  ]) {
    pyinstallerArgs.push('--collect-all', mod);
  }
  pyinstallerArgs.push('--exclude-module', 'pyscf.gto.basis.dyall-basis');

  for (const asset of manifest.requiredRuntimeAssets) {
    const assetPath = path.join(srcTauri, asset.source);
    if (!existsSync(assetPath)) {
      throw new Error(`Required sidecar asset missing: ${asset.source}`);
    }
    pyinstallerArgs.push(asset.kind === 'binary' ? '--add-binary' : '--add-data');
    pyinstallerArgs.push(`${asset.source}${pyinstallerPathSep}${asset.destination}`);
  }

  return pyinstallerArgs;
}

// On macOS, PyInstaller rewrites @loader_path/.dylibs/libX.dylib references in RDKit .so
// files to @rpath/libX.dylib, but only adds @loader_path/.. (or @loader_path/../..) as the
// sole rpath, pointing to _internal/.  The actual dylibs live in _internal/rdkit/.dylibs/,
// so each .so needs an additional rpath that resolves back to that directory.
// RDKit .so files live at multiple depths (rdkit/*.so, rdkit/Chem/*.so,
// rdkit/Chem/Draw/*.so, rdkit/ML/InfoTheory/*.so, …), so the relative prefix varies.
function fixRdkitDylibRpaths(sidecarPath) {
  const rdkitDir = path.join(sidecarPath, '_internal', 'rdkit');
  if (!existsSync(rdkitDir)) {
    return;
  }
  let patched = 0;

  function walkAndPatch(dir, depth) {
    // Rpath that resolves to _internal/rdkit/.dylibs/ from a .so at `depth` below rdkitDir.
    // depth=0 → @loader_path/.dylibs
    // depth=1 → @loader_path/../.dylibs
    // depth=2 → @loader_path/../../.dylibs
    const ups = depth === 0 ? '' : '../'.repeat(depth);
    const newRpath = `@loader_path/${ups}.dylibs`;

    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walkAndPatch(fullPath, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.so')) {
        continue;
      }
      const check = spawnSync('otool', ['-l', fullPath], { encoding: 'utf8' });
      if (check.stdout && check.stdout.includes(newRpath)) {
        continue;
      }
      const result = spawnSync('install_name_tool', ['-add_rpath', newRpath, fullPath], {
        encoding: 'utf8',
      });
      if (result.status !== 0 && !result.stderr?.includes('already exists')) {
        console.warn(
          `  Warning: could not patch rpath for ${entry.name}: ${result.stderr?.trim()}`,
        );
      } else {
        patched += 1;
      }
    }
  }

  walkAndPatch(rdkitDir, 0);
  if (patched > 0) {
    console.log(`Patched @loader_path/.dylibs rpath in ${patched} rdkit .so file(s).`);
  }
}

function collectMacSignTargets(sidecarPath) {
  const targets = [];

  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (
        entry.name === 'chem-engine' ||
        entry.name === `xtb${exeSuffix}` ||
        entry.name.endsWith('.so') ||
        entry.name.endsWith('.dylib')
      ) {
        targets.push(fullPath);
      }
    }
  }

  walk(sidecarPath);
  return targets.sort();
}

function resignMacSidecarBinaries(sidecarPath) {
  const signTargets = collectMacSignTargets(sidecarPath);
  let resigned = 0;
  for (const target of signTargets) {
    const result = spawnSync('codesign', ['--force', '--sign', '-', target], {
      encoding: 'utf8',
    });
    if (result.status !== 0) {
      throw new Error(
        `Failed to ad-hoc sign ${path.relative(sidecarPath, target)}: ${result.stderr?.trim() || result.stdout?.trim() || 'unknown codesign error'}`,
      );
    }
    resigned += 1;
  }
  if (resigned > 0) {
    console.log(`Ad-hoc signed ${resigned} macOS sidecar binary file(s).`);
  }
}

function repairMacSidecarBinaries(sidecarPath) {
  fixRdkitDylibRpaths(sidecarPath);
  resignMacSidecarBinaries(sidecarPath);
}

function validateBuiltSidecar(sidecarPath) {
  const forbiddenEntries = ['PIL', 'pillow.libs'];
  const internalDir = path.join(sidecarPath, '_internal');
  for (const entry of forbiddenEntries) {
    if (existsSync(path.join(internalDir, entry))) {
      throw new Error(`Built sidecar still contains forbidden payload: ${entry}`);
    }
  }

  const pyscfInitPath = path.join(internalDir, 'pyscf', '__init__.py');
  if (!existsSync(pyscfInitPath)) {
    throw new Error('Built sidecar is missing pyscf/__init__.py, so HF orbitals cannot load.');
  }

  const executablePath = path.join(sidecarPath, `chem-engine${exeSuffix}`);
  const orbitalSmokeInput = JSON.stringify({
    smiles: 'C',
    basis: '3-21G',
    isovalue: 0.045,
    atoms: [
      { element: 'C', x: 0.0, y: 0.0, z: 0.0 },
      { element: 'H', x: 0.6291, y: 0.6291, z: 0.6291 },
      { element: 'H', x: -0.6291, y: -0.6291, z: 0.6291 },
      { element: 'H', x: -0.6291, y: 0.6291, z: -0.6291 },
      { element: 'H', x: 0.6291, y: -0.6291, z: -0.6291 },
    ],
  });
  const orbitalSmoke = spawnSync(executablePath, ['orbitals'], {
    input: `${orbitalSmokeInput}\n`,
    encoding: 'utf8',
    timeout: 60000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (orbitalSmoke.error) {
    throw new Error(
      `Built sidecar orbital smoke test failed to launch: ${orbitalSmoke.error.message}`,
    );
  }
  if (orbitalSmoke.status !== 0) {
    throw new Error(
      `Built sidecar orbital smoke test failed (${orbitalSmoke.status}): ${orbitalSmoke.stderr || orbitalSmoke.stdout}`,
    );
  }
  let orbitalPayload;
  try {
    orbitalPayload = JSON.parse(orbitalSmoke.stdout);
  } catch (error) {
    throw new Error(
      `Built sidecar orbital smoke test returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (orbitalPayload?.error) {
    throw new Error(`Built sidecar orbital smoke test returned an error: ${orbitalPayload.error}`);
  }
  if (!Array.isArray(orbitalPayload?.orbitals) || orbitalPayload.orbitals.length === 0) {
    throw new Error('Built sidecar orbital smoke test returned no orbital metadata.');
  }

  const optimizeSmoke = spawnSync(executablePath, ['optimize-hf'], {
    input: `${orbitalSmokeInput}\n`,
    encoding: 'utf8',
    timeout: 90000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (optimizeSmoke.error) {
    throw new Error(
      `Built sidecar HF optimization smoke test failed to launch: ${optimizeSmoke.error.message}`,
    );
  }
  if (optimizeSmoke.status !== 0) {
    throw new Error(
      `Built sidecar HF optimization smoke test failed (${optimizeSmoke.status}): ${optimizeSmoke.stderr || optimizeSmoke.stdout}`,
    );
  }
  let optimizePayload;
  try {
    optimizePayload = JSON.parse(optimizeSmoke.stdout);
  } catch (error) {
    throw new Error(
      `Built sidecar HF optimization smoke test returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (optimizePayload?.error) {
    throw new Error(
      `Built sidecar HF optimization smoke test returned an error: ${optimizePayload.error}`,
    );
  }
  if (!Array.isArray(optimizePayload?.atoms) || optimizePayload.atoms.length === 0) {
    throw new Error('Built sidecar HF optimization smoke test returned no optimized atoms.');
  }
}

async function main() {
  console.log(prepareOnly ? 'Preparing Python sidecar...' : 'Building Python sidecar...');
  ensureDir(binDir);
  ensureDir(cacheDir);
  assertRequiredTooling();

  const stamp = readStamp();
  const triple = inferHostTriple();
  const manifest = createSidecarManifest();
  const sidecarPath = path.join(binDir, `chem-engine-${triple}`);
  const venvPath = path.join(srcTauri, '.venv');

  const pythonSources = collectFiles(pythonSourceDir, (filePath) => filePath.endsWith('.py'));
  const envFingerprint = buildFingerprint([pyprojectPath, uvLockPath]);
  validateTauriBundleResources(manifest.bundledResources);

  await maybeDownloadNmrShiftDbSdf();

  const hoseFingerprint = buildFingerprint([hoseSourcePath, hoseBuilderPath]);

  const { xtbPath, xtbShareDir } = await resolveOrProvisionXtb();
  const runtimeFingerprint = buildFingerprint([
    path.join(srcTauri, 'build-sidecar.js'),
    pyinstallerHooksDir,
    nmrRefsPath,
    xtbPath,
    xtbShareDir,
  ]);

  const shouldSyncEnv =
    forceClean || !existsSync(venvPath) || stamp.envFingerprint !== envFingerprint;
  if (shouldSyncEnv) {
    syncPythonEnv(['build', 'nmr-dft']);
  } else {
    console.log('Python environment is up to date, skipping uv sync.');
  }

  const nextStamp = {
    ...stamp,
    envFingerprint,
  };

  if (existsSync(hoseSourcePath)) {
    const hoseDbPath = path.join(binDir, 'nmr_hose_db.sqlite');
    const canReuseExistingDb =
      !forceClean &&
      existsSync(hoseDbPath) &&
      (stamp.hoseFingerprint === hoseFingerprint ||
        isNewerThan(hoseDbPath, [hoseSourcePath, hoseBuilderPath]));
    const shouldBuildDb = !canReuseExistingDb;
    if (shouldBuildDb) {
      maybeBuildHoseDb();
    } else {
      console.log('HOSE database is up to date, skipping rebuild.');
    }
    nextStamp.hoseFingerprint = hoseFingerprint;
  } else {
    delete nextStamp.hoseFingerprint;
  }

  if (prepareOnly) {
    writeStamp(nextStamp);
    return;
  }

  const pyinstallerFingerprint = hashPayload({
    triple,
    manifest,
    python: pythonSources.map((filePath) => statSignature(filePath)),
    envFingerprint,
    runtimeFingerprint,
    hoseDb: statSignature(path.join(binDir, 'nmr_hose_db.sqlite')),
    venv: statSignature(venvPath),
  });

  const sidecarInputs = [
    path.join(srcTauri, 'build-sidecar.js'),
    pyinstallerHooksDir,
    pyprojectPath,
    uvLockPath,
    ...pythonSources,
    nmrRefsPath,
    path.join(binDir, 'nmr_hose_db.sqlite'),
    xtbPath,
    xtbShareDir,
    venvPath,
  ];
  const canReuseExistingSidecar =
    !forceClean &&
    existsSync(sidecarPath) &&
    (stamp.pyinstallerFingerprint === pyinstallerFingerprint ||
      isNewerThan(sidecarPath, sidecarInputs));
  const shouldBuildSidecar = !canReuseExistingSidecar;
  if (!shouldBuildSidecar) {
    console.log('Sidecar is up to date, skipping PyInstaller.');
    if (process.platform === 'darwin') {
      repairMacSidecarBinaries(sidecarPath);
    }
    writeStamp({
      ...nextStamp,
      pyinstallerFingerprint,
    });
    return;
  }

  console.log(
    existsSync(sidecarPath)
      ? 'Dependencies changed, rebuilding sidecar...'
      : 'Building sidecar executable...',
  );
  const pyinstallerArgs = buildPyinstallerArgs(manifest);
  run(['uv', 'uv.exe'], pyinstallerArgs, { cwd: srcTauri, env: uvEnv, description: 'uv' });

  const builtDir = path.join(srcTauri, 'dist', 'chem-engine');
  if (!existsSync(builtDir)) {
    throw new Error(`Sidecar directory not found at ${builtDir}`);
  }

  if (existsSync(sidecarPath)) {
    rmSync(sidecarPath, { recursive: true, force: true });
  }
  cpSync(builtDir, sidecarPath, { recursive: true });
  if (process.platform === 'darwin') {
    repairMacSidecarBinaries(sidecarPath);
  }
  validateBuiltSidecar(sidecarPath);
  console.log(`Sidecar built: ${path.relative(repoRoot, sidecarPath)}`);

  writeStamp({
    ...nextStamp,
    pyinstallerFingerprint,
  });
}

try {
  await main();
} catch (error) {
  console.error('Build error:', error instanceof Error ? error.message : String(error));
  process.exit(1);
}
