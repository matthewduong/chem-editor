import { constants as fsConstants } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { JSDOM } from 'jsdom';

import { buildUnitTestDist } from './lib/unit-test-build.mjs';
import {
  buildCompatibilitySummary,
  classifyFailure,
  formatCompatibilityDiff,
  runCaseWithRetry,
  sanitizeCaseId,
} from './lib/chemdraw-harness.mjs';
import { createChemDrawSession } from './lib/chemdraw-session.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = process.argv[2] === 'full' ? 'full' : 'smoke';
const corpusRootEnv = process.env.CHEMDRAW_CORPUS_ROOT ?? process.env.CHEMDRAW_THESIS_ROOT ?? null;
const corpusRoot = corpusRootEnv ? path.resolve(corpusRootEnv) : null;
const appId = process.env.CHEMDRAW_APP_ID ?? 'com.revvity.ChemDraw';
const artifactRoot = path.resolve(
  rootDir,
  process.env.CHEMDRAW_ARTIFACT_DIR ?? '.chemdraw-test-artifacts',
);
const showWindows =
  /^(1|true|yes|on)$/i.test(process.env.CHEMDRAW_SHOW_WINDOWS ?? '') ||
  /^(1|true|yes|on)$/i.test(process.env.CHEMDRAW_VISIBLE ?? '');
const smokeManifestPath = process.env.CHEMDRAW_SMOKE_MANIFEST
  ? path.resolve(rootDir, process.env.CHEMDRAW_SMOKE_MANIFEST)
  : null;
const smokeCaseLimit = Number.parseInt(process.env.CHEMDRAW_SMOKE_LIMIT ?? '12', 10);
const xmlLintPath = '/usr/bin/xmllint';
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const visualDiffThreshold = Number.parseFloat(
  process.env.CHEMDRAW_VISUAL_DIFF_THRESHOLD ?? '0.0025',
);
const enforceVisualDiff = /^(1|true|yes|on)$/i.test(process.env.CHEMDRAW_ENFORCE_VISUAL_DIFF ?? '');
const captureVisualBaseline = /^(1|true|yes|on)$/i.test(
  process.env.CHEMDRAW_CAPTURE_VISUAL_BASELINE ?? '',
);
const visualCaptureRequested = captureVisualBaseline || enforceVisualDiff;
const enforcedVisualSmokeCases = new Set(
  (process.env.CHEMDRAW_ENFORCED_VISUAL_CASES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),
);

if (!Number.isInteger(smokeCaseLimit) || smokeCaseLimit <= 0) {
  fail(`CHEMDRAW_SMOKE_LIMIT must be a positive integer, got ${process.env.CHEMDRAW_SMOKE_LIMIT}`);
}

function ensureDomParserGlobals() {
  if (typeof globalThis.DOMParser === 'function') return;
  const { window } = new JSDOM('');
  globalThis.DOMParser = window.DOMParser;
  globalThis.XMLSerializer = window.XMLSerializer;
}

function fail(message) {
  console.error(`ChemDraw harness error: ${message}`);
  process.exit(1);
}

function findCommandPath(command) {
  const result = spawnSync('which', [command], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const resolved = (result.stdout ?? '').trim().split('\n')[0];
  return resolved || null;
}

async function ensurePathExists(targetPath, description) {
  try {
    await access(targetPath, fsConstants.F_OK);
  } catch {
    fail(`${description} not found at ${targetPath}`);
  }
}

async function discoverCdxmlFiles(rootPath) {
  const entries = await readdir(rootPath, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await discoverCdxmlFiles(absolutePath)));
      continue;
    }
    if (entry.isFile() && entry.name.toLowerCase().endsWith('.cdxml')) {
      files.push(absolutePath);
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function loadSmokeCases(rootPath) {
  if (smokeManifestPath) {
    const manifest = JSON.parse(await readFile(smokeManifestPath, 'utf8'));
    if (!Array.isArray(manifest) || manifest.length === 0) {
      fail(
        `Smoke manifest at ${smokeManifestPath} must contain a non-empty array of relative paths`,
      );
    }

    const cases = [];
    for (const relativePath of manifest) {
      const absolutePath = path.join(rootPath, relativePath);
      await ensurePathExists(absolutePath, `Smoke fixture ${relativePath}`);
      cases.push({ absolutePath, relativePath });
    }
    return cases;
  }

  const allFiles = await discoverCdxmlFiles(rootPath);
  if (allFiles.length === 0) fail(`No .cdxml files were found under ${rootPath}`);

  const selectedFiles = allFiles.slice(0, smokeCaseLimit);
  const cases = [];
  for (const absolutePath of selectedFiles) {
    cases.push({
      absolutePath,
      relativePath: path.relative(rootPath, absolutePath),
    });
  }
  return cases;
}

async function loadCases(rootPath) {
  if (mode === 'smoke') return loadSmokeCases(rootPath);
  const allFiles = await discoverCdxmlFiles(rootPath);
  if (allFiles.length === 0) fail(`No .cdxml files were found under ${rootPath}`);
  return allFiles.map((absolutePath) => ({
    absolutePath,
    relativePath: path.relative(rootPath, absolutePath),
  }));
}

function validateXml(filePath, label) {
  const result = spawnSync(xmlLintPath, ['--noout', filePath], {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    const stderr = result.error?.message ?? result.stderr ?? '';
    throw new Error(`${label}: xmllint rejected output\n${stderr.trim()}`);
  }
}

function runCommand(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
  });
  if (result.error || result.status !== 0) {
    const stderr = result.error?.message ?? result.stderr ?? '';
    throw new Error(`${label} failed\n${stderr.trim()}`);
  }
  return (result.stdout ?? '').trim();
}

