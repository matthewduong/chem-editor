import type { Arrow, Atom, Bond, TextBox } from '../types/chemistry';
import type { ChemDrawBounds, ChemDrawDocument } from '../types/chemdraw';
import type { DocumentStyleSettings, DocumentViewSettings, PageSetup } from '../types/settings';
import type { SceneCanvasState } from '../editor/scene/buildScene';
import { buildDocumentSceneState } from '../editor/scene/buildScene';
import { renderDocumentScene } from '../editor/scene/renderDocumentScene';
import type { DocumentSceneState } from '../editor/scene/types';
import { canvasStateToChemDrawDocument, chemDrawDocumentToCanvasState } from './chemdrawModel';
import { SvgCanvasContext } from './svgCanvasContext';
import {
  CHEMDRAW_FIDELITY_DOCUMENT_VIEW_SETTINGS,
  DEFAULT_DOCUMENT_STYLE_SETTINGS,
  DEFAULT_PAGE_SETUP,
  getPageSetupDimensionsPx,
  normalizeDocumentStyleSettings,
  normalizeDocumentViewSettings,
} from './settings';

/**
 * SVG export.
 *
 * There is no drawing code here. Both entry points assemble a scene and hand it to
 * `renderDocumentScene` with a context that emits markup instead of pixels, so exported SVG comes
 * from the same draw calls that paint the screen. Anything that changes how an object looks is
 * changed once, in that object's scene module.
 *
 * This module is store-free so it can run headless (see CLAUDE.md's layering rule); the live
 * document's settings are read by `svgExportFromStore.ts` instead.
 */

/** Margin around the drawing when there is no finite page to size against. */
const CONTENT_PADDING = 40;

/** Shown when a document has nothing to draw and no page to fall back on. */
const EMPTY_EXPORT_SIZE = { width: 200, height: 150 };

/**
 * Backdrop for the export.
 *
 * A finite page is paper, so it exports on the page colour; without one there is only the editor
 * canvas to stand in. The page tiles that used to supply the paper colour on screen are chrome and
 * are not drawn into exports, so the colour is carried here instead.
 */
function backgroundColor(scene: DocumentSceneState): string {
  if (scene.pageSetup.mode === 'finite') return scene.isDarkMode ? '#242424' : '#ffffff';
  return scene.isDarkMode ? '#1e1e1e' : '#f5f5f5';
}

function unionBounds(target: ChemDrawBounds | null, next: ChemDrawBounds): ChemDrawBounds {
  if (!target) return { ...next };
  return {
    left: Math.min(target.left, next.left),
    top: Math.min(target.top, next.top),
    right: Math.max(target.right, next.right),
    bottom: Math.max(target.bottom, next.bottom),
  };
}

function pointBounds(x: number, y: number): ChemDrawBounds {
  return { left: x, top: y, right: x, bottom: y };
}

/**
 * Extent of everything the scene will draw.
 *
 * The document index already carries per-object bounds (it uses them for viewport culling), so
 * this unions those rather than re-deriving geometry. The flat arrays are folded in as well
 * because a scene can be built from them without a document behind it.
 */
function computeSceneContentBounds(scene: DocumentSceneState): ChemDrawBounds | null {
  let bounds: ChemDrawBounds | null = null;
  for (const objectBounds of scene.index.boundsById.values()) {
    bounds = unionBounds(bounds, objectBounds);
  }
  for (const atom of scene.legacy.atoms) {
    bounds = unionBounds(bounds, pointBounds(atom.x, atom.y));
  }
  for (const arrow of scene.legacy.arrows) {
    bounds = unionBounds(bounds, pointBounds(arrow.x1, arrow.y1));
    bounds = unionBounds(bounds, pointBounds(arrow.x2, arrow.y2));
    bounds = unionBounds(bounds, pointBounds(arrow.cpx, arrow.cpy));
  }
  for (const textBox of scene.legacy.textBoxes) {
    bounds = unionBounds(bounds, pointBounds(textBox.x, textBox.y));
  }
  return bounds;
}

/**
 * Canvas size and origin for the export.
 *
 * A finite page renders at its true size with the page origin at (0,0), which is what makes an
 * exported page comparable to one printed by ChemDraw. Without a finite page there is no
 * authored canvas, so the drawing is framed with a fixed margin instead.
 */
function resolveExportViewport(scene: DocumentSceneState): {
  width: number;
  height: number;
  stagePos: { x: number; y: number };
} {
  if (scene.pageSetup.mode === 'finite') {
    const metrics = getPageSetupDimensionsPx(scene.pageSetup);
    return {
      width: metrics.totalWidthPx,
      height: metrics.totalHeightPx,
      stagePos: { x: 0, y: 0 },
    };
  }

  const bounds = computeSceneContentBounds(scene);
  if (!bounds) {
    return { ...EMPTY_EXPORT_SIZE, stagePos: { x: 0, y: 0 } };
  }
  return {
    width: bounds.right - bounds.left + CONTENT_PADDING * 2,
    height: bounds.bottom - bounds.top + CONTENT_PADDING * 2,
    stagePos: { x: CONTENT_PADDING - bounds.left, y: CONTENT_PADDING - bounds.top },
  };
}

