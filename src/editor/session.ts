import type { CanvasState } from '../types/chemistry';
import type { ChemDrawDocument } from '../types/chemdraw';
import type { DocumentStyleSettings, PageSetup } from '../types/settings';
import type { EditorSelectionState, EditorSessionState, EditorViewport } from './types';
import { canvasStateToChemDrawDocument } from '../lib/chemdrawModel';

export function createEditorSelectionState(
  options?: Partial<EditorSelectionState>,
): EditorSelectionState {
  return {
    objectIds: options?.objectIds ?? new Set(),
    atomIds: options?.atomIds ?? new Set(),
    bondIds: options?.bondIds ?? new Set(),
    arrowIds: options?.arrowIds ?? new Set(),
    textBoxIds: options?.textBoxIds ?? new Set(),
    hoveredObjectId: options?.hoveredObjectId ?? null,
    hoveredObjectType: options?.hoveredObjectType ?? null,
  };
}

export function createEditorViewport(options: Partial<EditorViewport>): EditorViewport {
  return {
    scale: options.scale ?? 1,
    x: options.x ?? 0,
    y: options.y ?? 0,
    width: options.width ?? 0,
    height: options.height ?? 0,
  };
}

export function ensureEditorDocument(
  document: ChemDrawDocument | null,
  canvasState: CanvasState,
  options: { documentStyleSettings: DocumentStyleSettings; pageSetup: PageSetup },
): ChemDrawDocument {
  if (document) return document;
  return canvasStateToChemDrawDocument(canvasState, options).document;
}

export function createEditorSessionState(options: {
  document: ChemDrawDocument | null;
  activePageId?: string | null;
  canvasState: CanvasState;
  selection?: Partial<EditorSelectionState>;
  viewport?: Partial<EditorViewport>;
  activeTool?: string;
  toolState?: Record<string, unknown>;
  editMenusHidden?: boolean;
  previewMode?: EditorSessionState['viewerShellState']['previewMode'];
  showViewer?: boolean;
  viewerMode?: EditorSessionState['viewerShellState']['viewerMode'];
  documentStyleSettings: DocumentStyleSettings;
  pageSetup: PageSetup;
  revision?: number;
}): EditorSessionState {
  const document = ensureEditorDocument(options.document, options.canvasState, {
    documentStyleSettings: options.documentStyleSettings,
    pageSetup: options.pageSetup,
  });
  return {
    document,
    activePageId: options.activePageId ?? document.pages[0]?.id ?? null,
    selection: createEditorSelectionState(options.selection),
    viewport: createEditorViewport(options.viewport ?? {}),
    activeTool: options.activeTool ?? 'select',
    toolState: options.toolState ?? {},
    uiPanels: { editMenusHidden: options.editMenusHidden ?? false },
    viewerShellState: {
      previewMode: options.previewMode ?? '2D',
      showViewer: options.showViewer ?? true,
      viewerMode: options.viewerMode ?? 'split',
    },
    documentStyleSettings: options.documentStyleSettings,
    pageSetup: options.pageSetup,
    revision: options.revision ?? 0,
  };
}