async function assertNonEmptyFile(filePath, label) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile() || fileStat.size === 0) {
    throw new Error(`${label}: expected a non-empty file at ${filePath}`);
  }
}

async function copyIfExists(sourcePath, destinationPath) {
  try {
    await access(sourcePath, fsConstants.F_OK);
  } catch {
    return;
  }
  await copyFile(sourcePath, destinationPath);
}

async function fileExists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function parsePngDimensions(output, label) {
  const [widthText, heightText] = output.trim().split(/\s+/);
  const width = Number.parseInt(widthText, 10);
  const height = Number.parseInt(heightText, 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`${label}: could not determine raster dimensions`);
  }
  return { width, height };
}

function sanitizeSvgForRasterization(svg) {
  return svg.replace(/\sfont-family=""/g, ' font-family="Helvetica"');
}

function serializeError(error) {
  if (!(error instanceof Error)) {
    return {
      name: 'UnknownError',
      message: String(error),
    };
  }

  return {
    name: error.name,
    message: error.message,
    stack: error.stack ?? '',
    ...(typeof error.stage === 'string' ? { stage: error.stage } : {}),
    ...(typeof error.stdout === 'string' && error.stdout ? { stdout: error.stdout } : {}),
    ...(typeof error.stderr === 'string' && error.stderr ? { stderr: error.stderr } : {}),
    ...(typeof error.script === 'string' && error.script ? { script: error.script } : {}),
    ...(typeof error.timedOut === 'boolean' ? { timedOut: error.timedOut } : {}),
  };
}

function markErrorStage(error, stage) {
  if (error instanceof Error && typeof stage === 'string' && typeof error.stage !== 'string') {
    error.stage = stage;
  }
  return error;
}

async function recordTimedStep(stepTimings, step, stage, fn) {
  const startedAt = Date.now();
  try {
    const value = await fn();
    stepTimings[step] = {
      ok: true,
      stage,
      durationMs: Date.now() - startedAt,
    };
    return value;
  } catch (error) {
    markErrorStage(error, stage);
    stepTimings[step] = {
      ok: false,
      stage,
      durationMs: Date.now() - startedAt,
      timedOut: Boolean(error?.timedOut),
      message: error instanceof Error ? error.message : String(error),
    };
    throw error;
  }
}

async function rasterizeSvgToPng({ rsvgConvertPath, svgPath, pngPath }) {
  runCommand(
    rsvgConvertPath,
    ['--format', 'png', '--background-color', 'white', '--zoom', '4', '--output', pngPath, svgPath],
    'ChemEditor SVG rasterization',
  );
  await assertNonEmptyFile(pngPath, 'chem-editor-render');
}

async function rasterizePdfToPng({ pdftoppmPath, pdfPath, pngPath, scratchDir }) {
  const prefix = path.join(scratchDir, 'chemdraw-render');
  runCommand(
    pdftoppmPath,
    ['-png', '-singlefile', '-r', '288', pdfPath, prefix],
    'ChemDraw PDF rasterization',
  );
  const renderedPath = `${prefix}.png`;
  await assertNonEmptyFile(renderedPath, 'chemdraw-render');
  await copyFile(renderedPath, pngPath);
}

