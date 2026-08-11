import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRecordingContext, normalizeOps } from './recording-canvas.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const FIXTURE_DIR = path.join(rootDir, 'tests', 'fixtures', 'cdxml');
export const GOLDEN_DIR = path.join(rootDir, 'tests', 'fixtures', 'goldens', 'ops');
const DIST_DIR = path.join(rootDir, '.unit-test-dist', 'src');

/** Fixed viewport so goldens do not depend on window size. */
const RENDER_OPTIONS = {
  width: 400,
  height: 400,
  stageScale: 1,
  stagePos: { x: 0, y: 0 },
};

export function listFixtures() {
  return readdirSync(FIXTURE_DIR)
    .filter((name) => name.endsWith('.cdxml'))
    .sort();
}

export function goldenPathFor(fixtureName) {
  return path.join(GOLDEN_DIR, `${fixtureName.replace(/\.cdxml$/, '')}.json`);
}

/**
 * Optional per-fixture scene options, as `<fixture>.options.json`.
 *
 * Dark mode, hydrogen display and page setup are view state rather than document content, so
 * they cannot be expressed in the CDXML itself. Supported keys: `interaction` (merged into the
 * scene's interaction state) and `pageSetup` (merged into the default page setup).
 */
function readFixtureOptions(fixtureName) {
  const optionsPath = path.join(FIXTURE_DIR, `${fixtureName.replace(/\.cdxml$/, '')}.options.json`);
  if (!existsSync(optionsPath)) return {};
  return JSON.parse(readFileSync(optionsPath, 'utf8'));
}

/**
 * Loads the compiled renderer.
 *
 * Goldens run against `.unit-test-dist/`, the same CommonJS build the rest of the node --test
 * suite uses, so a golden always reflects the code the other tests exercise.
 */
async function loadRenderer() {
  const [scene, render, cdxml, model, settings] = await Promise.all([
    import(path.join(DIST_DIR, 'editor', 'scene', 'buildScene.js')),
    import(path.join(DIST_DIR, 'editor', 'scene', 'renderDocumentScene.js')),
    import(path.join(DIST_DIR, 'utils', 'cdxml.js')),
    import(path.join(DIST_DIR, 'lib', 'chemdrawModel.js')),
    import(path.join(DIST_DIR, 'lib', 'settings.js')),
  ]);
  return {
    buildDocumentSceneState: scene.buildDocumentSceneState,
    renderDocumentScene: render.renderDocumentScene,
    cdxmlToChemDrawDocument: cdxml.cdxmlToChemDrawDocument,
    chemDrawDocumentToCanvasState: model.chemDrawDocumentToCanvasState,
    settings,
  };
}

let rendererPromise = null;
function getRenderer() {
  rendererPromise ??= loadRenderer();
  return rendererPromise;
}

/** Renders one fixture and returns its normalized op stream. */
export async function recordFixture(fixtureName) {
  const {
    buildDocumentSceneState,
    renderDocumentScene,
    cdxmlToChemDrawDocument,
    chemDrawDocumentToCanvasState,
    settings,
  } = await getRenderer();

  const xml = readFileSync(path.join(FIXTURE_DIR, fixtureName), 'utf8');
  const options = readFixtureOptions(fixtureName);
  const document = cdxmlToChemDrawDocument(xml).document;
  const canvasState = chemDrawDocumentToCanvasState(document).state;

  const scene = buildDocumentSceneState({
    document,
    canvasState: {
      atoms: canvasState.atoms,
      bonds: canvasState.bonds,
      arrows: canvasState.arrows,
      groups: canvasState.groups ?? [],
      textBoxes: canvasState.textBoxes ?? [],
    },
    documentStyleSettings: settings.DEFAULT_DOCUMENT_STYLE_SETTINGS,
    documentViewSettings: settings.DEFAULT_DOCUMENT_VIEW_SETTINGS,
    pageSetup: { ...settings.DEFAULT_PAGE_SETUP, ...options.pageSetup },
    interaction: options.interaction,
  });

  const ctx = createRecordingContext();
  renderDocumentScene(ctx, scene, RENDER_OPTIONS);
  return normalizeOps(ctx.__ops);
}

export function readGolden(fixtureName) {
  return JSON.parse(readFileSync(goldenPathFor(fixtureName), 'utf8'));
}
