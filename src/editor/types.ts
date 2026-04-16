import type { ChemDrawBounds, ChemDrawDocument, ChemDrawObjectType } from '../types/chemdraw';
import type { DocumentStyleSettings, PageSetup } from '../types/settings';

export interface EditorViewport {
  scale: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EditorSelectionState {
  objectIds: Set<string>;
  atomIds: Set<string>;
  bondIds: Set<string>;
  arrowIds: Set<string>;
  textBoxIds: Set<string>;
  hoveredObjectId: string | null;
  hoveredObjectType: ChemDrawObjectType | null;
}

export interface EditorViewerShellState {
  previewMode: '2D' | '3D';
  showViewer: boolean;
  viewerMode: 'pinned' | 'floating' | 'split';
}

export interface EditorUiPanelsState {
  editMenusHidden: boolean;
}

export interface EditorSessionState {
  document: ChemDrawDocument | null;
  activePageId: string | null;
  selection: EditorSelectionState;
  viewport: EditorViewport;
  activeTool: string;
  toolState: Record<string, unknown>;
  uiPanels: EditorUiPanelsState;
  viewerShellState: EditorViewerShellState;
  documentStyleSettings: DocumentStyleSettings;
  pageSetup: PageSetup;
  revision: number;
}

export interface EditorCommandContext {
  activePageId: string | null;
  documentStyleSettings: DocumentStyleSettings;
  pageSetup: PageSetup;
  selection: EditorSelectionState;
}

export interface EditorCommandResult {
  document: ChemDrawDocument;
  inversePatch: EditorCommand | null;
  changedObjectIds: Set<string>;
}

export interface EditorTransactionResult {
  document: ChemDrawDocument;
  inverseTransaction: EditorTransaction;
  changedObjectIds: Set<string>;
}

export interface EditorCommand {
  type: string;
  description?: string;
  apply: (document: ChemDrawDocument, context: EditorCommandContext) => EditorCommandResult;
}

export interface EditorTransaction {
  id: string;
  label?: string;
  commands: EditorCommand[];
}

export type EditorViewportBounds = ChemDrawBounds;