async function compareVisualRenders({
  magickPath,
  comparePath,
  chemEditorPngPath,
  chemdrawPngPath,
  overlayPath,
  diffPath,
  scratchDir,
}) {
  const editorSize = parsePngDimensions(
    runCommand(
      magickPath,
      ['identify', '-format', '%w %h', chemEditorPngPath],
      'Identify ChemEditor render',
    ),
    'ChemEditor render',
  );
  const chemdrawSize = parsePngDimensions(
    runCommand(
      magickPath,
      ['identify', '-format', '%w %h', chemdrawPngPath],
      'Identify ChemDraw render',
    ),
    'ChemDraw render',
  );
  const width = Math.max(editorSize.width, chemdrawSize.width);
  const height = Math.max(editorSize.height, chemdrawSize.height);
  const normalizedEditorPath = path.join(scratchDir, 'chem-editor-normalized.png');
  const normalizedChemDrawPath = path.join(scratchDir, 'chemdraw-normalized.png');

  runCommand(
    magickPath,
    [
      chemEditorPngPath,
      '-background',
      'white',
      '-gravity',
      'northwest',
      '-extent',
      `${width}x${height}`,
      normalizedEditorPath,
    ],
    'Normalize ChemEditor render',
  );
  runCommand(
    magickPath,
    [
      chemdrawPngPath,
      '-background',
      'white',
      '-gravity',
      'northwest',
      '-extent',
      `${width}x${height}`,
      normalizedChemDrawPath,
    ],
    'Normalize ChemDraw render',
  );
  runCommand(
    magickPath,
    [
      normalizedEditorPath,
      normalizedChemDrawPath,
      '-define',
      'compose:args=50,50',
      '-compose',
      'blend',
      '-composite',
      overlayPath,
    ],
    'Generate blended overlay',
  );

  const compareResult = spawnSync(
    comparePath,
    ['-metric', 'AE', normalizedEditorPath, normalizedChemDrawPath, diffPath],
    { encoding: 'utf8' },
  );
  if (![0, 1].includes(compareResult.status ?? 0) && !compareResult.error) {
    throw new Error(`Visual diff comparison failed\n${(compareResult.stderr ?? '').trim()}`);
  }
  if (compareResult.error) {
    throw new Error(
      `Visual diff comparison failed\n${compareResult.error.message ?? compareResult.stderr ?? ''}`,
    );
  }
  const diffPixels = Number.parseInt(
    (compareResult.stderr ?? compareResult.stdout ?? '0').trim(),
    10,
  );
  if (!Number.isFinite(diffPixels)) {
    throw new Error('Visual diff comparison did not return a numeric pixel count');
  }

  return {
    width,
    height,
    diffPixels,
    diffRatio: width * height > 0 ? diffPixels / (width * height) : 0,
  };
}

