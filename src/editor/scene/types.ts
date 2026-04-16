import type { Arrow, Atom, Bond, Group, TextBox } from '../../types/chemistry';
import type {
  ChemDrawArrow,
  ChemDrawBond,
  ChemDrawNode,
  ChemDrawObject,
  ChemDrawObjectType,
} from '../../types/chemdraw';
import type { DocumentStyleSettings, DocumentViewSettings, PageSetup } from '../../types/settings';
import type { DocumentIndex } from '../document';
import type { EditorViewportBounds } from '../types';

export interface LegacyCanvasSceneState {
  atoms: Atom[];
  bonds: Bond[];
  arrows: Arrow[];
  groups: Group[];
  textBoxes: TextBox[];
  atomById: Map<string, Atom>;
  bondById: Map<string, Bond>;
  arrowById: Map<string, Arrow>;
  textBoxById: Map<string, TextBox>;
  bondsByAtomId: Map<string, Bond[]>;
  nativeNodes: Map<string, ChemDrawNode>;
  nativeBonds: Map<string, ChemDrawBond>;
  nativeArrows: Map<string, ChemDrawArrow>;
  ringCentroids: Map<string, { cx: number; cy: number; n: number }>;
  bondVisibleIntervals: Map<string, Array<[number, number]>>;
}

export interface DocumentSceneState {
  index: DocumentIndex;
  legacy: LegacyCanvasSceneState;
  documentStyleSettings: DocumentStyleSettings;
  documentViewSettings: DocumentViewSettings;
  pageSetup: PageSetup;
  isDarkMode: boolean;
  showHydrogens: boolean;
  selectedAtomIds: Set<string>;
  selectedBondIds: Set<string>;
  selectedArrowIds: Set<string>;
  selectedTextBoxIds: Set<string>;
  selectedObjectIds: Set<string>;
  fullySelectedComponentAtomIds: Set<string>;
  hiddenObjectIds: Set<string>;
  hoveredAtomId: string | null;
  hoveredBondId: string | null;
  hoveredArrowId: string | null;
  hoveredTextBoxId: string | null;
  hoveredNativeObjectId: string | null;
  editingTextBoxId: string | null;
  rdkitInvalidAtomIds: Set<string>;
}

export interface RenderSceneOptions {
  width: number;
  height: number;
  stageScale: number;
  stagePos: { x: number; y: number };
}

export interface SceneHitTestOptions {
  stageScale: number;
}

export interface ObjectModuleContext {
  ctx: CanvasRenderingContext2D;
  scene: DocumentSceneState;
}

export interface ObjectModule {
  type: ChemDrawObjectType;
  draw: (object: ChemDrawObject, context: ObjectModuleContext) => void;
  hitTest?: (
    object: ChemDrawObject,
    point: { x: number; y: number },
    context: ObjectModuleContext,
    options: SceneHitTestOptions,
  ) => boolean;
  selectionHandles?: (
    object: ChemDrawObject,
    context: ObjectModuleContext,
  ) => Array<{ x: number; y: number }>;
  editCapabilities?: (object: ChemDrawObject) => string[];
  serializePreservation?: (object: ChemDrawObject) => Record<string, unknown>;
}

export type ViewportBounds = EditorViewportBounds;
