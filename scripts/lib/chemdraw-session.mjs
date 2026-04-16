import { spawnSync } from 'node:child_process';

function isAppleEventTimeout(stderr = '') {
  return /AppleEvent timed out/i.test(stderr) || /\(-1712\)/.test(stderr);
}

function isTransientReferenceError(error) {
  if (!(error instanceof ChemDrawSessionError)) return false;
  return (
    /\(-10827\)/.test(error.stderr) ||
    /\(-1728\)/.test(error.stderr) ||
    /Connection Invalid error/i.test(error.stderr) ||
    /Can’t get application/i.test(error.stderr)
  );
}

function blockingSleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function wrapAppleScript(scriptLines, { usesArgv = false, appleEventTimeoutSeconds }) {
  const timeoutLines = [
    `with timeout of ${appleEventTimeoutSeconds} seconds`,
    ...scriptLines,
    'end timeout',
  ];

  if (!usesArgv) return timeoutLines;
  return ['on run argv', ...timeoutLines.map((line) => `  ${line}`), 'end run'];
}

export class ChemDrawSessionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ChemDrawSessionError';
    this.stage = details.stage ?? 'unknown';
    this.stdout = details.stdout ?? '';
    this.stderr = details.stderr ?? '';
    this.script = details.script ?? '';
    this.timedOut = details.timedOut ?? false;
  }
}

function runAppleScript(scriptLines, args, options) {
  const script = scriptLines.join('\n');
  const result = spawnSync(
    options.osascriptPath,
    [...scriptLines.flatMap((line) => ['-e', line]), ...args],
    {
      encoding: 'utf8',
      timeout: options.timeoutMs,
    },
  );

  const stdout = result.stdout ?? '';
  const stderr = result.stderr ?? result.error?.message ?? '';
  const timedOut = result.error?.code === 'ETIMEDOUT' || isAppleEventTimeout(stderr);

  if (result.error) {
    throw new ChemDrawSessionError(
      timedOut ? `ChemDraw ${options.stage} timed out` : `ChemDraw ${options.stage} failed`,
      {
        stage: options.stage,
        stdout,
        stderr,
        script,
        timedOut,
      },
    );
  }

  if (result.status !== 0) {
    throw new ChemDrawSessionError(
      timedOut ? `ChemDraw ${options.stage} timed out` : `ChemDraw ${options.stage} failed`,
      {
        stage: options.stage,
        stdout,
        stderr,
        script,
        timedOut,
      },
    );
  }

  return stdout.trim();
}

function asAppleScriptString(value) {
  return JSON.stringify(value);
}

function parseDocumentCount(rawCount, stage) {
  const count = Number.parseInt(rawCount, 10);
  if (!Number.isFinite(count)) {
    throw new ChemDrawSessionError(`ChemDraw ${stage} returned a non-numeric document count`, {
      stage,
      stdout: rawCount,
    });
  }
  return count;
}

function resolveInstalledChemDrawAppPath() {
  const result = spawnSync(
    '/usr/bin/find',
    ['/Applications', '-maxdepth', '2', '-iname', '*ChemDraw*.app'],
    {
      encoding: 'utf8',
    },
  );
  if (result.error || result.status !== 0) return null;
  return (result.stdout ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean);
}