async function writeAttemptArtifacts({
  caseInfo,
  caseId,
  attempt,
  runMode,
  appVersion,
  failureClassification,
  originalSourcePath,
  generatedInputPath,
  chemdrawOutputPath,
  chemdrawPdfPath,
  chemEditorSvgPath,
  chemEditorPngPath,
  chemdrawPngPath,
  overlayPath,
  diffImagePath,
  beforeSummary,
  beforeWarnings,
  afterSummary,
  afterWarnings,
  visualMetrics,
  stepTimings,
  visualConfig,
  durationMs,
  error,
}) {
  const artifactDir = path.join(artifactRoot, runId, caseId, `attempt-${attempt}`);
  await mkdir(artifactDir, { recursive: true });

  await copyIfExists(originalSourcePath, path.join(artifactDir, 'original-source.cdxml'));
  if (generatedInputPath) {
    await copyIfExists(generatedInputPath, path.join(artifactDir, 'chem-editor-input.cdxml'));
  }
  if (chemdrawOutputPath) {
    await copyIfExists(chemdrawOutputPath, path.join(artifactDir, 'chemdraw-output.cdxml'));
  }
  if (chemdrawPdfPath) {
    await copyIfExists(chemdrawPdfPath, path.join(artifactDir, 'chemdraw-render.pdf'));
  }
  if (chemEditorSvgPath) {
    await copyIfExists(chemEditorSvgPath, path.join(artifactDir, 'chem-editor-render.svg'));
  }
  if (chemEditorPngPath) {
    await copyIfExists(chemEditorPngPath, path.join(artifactDir, 'chem-editor-render.png'));
  }
  if (chemdrawPngPath) {
    await copyIfExists(chemdrawPngPath, path.join(artifactDir, 'chemdraw-render.png'));
  }
  if (overlayPath) {
    await copyIfExists(overlayPath, path.join(artifactDir, 'overlay.png'));
  }
  if (diffImagePath) {
    await copyIfExists(diffImagePath, path.join(artifactDir, 'diff.png'));
  }

  await writeFile(
    path.join(artifactDir, 'before-summary.json'),
    JSON.stringify(
      {
        warnings: beforeWarnings ?? [],
        summary: beforeSummary ?? null,
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(artifactDir, 'after-summary.json'),
    JSON.stringify(
      {
        warnings: afterWarnings ?? [],
        summary: afterSummary ?? null,
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(artifactDir, 'diff.txt'),
    beforeSummary && afterSummary
      ? `${formatCompatibilityDiff(beforeSummary, afterSummary)}\n`
      : 'No compatibility diff available.\n',
  );
  await writeFile(
    path.join(artifactDir, 'session.json'),
    JSON.stringify(
      {
        runId,
        mode: runMode,
        caseId,
        relativePath: caseInfo.relativePath,
        attempt,
        appVersion,
        durationMs,
        failureClassification,
        stepTimings,
        visual: {
          ...(visualConfig ?? {}),
          metrics: visualMetrics ?? null,
        },
        error: serializeError(error),
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(artifactDir, 'fidelity-result.json'),
    JSON.stringify(
      {
        caseId,
        relativePath: caseInfo.relativePath,
        sourcePaths: {
          originalSource: originalSourcePath ?? null,
          chemEditorInput: generatedInputPath ?? null,
          chemdrawOutput: chemdrawOutputPath ?? null,
          chemdrawPdf: chemdrawPdfPath ?? null,
          chemEditorSvg: chemEditorSvgPath ?? null,
          chemEditorPng: chemEditorPngPath ?? null,
          chemdrawPng: chemdrawPngPath ?? null,
          overlay: overlayPath ?? null,
          diff: diffImagePath ?? null,
        },
        semantic: {
          beforeWarnings: beforeWarnings ?? [],
          afterWarnings: afterWarnings ?? [],
          beforeSummary: beforeSummary ?? null,
          afterSummary: afterSummary ?? null,
          diff:
            beforeSummary && afterSummary
              ? formatCompatibilityDiff(beforeSummary, afterSummary)
              : null,
        },
        failureClassification,
        stepTimings,
        visual: {
          ...(visualConfig ?? {}),
          metrics: visualMetrics ?? null,
        },
      },
      null,
      2,
    ),
  );

  const serialized = serializeError(error);
  if (serialized.stderr) {
    await writeFile(path.join(artifactDir, 'applescript-error.txt'), `${serialized.stderr}\n`);
  }

  return artifactDir;
}

async function main() {
  if (process.platform !== 'darwin') fail('ChemDraw compatibility tests only run on macOS');
  await ensurePathExists('/usr/bin/osascript', 'osascript');
  await ensurePathExists(xmlLintPath, 'xmllint');
  if (!corpusRoot) {
    fail(
      'Set CHEMDRAW_CORPUS_ROOT to a private directory of CDXML files before running ChemDraw macOS tests.',
    );
  }
  await ensurePathExists(corpusRoot, 'ChemDraw corpus root');
  ensureDomParserGlobals();

  await buildUnitTestDist(rootDir);

  const cdxmlModule = await import(
    pathToFileURL(path.join(rootDir, '.unit-test-dist', 'src', 'utils', 'cdxml.js')).href
  );
  const { cdxmlToChemDrawDocument, chemDrawDocumentToCDXML } = cdxmlModule;
  let generateDocumentSVG = null;
  let visualTooling = null;
  if (visualCaptureRequested) {
    const svgModule = await import(
      pathToFileURL(path.join(rootDir, '.unit-test-dist', 'src', 'lib', 'svgExport.js')).href
    );
    ({ generateDocumentSVG } = svgModule);

    const rsvgConvertPath = findCommandPath('rsvg-convert');
    const magickPath = findCommandPath('magick');
    const pdftoppmPath = findCommandPath('pdftoppm');
    const comparePath = findCommandPath('compare');
    const missing = [
      !rsvgConvertPath ? 'rsvg-convert' : null,
      !magickPath ? 'magick' : null,
      !pdftoppmPath ? 'pdftoppm' : null,
      !comparePath ? 'compare' : null,
    ]
      .filter(Boolean)
      .join(', ');
    if (missing) {
      fail(`Visual capture tooling unavailable (${missing}).`);
    }
    visualTooling = {
      rsvgConvertPath,
      magickPath,
      pdftoppmPath,
      comparePath,
    };
  }

  const cases = await loadCases(corpusRoot);
  const tempRoot = await mkdtemp(path.join(tmpdir(), 'chemdraw-harness-'));
  const session = createChemDrawSession({ appId, showWindows });
  const failures = [];
  let appVersion = '';

  console.log(`Running ChemDraw ${mode} compatibility suite against ${cases.length} case(s).`);
  console.log(`Corpus root: ${corpusRoot}`);
  console.log(`ChemDraw window mode: ${showWindows ? 'visible' : 'background'}`);
  console.log(
    `Visual diff mode: ${
      !visualCaptureRequested
        ? 'semantic-only'
        : enforceVisualDiff
          ? `capture + enforce on configured smoke subset (threshold ${visualDiffThreshold})`
          : 'capture-only'
    }`,
  );

  try {
    appVersion = session.recoverSession();
    console.log(`ChemDraw version: ${appVersion}`);

    for (const [index, caseInfo] of cases.entries()) {
      const caseLabel = `[${index + 1}/${cases.length}] ${caseInfo.relativePath}`;
      const caseId = sanitizeCaseId(caseInfo.relativePath);
      const shouldCaptureVisualArtifacts = Boolean(visualTooling);
      const shouldEnforceVisualDiffForCase =
        enforceVisualDiff && enforcedVisualSmokeCases.has(caseInfo.relativePath);
      const visualConfig = {
        requested: visualCaptureRequested,
        captureBaseline: captureVisualBaseline,
        enforceRequested: enforceVisualDiff,
        enforcedForCase: shouldEnforceVisualDiffForCase,
        threshold: shouldEnforceVisualDiffForCase ? visualDiffThreshold : null,
        captureEnabled: shouldCaptureVisualArtifacts,
        windowMode: showWindows ? 'visible' : 'background',
        atomColorViewMode: 'chemdraw-fidelity',
      };
      console.log(`\n${caseLabel}`);

      const result = await runCaseWithRetry({
        maxAttempts: 2,
        runAttempt: async (attempt) => {
          const caseTempDir = await mkdtemp(path.join(tempRoot, `${caseId}-attempt-${attempt}-`));
          const generatedInputPath = path.join(caseTempDir, 'chem-editor-input.cdxml');
          const chemdrawOutputPath = path.join(caseTempDir, 'chemdraw-output.cdxml');
          const chemdrawPdfPath = path.join(caseTempDir, 'chemdraw-render.pdf');
          const chemEditorSvgPath = path.join(caseTempDir, 'chem-editor-render.svg');
          const chemEditorPngPath = path.join(caseTempDir, 'chem-editor-render.png');
          const chemdrawPngPath = path.join(caseTempDir, 'chemdraw-render.png');
          const overlayPath = path.join(caseTempDir, 'overlay.png');
          const diffImagePath = path.join(caseTempDir, 'diff.png');
          const startedAt = Date.now();
          let beforeSummary = null;
          let afterSummary = null;
          let beforeWarnings = [];
          let afterWarnings = [];
          let visualMetrics = null;
          const stepTimings = {};

          try {
            const originalXml = await recordTimedStep(
              stepTimings,
              'read-original-source',
              null,
              () => readFile(caseInfo.absolutePath, 'utf8'),
            );
            const importedOriginal = await recordTimedStep(
              stepTimings,
              'import-original-source',
              null,
              () => cdxmlToChemDrawDocument(originalXml),
            );
            const generatedXml = await recordTimedStep(
              stepTimings,
              'export-chem-editor-input',
              null,
              () => chemDrawDocumentToCDXML(importedOriginal.document),
            );
            await recordTimedStep(stepTimings, 'write-chem-editor-input', null, () =>
              writeFile(generatedInputPath, generatedXml, 'utf8'),
            );

            await recordTimedStep(stepTimings, 'validate-chem-editor-input', 'xml-parse', () =>
              validateXml(generatedInputPath, 'chem-editor-input'),
            );
            const beforeConversion = await recordTimedStep(
              stepTimings,
              'reimport-chem-editor-input',
              null,
              () => cdxmlToChemDrawDocument(generatedXml),
            );
            beforeWarnings = beforeConversion.warnings;
            beforeSummary = buildCompatibilitySummary(beforeConversion.document);

            if (shouldCaptureVisualArtifacts) {
              const fidelityDocument = {
                ...beforeConversion.document,
                metadata: {
                  ...beforeConversion.document.metadata,
                  documentViewSettings: { atomColorViewMode: 'chemdraw-fidelity' },
                },
              };
              const chemEditorSvg = await recordTimedStep(
                stepTimings,
                'render-chem-editor-svg',
                null,
                () =>
                  generateDocumentSVG(fidelityDocument, {
                    documentViewSettings: { atomColorViewMode: 'chemdraw-fidelity' },
                    isDarkMode: false,
                    transparent: false,
                  }),
              );
              await recordTimedStep(stepTimings, 'write-chem-editor-svg', null, () =>
                writeFile(chemEditorSvgPath, sanitizeSvgForRasterization(chemEditorSvg), 'utf8'),
              );
              await recordTimedStep(stepTimings, 'rasterize-chem-editor-svg', null, () =>
                rasterizeSvgToPng({
                  rsvgConvertPath: visualTooling.rsvgConvertPath,
                  svgPath: chemEditorSvgPath,
                  pngPath: chemEditorPngPath,
                }),
              );
            }

            await recordTimedStep(
              stepTimings,
              'ensure-clean-state-before-open',
              'ensure-clean-state',
              () => session.ensureCleanState(),
            );
            await recordTimedStep(stepTimings, 'open-document', 'open-document', () =>
              session.openDocument(generatedInputPath),
            );
            await recordTimedStep(
              stepTimings,
              'wait-for-document-count',
              'wait-for-document-count',
              () => session.waitForDocumentCount(1),
            );
            await recordTimedStep(stepTimings, 'save-cdxml', 'save-cdxml', () =>
              session.saveCdxml(chemdrawOutputPath),
            );
            if (shouldCaptureVisualArtifacts) {
              await recordTimedStep(stepTimings, 'save-pdf', 'save-pdf', () =>
                session.savePdf(chemdrawPdfPath),
              );
            }
            await recordTimedStep(stepTimings, 'close-document', 'close-document', () =>
              session.closeDocument(),
            );
            await recordTimedStep(
              stepTimings,
              'ensure-clean-state-after-close',
              'ensure-clean-state',
              () => session.ensureCleanState(),
            );

            await recordTimedStep(stepTimings, 'assert-chemdraw-output', null, () =>
              assertNonEmptyFile(chemdrawOutputPath, 'chemdraw-output'),
            );
            await recordTimedStep(stepTimings, 'validate-chemdraw-output', 'xml-parse', () =>
              validateXml(chemdrawOutputPath, 'chemdraw-output'),
            );
            if (shouldCaptureVisualArtifacts) {
              await recordTimedStep(stepTimings, 'assert-chemdraw-pdf', null, () =>
                assertNonEmptyFile(chemdrawPdfPath, 'chemdraw-render-pdf'),
              );
              await recordTimedStep(stepTimings, 'rasterize-chemdraw-pdf', null, () =>
                rasterizePdfToPng({
                  pdftoppmPath: visualTooling.pdftoppmPath,
                  pdfPath: chemdrawPdfPath,
                  pngPath: chemdrawPngPath,
                  scratchDir: caseTempDir,
                }),
              );
              visualMetrics = await recordTimedStep(
                stepTimings,
                'compare-visual-renders',
                null,
                () =>
                  compareVisualRenders({
                    magickPath: visualTooling.magickPath,
                    comparePath: visualTooling.comparePath,
                    chemEditorPngPath,
                    chemdrawPngPath,
                    overlayPath,
                    diffPath: diffImagePath,
                    scratchDir: caseTempDir,
                  }),
              );
              visualMetrics = {
                ...visualMetrics,
                threshold: visualDiffThreshold,
                enforced: shouldEnforceVisualDiffForCase,
                thresholdExceeded: visualMetrics.diffRatio > visualDiffThreshold,
              };
            }

            const outputXml = await recordTimedStep(stepTimings, 'read-chemdraw-output', null, () =>
              readFile(chemdrawOutputPath, 'utf8'),
            );
            const afterConversion = await recordTimedStep(
              stepTimings,
              'reimport-chemdraw-output',
              null,
              () => cdxmlToChemDrawDocument(outputXml),
            );
            afterWarnings = afterConversion.warnings;
            afterSummary = buildCompatibilitySummary(afterConversion.document);

            await recordTimedStep(
              stepTimings,
              'compare-semantic-summary',
              'semantic-drift',
              async () => {
                const diff = formatCompatibilityDiff(beforeSummary, afterSummary);
                if (diff !== 'No differences.') {
                  const error = new Error(`Compatibility summary drift detected\n${diff}`);
                  error.stage = 'semantic-drift';
                  throw error;
                }
                return diff;
              },
            );
            if (
              shouldCaptureVisualArtifacts &&
              shouldEnforceVisualDiffForCase &&
              visualMetrics &&
              visualMetrics.diffRatio > visualDiffThreshold
            ) {
              const error = new Error(
                `Visual diff drift detected (${visualMetrics.diffPixels} px, ratio ${visualMetrics.diffRatio.toFixed(6)})`,
              );
              error.stage = 'semantic-drift';
              throw error;
            }

            const durationMs = Date.now() - startedAt;
            const visualSuffix =
              visualMetrics && typeof visualMetrics.diffPixels === 'number'
                ? `, visual diff ${visualMetrics.diffPixels} px (${(visualMetrics.diffRatio * 100).toFixed(3)}%)`
                : '';
            console.log(`  PASS in ${durationMs}ms (attempt ${attempt}${visualSuffix})`);
            return { durationMs, visualMetrics, stepTimings };
          } catch (error) {
            const failureClassification = classifyFailure(error);
            const artifactDir = await writeAttemptArtifacts({
              caseInfo,
              caseId,
              attempt,
              runMode: mode,
              appVersion,
              failureClassification,
              originalSourcePath: caseInfo.absolutePath,
              generatedInputPath,
              chemdrawOutputPath,
              chemdrawPdfPath: (await fileExists(chemdrawPdfPath)) ? chemdrawPdfPath : null,
              chemEditorSvgPath: (await fileExists(chemEditorSvgPath)) ? chemEditorSvgPath : null,
              chemEditorPngPath: (await fileExists(chemEditorPngPath)) ? chemEditorPngPath : null,
              chemdrawPngPath: (await fileExists(chemdrawPngPath)) ? chemdrawPngPath : null,
              overlayPath: (await fileExists(overlayPath)) ? overlayPath : null,
              diffImagePath: (await fileExists(diffImagePath)) ? diffImagePath : null,
              beforeSummary,
              beforeWarnings,
              afterSummary,
              afterWarnings,
              visualMetrics,
              stepTimings,
              visualConfig,
              durationMs: Date.now() - startedAt,
              error,
            });
            console.log(
              `  Attempt ${attempt} failed (${failureClassification}). Artifacts: ${artifactDir}`,
            );
            throw error;
          } finally {
            await rm(caseTempDir, { recursive: true, force: true });
          }
        },
        recoverSession: async (error, attempt) => {
          const failureClassification = classifyFailure(error);
          console.log(
            `  Recovering ChemDraw session after attempt ${attempt} (${failureClassification})...`,
          );
          appVersion = session.recoverSession();
        },
      });

      if (!result.ok) {
        failures.push({
          caseId,
          relativePath: caseInfo.relativePath,
          attempts: result.failures.length,
          failureClassification: classifyFailure(result.failures.at(-1)?.error),
          lastError: serializeError(result.failures.at(-1)?.error),
        });

        if (mode === 'smoke') {
          console.error(`\nSmoke suite failed on ${caseInfo.relativePath}`);
          break;
        }

        console.log(
          `  FINAL FAIL after ${result.failures.length} attempt(s) (${classifyFailure(result.failures.at(-1)?.error)})`,
        );
      }
    }
  } finally {
    session.quit();
    await rm(tempRoot, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(
      `\nChemDraw compatibility suite completed with ${failures.length} failed case(s).`,
    );
    for (const failure of failures) {
      console.error(`- ${failure.relativePath} (${failure.lastError?.message ?? 'unknown error'})`);
    }
    console.error(`Artifacts saved under ${path.join(artifactRoot, runId)}`);
    process.exit(1);
  }

  console.log(`\nChemDraw compatibility suite passed (${cases.length} case(s)).`);
}

await main();