function renderSceneToSvg(scene: DocumentSceneState, transparent: boolean): string {
  const { width, height, stagePos } = resolveExportViewport(scene);
  const ctx = new SvgCanvasContext({
    width,
    height,
    background: transparent ? null : backgroundColor(scene),
  });
  // SvgCanvasContext implements the Canvas2D surface the scene modules use; see its doc comment
  // for how that surface is pinned.
  renderDocumentScene(ctx as unknown as CanvasRenderingContext2D, scene, {
    width,
    height,
    stageScale: 1,
    stagePos,
    drawPageChrome: false,
  });
  return ctx.toSVG();
}

/**
 * Whether `document` is the whole of `state` rather than a subset of it.
 *
 * The clipboard exports a selection buffer, which has no document of its own; the file and print
 * exports pass the live document's own arrays and need its graphics, brackets and tables to come
 * along. Comparing node and bond identity separates the two without a caller-supplied flag.
 */
function documentCoversCanvasState(
  document: ChemDrawDocument | null | undefined,
  atoms: Atom[],
  bonds: Bond[],
): document is ChemDrawDocument {
  if (!document) return false;
  const objects = document.pages[0]?.objects ?? [];
  const nodeIds = new Set<string>();
  const bondIds = new Set<string>();
  for (const object of objects) {
    if (object.type === 'node') nodeIds.add(object.id);
    else if (object.type === 'bond') bondIds.add(object.id);
  }
  if (nodeIds.size !== atoms.length || bondIds.size !== bonds.length) return false;
  return atoms.every((atom) => nodeIds.has(atom.id)) && bonds.every((bond) => bondIds.has(bond.id));
}

/**
 * Store-free entry point: everything the renderer needs is passed in explicitly.
 * `svgExportFromStore.ts` is the store-bound adapter that calls this with the live document's
 * settings.
 */
export function generateCanvasSVGWithContext(
  atoms: Atom[],
  bonds: Bond[],
  arrows: Arrow[],
  options: {
    chemDrawDocument?: ChemDrawDocument | null;
    documentStyleSettings: DocumentStyleSettings;
    documentViewSettings: DocumentViewSettings;
    isDarkMode: boolean;
    transparent?: boolean;
    textBoxes?: TextBox[];
    pageSetup?: PageSetup;
  },
): string {
  const {
    chemDrawDocument,
    documentStyleSettings,
    documentViewSettings,
    isDarkMode,
    transparent = false,
    textBoxes = [],
    pageSetup = DEFAULT_PAGE_SETUP,
  } = options;

  const canvasState: SceneCanvasState = { atoms, bonds, arrows, groups: [], textBoxes };
  const document = documentCoversCanvasState(chemDrawDocument, atoms, bonds)
    ? chemDrawDocument
    : canvasStateToChemDrawDocument(
        { atoms, bonds, arrows, groups: [], textBoxes },
        { documentStyleSettings, pageSetup },
      ).document;

  const scene = buildDocumentSceneState({
    document,
    canvasState,
    documentStyleSettings,
    documentViewSettings,
    pageSetup,
    interaction: { isDarkMode },
  });
  return renderSceneToSvg(scene, transparent);
}

export function generateDocumentSVG(
  document: ChemDrawDocument,
  options?: {
    documentStyleSettings?: Partial<DocumentStyleSettings> | DocumentStyleSettings;
    documentViewSettings?: Partial<DocumentViewSettings> | DocumentViewSettings;
    isDarkMode?: boolean;
    transparent?: boolean;
    pageSetup?: PageSetup;
  },
): string {
  const documentStyleSettings = normalizeDocumentStyleSettings(
    options?.documentStyleSettings ??
      document.metadata?.documentStyleSettings ??
      DEFAULT_DOCUMENT_STYLE_SETTINGS,
  );
  const documentViewSettings = normalizeDocumentViewSettings(
    options?.documentViewSettings ??
      document.metadata?.documentViewSettings ??
      CHEMDRAW_FIDELITY_DOCUMENT_VIEW_SETTINGS,
  );
  const pageSetup = options?.pageSetup ?? document.metadata?.pageSetup ?? DEFAULT_PAGE_SETUP;
  const resolvedDocument: ChemDrawDocument = {
    ...document,
    metadata: {
      ...document.metadata,
      documentStyleSettings,
      documentViewSettings,
      pageSetup,
    },
  };
  const { state } = chemDrawDocumentToCanvasState(resolvedDocument);

  const scene = buildDocumentSceneState({
    document: resolvedDocument,
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
    interaction: { isDarkMode: options?.isDarkMode ?? false },
  });
  return renderSceneToSvg(scene, options?.transparent ?? false);
}
