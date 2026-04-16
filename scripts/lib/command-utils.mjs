import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

function pathEntries() {
  const rawPath = process.env.PATH ?? '';
  return rawPath.split(path.delimiter).filter(Boolean);
}

function windowsExtensions() {
  if (process.platform !== 'win32') {
    return [''];
  }
  const pathext = (process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  return ['', ...pathext];
}

export function findExecutable(names) {
  const candidates = Array.isArray(names) ? names : [names];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (path.isAbsolute(candidate)) {
      if (existsSync(candidate)) {
        return candidate;
      }
      continue;
    }
    for (const dir of pathEntries()) {
      for (const ext of windowsExtensions()) {
        const fullPath = path.join(
          dir,
          process.platform === 'win32' ? `${candidate}${ext}` : candidate,
        );
        if (existsSync(fullPath)) {
          return fullPath;
        }
      }
    }
  }
  return null;
}

export function requireExecutable(names, description) {
  const resolved = findExecutable(names);
  if (!resolved) {
    const display = Array.isArray(names) ? names.join(', ') : names;
    throw new Error(`${description} not found on PATH (looked for: ${display})`);
  }
  return resolved;
}

export function run(commandNames, args, options = {}) {
  const command = requireExecutable(commandNames, options.description ?? 'Required command');
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: options.captureOutput ? 'pipe' : 'inherit',
    encoding: options.captureOutput ? 'utf8' : undefined,
  });

  if (result.error) {
    throw result.error;
  }
  if ((result.status ?? 1) !== 0) {
    const rendered = [path.basename(command), ...args].join(' ');
    const stderr = options.captureOutput ? result.stderr?.trim() : '';
    throw new Error(
      stderr ? `${rendered}\n${stderr}` : `${rendered} exited with code ${result.status}`,
    );
  }

  return options.captureOutput ? result.stdout.trim() : '';
}