export function createChemDrawSession(config = {}) {
  const appId = config.appId ?? 'com.revvity.ChemDraw';
  const osascriptPath = config.osascriptPath ?? '/usr/bin/osascript';
  const openPath = config.openPath ?? '/usr/bin/open';
  const appPath = config.appPath ?? resolveInstalledChemDrawAppPath();
  const documentOpenPolls = config.documentOpenPolls ?? 600;
  const launchTimeoutMs = config.launchTimeoutMs ?? 30000;
  const commandTimeoutMs = config.commandTimeoutMs ?? 15000;
  const openWaitTimeoutMs =
    config.openWaitTimeoutMs ?? Math.max(commandTimeoutMs, documentOpenPolls * 200 + 10000);
  const saveTimeoutMs = config.saveTimeoutMs ?? 60000;
  const pdfTimeoutMs = config.pdfTimeoutMs ?? 180000;
  const showWindows = config.showWindows ?? false;
  const bundleIdAppRef = `application id ${asAppleScriptString(appId)}`;
  const pathAppRef = appPath ? `application ${asAppleScriptString(appPath)}` : null;
  let activeAppRef = pathAppRef ?? bundleIdAppRef;

  const execute = (
    stage,
    scriptLines,
    args = [],
    {
      timeoutMs = commandTimeoutMs,
      appleEventTimeoutSeconds = Math.max(30, Math.ceil(timeoutMs / 1000)),
    } = {},
  ) =>
    runAppleScript(
      wrapAppleScript(scriptLines, {
        usesArgv: args.length > 0,
        appleEventTimeoutSeconds,
      }),
      args,
      {
        stage,
        osascriptPath,
        timeoutMs,
      },
    );

  const withTransientRetry = (action, { maxAttempts = 3, retryDelayMs = 1500 } = {}) => {
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return action();
      } catch (error) {
        lastError = error;
        if (!isTransientReferenceError(error) || attempt >= maxAttempts) throw error;
        blockingSleepMs(retryDelayMs * attempt);
      }
    }
    throw lastError;
  };

  const countDocuments = () =>
    withTransientRetry(() =>
      parseDocumentCount(
        execute('count-documents', [
          `tell ${activeAppRef}`,
          '  return (count of documents) as text',
          'end tell',
        ]),
        'count-documents',
      ),
    );

  const closeAllDocumentsNoSave = () => {
    withTransientRetry(() =>
      execute('close-documents', [
        `tell ${activeAppRef}`,
        '  if (count of documents) > 0 then',
        '    close every document saving no',
        '  end if',
        '  return (count of documents) as text',
        'end tell',
      ]),
    );
  };

  const ensureCleanState = () => {
    const beforeCount = countDocuments();
    if (beforeCount > 0) closeAllDocumentsNoSave();
    const afterCount = countDocuments();
    if (afterCount !== 0) {
      throw new ChemDrawSessionError(
        `Expected ChemDraw to have 0 open documents, found ${afterCount}`,
        {
          stage: 'ensure-clean-state',
          stdout: `${afterCount}`,
        },
      );
    }
    return afterCount;
  };

  const launchViaOpen = () => {
    const result = spawnSync(
      openPath,
      [...(showWindows ? [] : ['-g']), ...(appPath ? ['-a', appPath] : ['-b', appId])],
      {
        encoding: 'utf8',
        timeout: launchTimeoutMs,
      },
    );
    const stdout = result.stdout ?? '';
    const stderr = result.stderr ?? result.error?.message ?? '';
    const timedOut = result.error?.code === 'ETIMEDOUT';
    if (result.error || result.status !== 0) {
      throw new ChemDrawSessionError(
        timedOut ? 'ChemDraw launch timed out' : 'ChemDraw launch failed',
        {
          stage: 'launch',
          stdout,
          stderr,
          timedOut,
        },
      );
    }
  };

  const launchWithReference = (reference, includeLaunch = true) => {
    const version = withTransientRetry(() =>
      execute(
        'launch',
        [
          `tell ${reference}`,
          ...(includeLaunch && reference !== pathAppRef ? ['  launch'] : []),
          ...(showWindows ? ['  activate'] : []),
          '  delay 2',
          '  return version as text',
          'end tell',
        ],
        [],
        { timeoutMs: launchTimeoutMs },
      ),
    );
    activeAppRef = reference;
    return version;
  };

  const ensureLaunched = () => {
    try {
      return launchWithReference(activeAppRef, true);
    } catch (primaryError) {
      if (!(primaryError instanceof ChemDrawSessionError) || primaryError.stage !== 'launch') {
        throw primaryError;
      }

      const alternateAppRef = activeAppRef === bundleIdAppRef ? pathAppRef : bundleIdAppRef;
      if (alternateAppRef && alternateAppRef !== activeAppRef) {
        try {
          return launchWithReference(alternateAppRef, true);
        } catch {
          // Fall through to the open(1) fallback below.
        }
      }

      launchViaOpen();
      return launchWithReference(activeAppRef, false);
    }
  };

  const getVersion = () =>
    execute('version', [`tell ${activeAppRef}`, '  return version as text', 'end tell'], [], {
      timeoutMs: commandTimeoutMs,
    });

  const openDocument = (inputPath) =>
    execute(
      'open-document',
      [
        'set inputPath to POSIX file (item 1 of argv)',
        `tell ${activeAppRef}`,
        ...(showWindows ? ['  activate'] : []),
        '  open inputPath',
        '  return (count of documents) as text',
        'end tell',
      ],
      [inputPath],
      { timeoutMs: commandTimeoutMs },
    );

  const waitForDocumentCount = (expectedCount = 1) => {
    const output = execute(
      'wait-for-document-count',
      [
        `set targetCount to ${(expectedCount | 0).toString()}`,
        `set maxPolls to ${(documentOpenPolls | 0).toString()}`,
        `tell ${activeAppRef}`,
        '  repeat with pollIndex from 1 to maxPolls',
        '    if (count of documents) is targetCount then return (count of documents) as text',
        '    delay 0.2',
        '  end repeat',
        '  return (count of documents) as text',
        'end tell',
      ],
      [],
      { timeoutMs: openWaitTimeoutMs },
    );

    const count = parseDocumentCount(output, 'wait-for-document-count');
    if (count !== expectedCount) {
      throw new ChemDrawSessionError(
        `Timed out waiting for ChemDraw to reach ${expectedCount} open document(s); found ${count}`,
        {
          stage: 'wait-for-document-count',
          stdout: output,
          timedOut: true,
        },
      );
    }
    return count;
  };

  const saveCdxml = (outputPath) =>
    execute(
      'save-cdxml',
      [
        'set outputPath to POSIX file (item 1 of argv)',
        `tell ${activeAppRef}`,
        '  if (count of documents) is 0 then error "No open ChemDraw document to save as CDXML"',
        '  save document 1 in outputPath as "ChemDraw XML"',
        '  return (count of documents) as text',
        'end tell',
      ],
      [outputPath],
      { timeoutMs: saveTimeoutMs },
    );

  const savePdf = (outputPath) =>
    execute(
      'save-pdf',
      [
        'set outputPath to POSIX file (item 1 of argv)',
        `tell ${activeAppRef}`,
        '  if (count of documents) is 0 then error "No open ChemDraw document to save as PDF"',
        '  save document 1 in outputPath as "PDF"',
        '  return (count of documents) as text',
        'end tell',
      ],
      [outputPath],
      { timeoutMs: pdfTimeoutMs },
    );

  const closeDocument = () =>
    execute(
      'close-document',
      [
        `tell ${activeAppRef}`,
        '  if (count of documents) is 0 then error "No open ChemDraw document to close"',
        '  close document 1 saving no',
        '  return (count of documents) as text',
        'end tell',
      ],
      [],
      { timeoutMs: commandTimeoutMs },
    );

  const quit = () => {
    try {
      execute('quit', [`tell ${activeAppRef}`, '  quit saving no', 'end tell'], [], {
        timeoutMs: commandTimeoutMs,
      });
    } catch (error) {
      if (error instanceof ChemDrawSessionError) return;
      throw error;
    }
  };

  const recoverSession = () => {
    quit();
    const version = ensureLaunched();
    ensureCleanState();
    return version;
  };

  return {
    closeDocument,
    countDocuments,
    ensureCleanState,
    ensureLaunched,
    getVersion,
    openDocument,
    quit,
    recoverSession,
    saveCdxml,
    savePdf,
    waitForDocumentCount,
  };
}
