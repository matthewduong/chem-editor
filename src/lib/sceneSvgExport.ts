import type { ChemDrawDocument } from '../types/chemdraw';
import type { DocumentStyleSettings, DocumentViewSettings, PageSetup } from '../types/settings';
import { buildDocumentSceneState } from '../editor/scene/buildScene';
import { renderDocumentScene } from '../editor/scene/renderDocumentScene';
import { chemDrawDocumentToCanvasState } from './chemdrawModel';
import {
  CHEMDRAW_FIDELITY_DOCUMENT_VIEW_SETTINGS,
  DEFAULT_DOCUMENT_STYLE_SETTINGS,
  DEFAULT_PAGE_SETUP,
  getPageSetupDimensionsPx,
  normalizeDocumentStyleSettings,
  normalizeDocumentViewSettings,
} from './settings';
import { SvgCanvasContext } from './svgCanvasContext';

export interface SceneSvgOptions {
  documentStyleSettings?: Partial<DocumentStyleSettings> | DocumentStyleSettings;
  documentViewSettings?: Partial<DocumentViewSettings> | DocumentViewSettings;
  isDarkMode?: boolean;
  transparent?: boolean;
  pageSetup?: PageSetup;
}

/**
 * The scene modules speak a closed Canvas2D subset that SvgCanvasContext implements in full (see
 * its header); the structural cast is the same one the golden harness makes implicitly.
 */
function asCanvas(context: SvgCanvasContext): CanvasRenderingContext2D {
  return context as unknown as CanvasRenderingContext2D;
}

/** Whitespace around the drawn ink for an infinite-canvas export, matching the legacy exporter. */
const EXPORT_PADDING = 40;
/** Slack added to the indexed content bounds for the measuring pass's viewport. */
const MEASURE_SLACK = 500;

/**
 * SVG export driven by the same `renderDocumentScene` draw path the screen uses.
 *
 * This is the replacement for `generateDocumentSVG`'s hand-maintained second renderer. It is
 * additive until `tests/scene-svg-parity.test.mjs` shows the two agree on the fixture corpus.
 *
 * Bounds come from what was actually painted (a measuring pass), not from re-deriving object
 * extents, so they cannot drift from the drawing code.
 */
export function generateDocumentSVGFromScene(
  document: ChemDrawDocument,
  options: SceneSvgOptions = {},
): string {
  const documentStyleSettings = normalizeDocumentStyleSettings(
    options.documentStyleSettings ??
      document.metadata?.documentStyleSettings ??
      DEFAULT_DOCUMENT_STYLE_SETTINGS,
  );
  const documentViewSettings = normalizeDocumentViewSettings(
    options.documentViewSettings ??
      document.metadata?.documentViewSettings ??
      CHEMDRAW_FIDELITY_DOCUMENT_VIEW_SETTINGS,
  );
  const pageSetup = options.pageSetup ?? document.metadata?.pageSetup ?? DEFAULT_PAGE_SETUP;
  const isDarkMode = options.isDarkMode ?? false;

  const { state } = chemDrawDocumentToCanvasState({
    ...document,
    metadata: { ...document.metadata, documentStyleSettings, documentViewSettings, pageSetup },
  });
  const scene = buildDocumentSceneState({
    document,
    canvasState: {
      atoms: state.atoms,
      bonds: state.bonds,
      arrows: state.arrows,
      groups: state.groups ?? [],
      textBoxes: state.textBoxes ?? [],
    },
    documentStyleSettings,
    documentViewSettings,
    pageSetup,
    interaction: { isDarkMode },
  });

  let originX = 0;
  let originY = 0;
  let width: number;
  let height: number;

  if (pageSetup.mode === 'finite') {
    const metrics = getPageSetupDimensionsPx(pageSetup);
    width = metrics.totalWidthPx;
    height = metrics.totalHeightPx;
  } else {
    // The scene culls by viewport through a cell-grid index, so the probe viewport must be sized
    // from the indexed content (plus generous slack for labels and strokes that overhang their
    // indexed bounds), not set to "infinity".
    const entries = scene.index.spatialEntries;
    if (entries.length === 0) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">${
        options.transparent
          ? ''
          : `<rect width="200" height="150" fill="${isDarkMode ? '#1e1e1e' : '#f5f5f5'}"/>`
      }</svg>`;
    }
    const left = Math.min(...entries.map((entry) => entry.bounds.left)) - MEASURE_SLACK;
    const top = Math.min(...entries.map((entry) => entry.bounds.top)) - MEASURE_SLACK;
    const right = Math.max(...entries.map((entry) => entry.bounds.right)) + MEASURE_SLACK;
    const bottom = Math.max(...entries.map((entry) => entry.bounds.bottom)) + MEASURE_SLACK;
    const probe = new SvgCanvasContext({ width: 1, height: 1 });
    renderDocumentScene(asCanvas(probe), scene, {
      width: right - left,
      height: bottom - top,
      stageScale: 1,
      stagePos: { x: -left, y: -top },
    });
    const ink = probe.getInkBounds();
    if (!ink) {
      return `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150">${
        options.transparent
          ? ''
          : `<rect width="200" height="150" fill="${isDarkMode ? '#1e1e1e' : '#f5f5f5'}"/>`
      }</svg>`;
    }
    // Ink is measured in viewport space, which is document space shifted by (-left, -top).
    originX = left + ink.minX - EXPORT_PADDING;
    originY = top + ink.minY - EXPORT_PADDING;
    width = ink.maxX - ink.minX + EXPORT_PADDING * 2;
    height = ink.maxY - ink.minY + EXPORT_PADDING * 2;
  }

  const background = options.transparent ? null : isDarkMode ? '#1e1e1e' : '#f5f5f5';
  const context = new SvgCanvasContext({ width, height, background });
  renderDocumentScene(asCanvas(context), scene, {
    width,
    height,
    stageScale: 1,
    stagePos: { x: -originX, y: -originY },
  });
  return context.toSVG();
}
