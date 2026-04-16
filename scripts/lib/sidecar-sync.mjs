import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';

const SIDECAR_DIR_PREFIX = 'chem-engine-';
const REMOVE_OPTIONS = {
  recursive: true,
  force: true,
  maxRetries: 5,
  retryDelay: 100,
};
const COPY_OPTIONS = {
  recursive: true,
  force: true,
  errorOnExist: false,
};

function removeSidecarPath(targetPath) {
  rmSync(targetPath, REMOVE_OPTIONS);
}

export function listBuiltSidecarDirs(sourceBinDir) {
  if (!existsSync(sourceBinDir)) {
    throw new Error(`Sidecar source directory does not exist: ${sourceBinDir}`);
  }

  return readdirSync(sourceBinDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(SIDECAR_DIR_PREFIX))
    .map((entry) => entry.name)
    .sort();
}

export function pruneGeneratedSidecars(targetBinDir) {
  if (!existsSync(targetBinDir)) {
    return;
  }

  for (const entry of readdirSync(targetBinDir, { withFileTypes: true })) {
    if (!entry.name.startsWith(SIDECAR_DIR_PREFIX)) {
      continue;
    }
    removeSidecarPath(path.join(targetBinDir, entry.name));
  }
}

export function syncBuiltSidecars(options) {
  const sidecarDirs = listBuiltSidecarDirs(options.sourceBinDir);
  if (sidecarDirs.length === 0) {
    throw new Error(`No built sidecar directories found in ${options.sourceBinDir}`);
  }

  for (const targetBinDir of options.targetBinDirs) {
    mkdirSync(targetBinDir, { recursive: true });
    pruneGeneratedSidecars(targetBinDir);
    for (const sidecarDir of sidecarDirs) {
      const sourcePath = path.join(options.sourceBinDir, sidecarDir);
      const targetPath = path.join(targetBinDir, sidecarDir);
      removeSidecarPath(targetPath);
      cpSync(sourcePath, targetPath, COPY_OPTIONS);
    }
  }
}
