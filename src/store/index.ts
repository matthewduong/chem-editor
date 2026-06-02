import { create } from 'zustand';
import type {
  Atom,
  Bond,
  Arrow,
  ArrowType,
  CanvasState,
  ElectronToolMode,
  Group,
  TextBox,
  MoleculeProperties,
  IrPeak,
  NmrSpectrum,
  MsSpectrum,
} from '../types/chemistry';
import type { ChemDrawDocument } from '../types/chemdraw';
import type {
  AppPreferences,
  DocumentViewSettings,
  DocumentStyleSettings,
  PageSetup,
  TextFormat,
  ViewerPreferences,
} from '../types/settings';
import { buildAlignmentUnits, applyAlignment, type AlignOp } from '../lib/alignment';
import { normalizeAtoms } from '../lib/atomIdentity';
import {
  alignSelectedObjects,
  canvasStateToChemDrawDocument,
  chemDrawDocumentToCanvasState,
  createGroupFromSelection,
  mergeCanvasStateIntoChemDrawDocument,
  removeGroupsFromSelection,
} from '../lib/chemdrawModel';
import {
  applyDocumentViewSettings,
  applyDocumentStyleSettings,
  applyDocumentStyleSettingsToCanvas,
  applyDocumentPageSetup,
  buildTextFormatFromDocumentSettings,
  DEFAULT_APP_PREFERENCES,
  DEFAULT_PAGE_SETUP,
  normalizeDocumentViewSettings,
  normalizeDocumentStyleSettings,
  resolveDocumentViewSettings,
  resolveDocumentStyleSettings,
  resolveDocumentPageSetup,
  saveAppPreferences,
} from '../lib/settings';
import {
  applyEditorCommand,
  applyEditorTransaction,
  createEditorCommandContext,
} from '../editor/commands';
import { createEditorSessionState } from '../editor/session';
import type { EditorCommand, EditorSessionState, EditorTransaction } from '../editor/types';
import { sanitizeRingTemplateState, type RingPreset } from '../lib/ringTemplates';
export type { AlignOp };
export type { TextFormat };

export type Tool =
  | 'select'
  | 'atom'
  | 'bond'
  | 'eraser'
  | 'fragment'
  | 'arrow'
  | 'charge'
  | 'pan'
  | 'text'
  | 'ring';
export type ViewerMode = 'pinned' | 'floating' | 'split';
export type PreviewMode = '2D' | '3D';
export interface ViewerStructureStatus {
  kind: 'empty' | 'valid' | 'display-only';
  chemistryAvailable: boolean;
  fallbackGeometryAvailable: boolean;
  message: string | null;
}

export type SelectionPreviewTransform =
  | {
      kind: 'move';
      selectedObjectIds: Set<string>;
      movedAtomIds: Set<string>;
      affectedBondIds: Set<string>;
      dx: number;
      dy: number;
    }
  | {
      kind: 'rotate';
      selectedObjectIds: Set<string>;
      movedAtomIds: Set<string>;
      affectedBondIds: Set<string>;
      center: { x: number; y: number };
      radians: number;
    }
  | {
      kind: 'scale';
      selectedObjectIds: Set<string>;
      movedAtomIds: Set<string>;
      affectedBondIds: Set<string>;
      anchor: { x: number; y: number };
      factor: number;
    };

function persistPreferences(appPreferences: AppPreferences) {
  void saveAppPreferences(appPreferences).catch(() => {
    /* intentional */
  });
}

function normalizeCanvasState<T extends CanvasState>(state: T): T {
  return sanitizeRingTemplateState({
    ...state,
    atoms: normalizeAtoms(state.atoms),
    groups: state.groups ?? [],
    textBoxes: state.textBoxes ?? [],
  });
}

export const LARGE_DOCUMENT_OBJECT_THRESHOLD = 2000;

function getDocumentObjectCount(document: ChemDrawDocument | null | undefined): number {
  return document?.pages[0]?.objects.length ?? 0;
}

function describeDocumentState(document: ChemDrawDocument | null | undefined) {
  const objectCount = getDocumentObjectCount(document);
  return {
    objectCount,
    largeDocumentMode: objectCount >= LARGE_DOCUMENT_OBJECT_THRESHOLD,
  };
}

function materializeChemDrawDocument(options: {
  document: ChemDrawDocument | null;
  canvasState: CanvasState;
  documentStyleSettings: DocumentStyleSettings;
  pageSetup: PageSetup;
}): ChemDrawDocument {
  return options.document
    ? mergeCanvasStateIntoChemDrawDocument(options.document, options.canvasState).document
    : canvasStateToChemDrawDocument(options.canvasState, {
        documentStyleSettings: options.documentStyleSettings,
        pageSetup: options.pageSetup,
      }).document;
}

export interface AppState {
  // ── Editor ──────────────────────────────────────────────────────────────────
  tool: Tool;
  element: string;
  atomToolMode: 'element' | 'alias';
  bondOrder: number;
  stereo: number;
  arrowType: ArrowType;
  currentCharge: number;
  electronToolMode: ElectronToolMode;
  selectedFragment: string;
  showHydrogens: boolean;
  ringSize: number;
  ringPreset: RingPreset;
  ringRotationSteps: number;

  // ── Canvas ──────────────────────────────────────────────────────────────────
  atoms: Atom[];
  bonds: Bond[];
  arrows: Arrow[];
  groups: Group[];
  textBoxes: TextBox[];
  history: CanvasState[];
  documentHistory: ChemDrawDocument[];
  historyIndex: number;
  selectedObjectIds: Set<string>;
  selectedAtomIds: Set<string>;
  selectedBondIds: Set<string>;
  selectedArrowIds: Set<string>;
  selectedTextBoxIds: Set<string>;
  lastInteractedAtomId: string | null;
  canvasSize: { width: number; height: number };
  pageSetup: PageSetup;
  chemDrawDocument: ChemDrawDocument | null;
  previewChemDrawDocument: ChemDrawDocument | null;
  selectionPreviewTransform: SelectionPreviewTransform | null;
  chemDrawWarnings: string[];
  objectCount: number;
  largeDocumentMode: boolean;
  documentRevision: number;
  projectionRevision: number;

  // ── Viewer ──────────────────────────────────────────────────────────────────
  viewerSmiles: string;
  viewerGeometrySmiles: string;
  viewerGeometryMolblock: string;
  viewerMolblock: string;
  viewerStructureStatus: ViewerStructureStatus;
  viewerAtomIndexById: Record<string, number>;
  viewerAtomIdByMapNumber: Record<string, string>;
  hoveredCanvasAtomId: string | null;
  hoveredCanvasBondId: string | null;
  editableSmiles: string;
  isInputFocused: boolean;
  previewMode: PreviewMode;
  showViewer: boolean;
  viewerMode: ViewerMode;
  viewerPos: { x: number; y: number };
  viewerSize: { width: number; height: number };
  splitWidth: number;
  minimizeGeometry: boolean;
  rawConformer: {
    structureKey: string;
    forceField: ViewerPreferences['forceField'];
    atoms: Array<{ x: number; y: number; z: number; element: string; atomMapNum?: number | null }>;
    bonds: Array<{ a1: number; a2: number; order: number }>;
    energyHartree?: number;
    warnings?: string[];
  } | null;
  viewerHoveredAtomIdx: number | null;
  viewerSelectedAtomIdx: number | null;
  setMinimizeGeometry: (v: boolean) => void;
  setRawConformer: (v: AppState['rawConformer']) => void;
  setViewerHoveredAtomIdx: (idx: number | null) => void;
  setViewerSelectedAtomIdx: (idx: number | null) => void;
  viewerRepresentation: ViewerPreferences['representation'];
  viewerSpin: boolean;
  viewerSpinSpeed: number;
  viewerForceField: ViewerPreferences['forceField'];
  viewerMultiConformer: boolean;
  viewerMaxConformers: number;
  viewerShowAtomNumbers: boolean;
  viewerShowAtomLabels: boolean;
  viewerShowMeasureToolbar: boolean;
  viewerAtomScale: number;
  viewerBondScale: number;
  viewerPerspectiveFov: number;
  viewerBackgroundColor: string;
  viewerBondColor: string;
  viewerAmbientLightIntensity: number;
  viewerHemiLightIntensity: number;
  viewerKeyLightIntensity: number;
  viewerFillLightIntensity: number;
  viewerRimLightIntensity: number;
  viewerOrbitalBasis: ViewerPreferences['orbitals']['basis'];
  viewerOrbitalOpacity: number;
  viewerOrbitalPositiveColor: string;
  viewerOrbitalNegativeColor: string;
  viewerOrbitalMaterial: ViewerPreferences['orbitals']['material'];
  viewerOrbitalOutline: boolean;
  viewerOrbitalIsovalue: number;
  viewerOrbitalShowPositivePhase: boolean;
  viewerOrbitalShowNegativePhase: boolean;

  // ── UI ───────────────────────────────────────────────────────────────────────
  isDarkMode: boolean;
  showGrid: boolean;
  appPreferences: AppPreferences;
  preferencesHydrated: boolean;
  documentStyleSettings: DocumentStyleSettings;
  documentViewSettings: DocumentViewSettings;
  sidebarWidth: number;
  editMenusHidden: boolean;
  showBondMenu: boolean;
  showSmilesBar: boolean;
  isFileDropdownOpen: boolean;
  isExportSubmenuOpen: boolean;
  isEditDropdownOpen: boolean;
  isAlignSubmenuOpen: boolean;
  isSettingsDropdownOpen: boolean;
  isPreferencesPanelOpen: boolean;
  isPeriodicTableOpen: boolean;
  isAboutOpen: boolean;
  isViewerSettingsOpen: boolean;
  isCalculateDropdownOpen: boolean;
  showPropertiesPanel: boolean;
  showIrPanel: boolean;
  showNmrPanel: boolean;
  showMsPanel: boolean;
  propertiesPos: { x: number; y: number };
  irPos: { x: number; y: number };
  nmrPos: { x: number; y: number };
  msPos: { x: number; y: number };
  propertiesSize: { width: number; height: number };
  irSize: { width: number; height: number };
  nmrSize: { width: number; height: number };
  msSize: { width: number; height: number };
  moleculeProperties: MoleculeProperties | null;
  irSpectrum: IrPeak[] | null;
  nmrSpectrum: NmrSpectrum | null;
  msSpectrum: MsSpectrum | null;
  collapsedSections: Set<string>;
  licensesText: string;
  textFormat: TextFormat;

  // ── Editor actions ───────────────────────────────────────────────────────────
  setTool: (tool: Tool) => void;
  setElement: (el: string) => void;
  setAtomToolSelection: (value: string, mode: 'element' | 'alias') => void;
  setBondOrder: (order: number) => void;
  setStereo: (stereo: number) => void;
  setArrowType: (type: ArrowType) => void;
  setCurrentCharge: (charge: number) => void;
  setElectronToolMode: (mode: ElectronToolMode) => void;
  setSelectedFragment: (smiles: string) => void;
  setShowHydrogens: (show: boolean) => void;
  setRingSize: (n: number) => void;
  setRingPreset: (preset: RingPreset) => void;
  rotateRingTemplate: (deltaSteps: number) => void;
  setRingRotationSteps: (steps: number) => void;

  // ── Canvas actions ───────────────────────────────────────────────────────────
  pushToHistory: (state: CanvasState) => void;
  setCurrentCanvasState: (state: CanvasState) => void;
  undo: () => void;
  redo: () => void;
  selectAll: () => void;
  deselectAll: () => void;
  clearCanvas: () => void;
  setSelectedObjectIds: (ids: Set<string>) => void;
  setSelectedAtomIds: (ids: Set<string>) => void;
  setSelectedBondIds: (ids: Set<string>) => void;
  setSelectedArrowIds: (ids: Set<string>) => void;
  setSelectedTextBoxIds: (ids: Set<string>) => void;
  setLastInteractedAtomId: (id: string | null) => void;
  setCanvasSize: (size: { width: number; height: number }) => void;
  setPageSetup: (pageSetup: PageSetup) => void;
  setChemDrawDocument: (document: ChemDrawDocument | null) => void;
  setPreviewChemDrawDocument: (document: ChemDrawDocument | null) => void;
  clearPreviewChemDrawDocument: () => void;
  setSelectionPreviewTransform: (preview: SelectionPreviewTransform | null) => void;
  clearSelectionPreviewTransform: () => void;
  setChemDrawWarnings: (warnings: string[]) => void;
  groupSelected: () => void;
  ungroupSelected: () => void;
  alignSelection: (op: AlignOp) => void;
  dispatchEditorCommand: (command: EditorCommand) => void;
  runEditorTransaction: (transaction: EditorTransaction) => void;

  // ── Viewer actions ───────────────────────────────────────────────────────────
  setViewerSmiles: (smiles: string) => void;
  setViewerGeometrySmiles: (smiles: string) => void;
  setViewerGeometryMolblock: (molblock: string) => void;
  setViewerMolblock: (molblock: string) => void;
  setViewerStructureStatus: (status: ViewerStructureStatus) => void;
  setViewerAtomIndexById: (mapping: Record<string, number>) => void;
  setViewerAtomIdByMapNumber: (mapping: Record<string, string>) => void;
  setHoveredCanvasAtomId: (id: string | null) => void;
  setHoveredCanvasBondId: (id: string | null) => void;
  setEditableSmiles: (smiles: string) => void;
  setIsInputFocused: (focused: boolean) => void;
  setPreviewMode: (mode: PreviewMode) => void;
  setShowViewer: (show: boolean) => void;
  setViewerMode: (mode: ViewerMode) => void;
  setViewerPos: (pos: { x: number; y: number }) => void;
  setViewerSize: (size: { width: number; height: number }) => void;
  setSplitWidth: (width: number) => void;
  setViewerRepresentation: (representation: ViewerPreferences['representation']) => void;
  setViewerSpin: (spin: boolean) => void;
  setViewerSpinSpeed: (spinSpeed: number) => void;
  setViewerForceField: (forceField: ViewerPreferences['forceField']) => void;
  setViewerMultiConformer: (multiConformer: boolean) => void;
  setViewerMaxConformers: (maxConformers: number) => void;
  setViewerShowAtomNumbers: (showAtomNumbers: boolean) => void;
  setViewerShowAtomLabels: (showAtomLabels: boolean) => void;
  setViewerShowMeasureToolbar: (showMeasureToolbar: boolean) => void;
  setViewerAtomScale: (atomScale: number) => void;
  setViewerBondScale: (bondScale: number) => void;
  setViewerPerspectiveFov: (perspectiveFov: number) => void;
  setViewerBackgroundColor: (backgroundColor: string) => void;
  setViewerBondColor: (bondColor: string) => void;
  setViewerAmbientLightIntensity: (value: number) => void;
  setViewerHemiLightIntensity: (value: number) => void;
  setViewerKeyLightIntensity: (value: number) => void;
  setViewerFillLightIntensity: (value: number) => void;
  setViewerRimLightIntensity: (value: number) => void;
  setViewerOrbitalBasis: (value: ViewerPreferences['orbitals']['basis']) => void;
  setViewerOrbitalOpacity: (value: number) => void;
  setViewerOrbitalPositiveColor: (value: string) => void;
  setViewerOrbitalNegativeColor: (value: string) => void;
  setViewerOrbitalMaterial: (value: ViewerPreferences['orbitals']['material']) => void;
  setViewerOrbitalOutline: (value: boolean) => void;
  setViewerOrbitalIsovalue: (value: number) => void;
  setViewerOrbitalShowPositivePhase: (value: boolean) => void;
  setViewerOrbitalShowNegativePhase: (value: boolean) => void;

  // ── UI actions ───────────────────────────────────────────────────────────────
  hydrateAppPreferences: (appPreferences: AppPreferences) => void;
  setAppPreferences: (appPreferences: AppPreferences) => void;
  setDocumentStyleSettings: (documentStyleSettings: DocumentStyleSettings) => void;
  setDocumentViewSettings: (documentViewSettings: DocumentViewSettings) => void;
  applyDefaultsToCurrentDocument: () => void;
  setIsDarkMode: (dark: boolean) => void;
  setShowGrid: (show: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setEditMenusHidden: (hidden: boolean) => void;
  setShowBondMenu: (show: boolean) => void;
  setShowSmilesBar: (show: boolean) => void;
  setIsFileDropdownOpen: (open: boolean) => void;
  setIsExportSubmenuOpen: (open: boolean) => void;
  setIsEditDropdownOpen: (open: boolean) => void;
  setIsAlignSubmenuOpen: (open: boolean) => void;
  setIsSettingsDropdownOpen: (open: boolean) => void;
  setIsPreferencesPanelOpen: (open: boolean) => void;
  setIsPeriodicTableOpen: (open: boolean) => void;
  setIsAboutOpen: (open: boolean) => void;
  setIsViewerSettingsOpen: (open: boolean) => void;
  setIsCalculateDropdownOpen: (open: boolean) => void;
  setShowPropertiesPanel: (show: boolean) => void;
  setShowIrPanel: (show: boolean) => void;
  setShowNmrPanel: (show: boolean) => void;
  setShowMsPanel: (show: boolean) => void;
  setPropertiesPos: (pos: { x: number; y: number }) => void;
  setIrPos: (pos: { x: number; y: number }) => void;
  setNmrPos: (pos: { x: number; y: number }) => void;
  setMsPos: (pos: { x: number; y: number }) => void;
  setPropertiesSize: (size: { width: number; height: number }) => void;
  setIrSize: (size: { width: number; height: number }) => void;
  setNmrSize: (size: { width: number; height: number }) => void;
  setMsSize: (size: { width: number; height: number }) => void;
  setMoleculeProperties: (props: MoleculeProperties | null) => void;
  setIrSpectrum: (peaks: IrPeak[] | null) => void;
  setNmrSpectrum: (spectrum: NmrSpectrum | null) => void;
  setMsSpectrum: (spectrum: MsSpectrum | null) => void;
  toggleSection: (name: string) => void;
  setLicensesText: (text: string) => void;
  setTextFormat: (fmt: Partial<TextFormat>) => void;
  closeAllMenus: () => void;

  // ── Toasts ───────────────────────────────────────────────────────────────────
  toasts: { id: number; message: string; type: 'error' | 'info' }[];
  showToast: (message: string, type?: 'error' | 'info') => void;
  dismissToast: (id: number) => void;
}

export const useStore = create<AppState>((set, get) => ({
  // ── Editor defaults ──────────────────────────────────────────────────────────
  tool: 'bond',
  element: 'C',
  atomToolMode: 'element',
  bondOrder: 1,
  stereo: 0,
  arrowType: 'reaction',
  currentCharge: 0,
  electronToolMode: 'charge-positive',
  selectedFragment: '',
  showHydrogens: true,
  ringSize: 6,
  ringPreset: 'polygon',
  ringRotationSteps: 0,

  // ── Canvas defaults ──────────────────────────────────────────────────────────
  atoms: [],
  bonds: [],
  arrows: [],
  groups: [],
  textBoxes: [],
  history: [],
  documentHistory: [],
  historyIndex: -1,
  selectedObjectIds: new Set(),
  selectedAtomIds: new Set(),
  selectedBondIds: new Set(),
  selectedArrowIds: new Set(),
  selectedTextBoxIds: new Set(),
  lastInteractedAtomId: null,
  canvasSize: { width: 800, height: 600 },
  pageSetup: DEFAULT_PAGE_SETUP,
  chemDrawDocument: null,
  previewChemDrawDocument: null,
  selectionPreviewTransform: null,
  chemDrawWarnings: [],
  objectCount: 0,
  largeDocumentMode: false,
  documentRevision: 0,
  projectionRevision: 0,

  // ── Viewer defaults ──────────────────────────────────────────────────────────
  viewerSmiles: '',
  viewerGeometrySmiles: '',
  viewerGeometryMolblock: '',
  viewerMolblock: '',
  viewerStructureStatus: {
    kind: 'empty',
    chemistryAvailable: false,
    fallbackGeometryAvailable: false,
    message: null,
  },
  viewerAtomIndexById: {},
  viewerAtomIdByMapNumber: {},
  hoveredCanvasAtomId: null,
  hoveredCanvasBondId: null,
  editableSmiles: '',
  isInputFocused: false,
  previewMode: '3D',
  showViewer: false,
  viewerMode: DEFAULT_APP_PREFERENCES.viewer.mode,
  viewerPos: { x: 10, y: 10 },
  viewerSize: { width: 400, height: 350 },
  splitWidth: 450,
  minimizeGeometry: true,
  rawConformer: null,
  viewerHoveredAtomIdx: null,
  viewerSelectedAtomIdx: null,
  viewerRepresentation: DEFAULT_APP_PREFERENCES.viewer.representation,
  viewerSpin: DEFAULT_APP_PREFERENCES.viewer.spin,
  viewerSpinSpeed: DEFAULT_APP_PREFERENCES.viewer.spinSpeed,
  viewerForceField: DEFAULT_APP_PREFERENCES.viewer.forceField,
  viewerMultiConformer: DEFAULT_APP_PREFERENCES.viewer.multiConformer,
  viewerMaxConformers: DEFAULT_APP_PREFERENCES.viewer.maxConformers,
  viewerShowAtomNumbers: DEFAULT_APP_PREFERENCES.viewer.showAtomNumbers,
  viewerShowAtomLabels: DEFAULT_APP_PREFERENCES.viewer.showAtomLabels,
  viewerShowMeasureToolbar: DEFAULT_APP_PREFERENCES.viewer.showMeasureToolbar,
  viewerAtomScale: DEFAULT_APP_PREFERENCES.viewer.atomScale,
  viewerBondScale: DEFAULT_APP_PREFERENCES.viewer.bondScale,
  viewerPerspectiveFov: DEFAULT_APP_PREFERENCES.viewer.perspectiveFov,
  viewerBackgroundColor: DEFAULT_APP_PREFERENCES.viewer.backgroundColor,
  viewerBondColor: DEFAULT_APP_PREFERENCES.viewer.bondColor,
  viewerAmbientLightIntensity: DEFAULT_APP_PREFERENCES.viewer.ambientLightIntensity,
  viewerHemiLightIntensity: DEFAULT_APP_PREFERENCES.viewer.hemiLightIntensity,
  viewerKeyLightIntensity: DEFAULT_APP_PREFERENCES.viewer.keyLightIntensity,
  viewerFillLightIntensity: DEFAULT_APP_PREFERENCES.viewer.fillLightIntensity,
  viewerRimLightIntensity: DEFAULT_APP_PREFERENCES.viewer.rimLightIntensity,
  viewerOrbitalBasis: DEFAULT_APP_PREFERENCES.viewer.orbitals.basis,
  viewerOrbitalOpacity: DEFAULT_APP_PREFERENCES.viewer.orbitals.opacity,
  viewerOrbitalPositiveColor: DEFAULT_APP_PREFERENCES.viewer.orbitals.positiveColor,
  viewerOrbitalNegativeColor: DEFAULT_APP_PREFERENCES.viewer.orbitals.negativeColor,
  viewerOrbitalMaterial: DEFAULT_APP_PREFERENCES.viewer.orbitals.material,
  viewerOrbitalOutline: DEFAULT_APP_PREFERENCES.viewer.orbitals.outline,
  viewerOrbitalIsovalue: DEFAULT_APP_PREFERENCES.viewer.orbitals.isovalue,
  viewerOrbitalShowPositivePhase: DEFAULT_APP_PREFERENCES.viewer.orbitals.showPositivePhase,
  viewerOrbitalShowNegativePhase: DEFAULT_APP_PREFERENCES.viewer.orbitals.showNegativePhase,

  // ── UI defaults ──────────────────────────────────────────────────────────────
  isDarkMode: DEFAULT_APP_PREFERENCES.isDarkMode,
  showGrid: DEFAULT_APP_PREFERENCES.showGrid,
  appPreferences: DEFAULT_APP_PREFERENCES,
  preferencesHydrated: false,
  documentStyleSettings: DEFAULT_APP_PREFERENCES.drawing,
  documentViewSettings: DEFAULT_APP_PREFERENCES.documentView,
  sidebarWidth: 135,
  editMenusHidden: false,
  showBondMenu: false,
  showSmilesBar: false,
  isFileDropdownOpen: false,
  isExportSubmenuOpen: false,
  isEditDropdownOpen: false,
  isAlignSubmenuOpen: false,
  isSettingsDropdownOpen: false,
  isPreferencesPanelOpen: false,
  isPeriodicTableOpen: false,
  isAboutOpen: false,
  isViewerSettingsOpen: false,
  isCalculateDropdownOpen: false,
  showPropertiesPanel: false,
  showIrPanel: false,
  showNmrPanel: false,
  showMsPanel: false,
  propertiesPos: { x: 10, y: 10 },
  irPos: { x: 430, y: 10 },
  nmrPos: { x: 10, y: 320 },
  msPos: { x: 430, y: 310 },
  propertiesSize: { width: 260, height: 290 },
  irSize: { width: 420, height: 290 },
  nmrSize: { width: 700, height: 500 },
  msSize: { width: 420, height: 260 },
  moleculeProperties: null,
  irSpectrum: null,
  nmrSpectrum: null,
  msSpectrum: null,
  collapsedSections: new Set(),
  licensesText: '',
  textFormat: buildTextFormatFromDocumentSettings(DEFAULT_APP_PREFERENCES.drawing),
  toasts: [],

  // ── Editor actions ───────────────────────────────────────────────────────────
  setTool: (tool) =>
    set((state) => ({
      tool,
      ...(state.tool === 'ring' && tool !== 'ring' ? { ringRotationSteps: 0 } : {}),
    })),
  setElement: (element) => set({ element, atomToolMode: 'element' }),
  setAtomToolSelection: (element, atomToolMode) => set({ element, atomToolMode }),
  setBondOrder: (bondOrder) => set({ bondOrder }),
  setStereo: (stereo) => set({ stereo }),
  setArrowType: (arrowType) => set({ arrowType }),
  setCurrentCharge: (currentCharge) => set({ currentCharge }),
  setElectronToolMode: (electronToolMode) => set({ electronToolMode }),
  setSelectedFragment: (selectedFragment) => set({ selectedFragment }),
  setShowHydrogens: (showHydrogens) =>
    set((s) => {
      const appPreferences = { ...s.appPreferences, showHydrogens };
      persistPreferences(appPreferences);
      return { showHydrogens, appPreferences };
    }),
  setRingSize: (ringSize) => set({ ringSize }),
  setRingPreset: (ringPreset) => set({ ringPreset, ringRotationSteps: 0 }),
  rotateRingTemplate: (deltaSteps) =>
    set((state) => ({
      ringRotationSteps: (((state.ringRotationSteps + deltaSteps) % 6) + 6) % 6,
    })),
  setRingRotationSteps: (ringRotationSteps) =>
    set({
      ringRotationSteps: ((ringRotationSteps % 6) + 6) % 6,
    }),

  // ── Canvas actions ───────────────────────────────────────────────────────────
  pushToHistory: (newState) =>
    set((s) => {
      let nextState = normalizeCanvasState(newState);
      const nextDocument = materializeChemDrawDocument({
        document: s.chemDrawDocument,
        canvasState: nextState,
        documentStyleSettings: s.documentStyleSettings,
        pageSetup: s.pageSetup,
      });
      if (s.chemDrawDocument) {
        const projected = chemDrawDocumentToCanvasState(nextDocument).state;
        nextState = normalizeCanvasState({
          ...projected,
          groups: nextState.groups,
          textBoxes: projected.textBoxes ?? [],
        });
      }
      const nextDocumentMeta = describeDocumentState(nextDocument);
      const hist = s.history.slice(0, s.historyIndex + 1);
      const docHist = s.documentHistory.slice(0, s.historyIndex + 1);
      hist.push(nextState);
      docHist.push(nextDocument);
      if (hist.length > 50) hist.shift();
      if (docHist.length > 50) docHist.shift();
      return {
        history: hist,
        documentHistory: docHist,
        historyIndex: hist.length - 1,
        atoms: nextState.atoms,
        bonds: nextState.bonds,
        arrows: nextState.arrows,
        groups: nextState.groups ?? [],
        textBoxes: nextState.textBoxes ?? [],
        chemDrawDocument: nextDocument,
        previewChemDrawDocument: null,
        selectionPreviewTransform: null,
        pageSetup: resolveDocumentPageSetup(nextDocument, s.appPreferences),
        documentRevision: s.documentRevision + 1,
        projectionRevision: s.projectionRevision + 1,
        ...nextDocumentMeta,
        selectedObjectIds: new Set(
          [
            ...nextState.atoms.map((a) => a.id),
            ...nextState.bonds.map((b) => b.id),
            ...nextState.arrows.map((a) => a.id),
            ...(nextState.textBoxes ?? []).map((t) => t.id),
          ].filter((id) => s.selectedObjectIds.has(id)),
        ),
        selectedBondIds: new Set(
          nextState.bonds.map((b) => b.id).filter((id) => s.selectedBondIds.has(id)),
        ),
      };
    }),

  setCurrentCanvasState: (newState) =>
    set((s) => {
      let nextState = normalizeCanvasState(newState);
      const nextDocument = materializeChemDrawDocument({
        document: s.chemDrawDocument,
        canvasState: nextState,
        documentStyleSettings: s.documentStyleSettings,
        pageSetup: s.pageSetup,
      });
      if (s.chemDrawDocument) {
        const projected = chemDrawDocumentToCanvasState(nextDocument).state;
        nextState = normalizeCanvasState({
          ...projected,
          groups: nextState.groups,
          textBoxes: projected.textBoxes ?? [],
        });
      }
      const nextDocumentMeta = describeDocumentState(nextDocument);
      return {
        atoms: nextState.atoms,
        bonds: nextState.bonds,
        arrows: nextState.arrows,
        groups: nextState.groups ?? [],
        textBoxes: nextState.textBoxes ?? [],
        chemDrawDocument: nextDocument,
        previewChemDrawDocument: null,
        selectionPreviewTransform: null,
        pageSetup: resolveDocumentPageSetup(nextDocument, s.appPreferences),
        documentRevision: s.documentRevision + 1,
        projectionRevision: s.projectionRevision + 1,
        ...nextDocumentMeta,
      };
    }),

  undo: () =>
    set((s) => {
      if (s.historyIndex > 0) {
        const prev = s.history[s.historyIndex - 1];
        const normalizedPrev = normalizeCanvasState(prev);
        const nextDocument =
          s.documentHistory[s.historyIndex - 1] ??
          materializeChemDrawDocument({
            document: s.chemDrawDocument,
            canvasState: normalizedPrev,
            documentStyleSettings: s.documentStyleSettings,
            pageSetup: s.pageSetup,
          });
        const nextDocumentMeta = describeDocumentState(nextDocument);
        return {
          historyIndex: s.historyIndex - 1,
          atoms: normalizedPrev.atoms,
          bonds: normalizedPrev.bonds,
          arrows: normalizedPrev.arrows,
          groups: normalizedPrev.groups ?? [],
          textBoxes: normalizedPrev.textBoxes ?? [],
          chemDrawDocument: nextDocument,
          previewChemDrawDocument: null,
          selectionPreviewTransform: null,
          pageSetup: resolveDocumentPageSetup(nextDocument, s.appPreferences),
          documentRevision: s.documentRevision + 1,
          projectionRevision: s.projectionRevision + 1,
          ...nextDocumentMeta,
        };
      }
      if (s.historyIndex === 0)
        return {
          historyIndex: -1,
          atoms: [],
          bonds: [],
          arrows: [],
          groups: [],
          textBoxes: [],
          chemDrawDocument: null,
          previewChemDrawDocument: null,
          selectionPreviewTransform: null,
          objectCount: 0,
          largeDocumentMode: false,
          documentRevision: s.documentRevision + 1,
          projectionRevision: s.projectionRevision + 1,
        };
      return {};
    }),

  redo: () =>
    set((s) => {
      if (s.historyIndex < s.history.length - 1) {
        const next = s.history[s.historyIndex + 1];
        const normalizedNext = normalizeCanvasState(next);
        const nextDocument =
          s.documentHistory[s.historyIndex + 1] ??
          materializeChemDrawDocument({
            document: s.chemDrawDocument,
            canvasState: normalizedNext,
            documentStyleSettings: s.documentStyleSettings,
            pageSetup: s.pageSetup,
          });
        const nextDocumentMeta = describeDocumentState(nextDocument);
        return {
          historyIndex: s.historyIndex + 1,
          atoms: normalizedNext.atoms,
          bonds: normalizedNext.bonds,
          arrows: normalizedNext.arrows,
          groups: normalizedNext.groups ?? [],
          textBoxes: normalizedNext.textBoxes ?? [],
          chemDrawDocument: nextDocument,
          previewChemDrawDocument: null,
          selectionPreviewTransform: null,
          pageSetup: resolveDocumentPageSetup(nextDocument, s.appPreferences),
          documentRevision: s.documentRevision + 1,
          projectionRevision: s.projectionRevision + 1,
          ...nextDocumentMeta,
        };
      }
      return {};
    }),

  selectAll: () =>
    set((s) => {
      const nativeOnlyObjectIds =
        s.chemDrawDocument?.pages[0]?.objects
          .filter(
            (object) =>
              object.type === 'graphic' ||
              object.type === 'bracket' ||
              object.type === 'embedded-object' ||
              object.type === 'table' ||
              object.type === 'group',
          )
          .map((object) => object.id) ?? [];
      return {
        selectedObjectIds: new Set([
          ...s.atoms.map((a) => a.id),
          ...s.bonds.map((b) => b.id),
          ...s.arrows.map((a) => a.id),
          ...s.textBoxes.map((t) => t.id),
          ...nativeOnlyObjectIds,
        ]),
        selectedAtomIds: new Set(s.atoms.map((a) => a.id)),
        selectedBondIds: new Set(s.bonds.map((b) => b.id)),
        selectedArrowIds: new Set(s.arrows.map((a) => a.id)),
        selectedTextBoxIds: new Set(s.textBoxes.map((t) => t.id)),
      };
    }),

  deselectAll: () =>
    set({
      selectedObjectIds: new Set(),
      selectedAtomIds: new Set(),
      selectedBondIds: new Set(),
      selectedArrowIds: new Set(),
      selectedTextBoxIds: new Set(),
    }),

  clearCanvas: () => {
    const emptyState = { atoms: [], bonds: [], arrows: [], groups: [], textBoxes: [] };
    const emptyDocument = canvasStateToChemDrawDocument(emptyState, {
      documentStyleSettings: get().appPreferences.drawing,
      pageSetup: get().appPreferences.pageSetup,
    }).document;
    const emptyDocumentMeta = describeDocumentState(emptyDocument);
    set({
      history: [emptyState],
      documentHistory: [emptyDocument],
      historyIndex: 0,
      atoms: [],
      bonds: [],
      arrows: [],
      groups: [],
      textBoxes: [],
      selectedAtomIds: new Set(),
      selectedBondIds: new Set(),
      selectedArrowIds: new Set(),
      selectedTextBoxIds: new Set(),
      selectedObjectIds: new Set(),
      chemDrawDocument: emptyDocument,
      previewChemDrawDocument: null,
      selectionPreviewTransform: null,
      documentStyleSettings: get().appPreferences.drawing,
      textFormat: buildTextFormatFromDocumentSettings(get().appPreferences.drawing),
      pageSetup: get().appPreferences.pageSetup,
      chemDrawWarnings: [],
      documentRevision: get().documentRevision + 1,
      projectionRevision: get().projectionRevision + 1,
      ...emptyDocumentMeta,
    });
  },

  setSelectedObjectIds: (selectedObjectIds) => set({ selectedObjectIds }),
  setSelectedAtomIds: (selectedAtomIds) =>
    set((s) => ({
      selectedAtomIds,
      selectedObjectIds: new Set([
        ...selectedAtomIds,
        ...s.selectedBondIds,
        ...s.selectedArrowIds,
        ...s.selectedTextBoxIds,
      ]),
    })),
  setSelectedBondIds: (selectedBondIds) =>
    set((s) => ({
      selectedBondIds,
      selectedObjectIds: new Set([
        ...s.selectedAtomIds,
        ...selectedBondIds,
        ...s.selectedArrowIds,
        ...s.selectedTextBoxIds,
      ]),
    })),
  setSelectedArrowIds: (selectedArrowIds) =>
    set((s) => ({
      selectedArrowIds,
      selectedObjectIds: new Set([
        ...s.selectedAtomIds,
        ...s.selectedBondIds,
        ...selectedArrowIds,
        ...s.selectedTextBoxIds,
      ]),
    })),
  setSelectedTextBoxIds: (selectedTextBoxIds) =>
    set((s) => ({
      selectedTextBoxIds,
      selectedObjectIds: new Set([
        ...s.selectedAtomIds,
        ...s.selectedBondIds,
        ...s.selectedArrowIds,
        ...selectedTextBoxIds,
      ]),
    })),
  setLastInteractedAtomId: (lastInteractedAtomId) => set({ lastInteractedAtomId }),
  setCanvasSize: (canvasSize) => set({ canvasSize }),
  setPageSetup: (pageSetup) =>
    set((s) => {
      const nextDocument = s.chemDrawDocument
        ? applyDocumentPageSetup(s.chemDrawDocument, pageSetup)
        : s.chemDrawDocument;
      return {
        pageSetup,
        chemDrawDocument: nextDocument,
        previewChemDrawDocument: null,
        selectionPreviewTransform: null,
        documentRevision: s.documentRevision + 1,
        ...describeDocumentState(nextDocument),
      };
    }),
  setChemDrawDocument: (chemDrawDocument) =>
    set((s) => {
      const nextDocument = chemDrawDocument
        ? applyDocumentPageSetup(
            applyDocumentViewSettings(
              applyDocumentStyleSettings(
                chemDrawDocument,
                resolveDocumentStyleSettings(chemDrawDocument, get().appPreferences),
              ),
              resolveDocumentViewSettings(chemDrawDocument, get().appPreferences),
            ),
            resolveDocumentPageSetup(chemDrawDocument, get().appPreferences),
          )
        : chemDrawDocument;
      return {
        chemDrawDocument: nextDocument,
        documentStyleSettings: resolveDocumentStyleSettings(chemDrawDocument, get().appPreferences),
        documentViewSettings: resolveDocumentViewSettings(chemDrawDocument, get().appPreferences),
        pageSetup: resolveDocumentPageSetup(chemDrawDocument, get().appPreferences),
        textFormat: buildTextFormatFromDocumentSettings(
          resolveDocumentStyleSettings(chemDrawDocument, get().appPreferences),
        ),
        previewChemDrawDocument: null,
        selectionPreviewTransform: null,
        documentRevision: s.documentRevision + 1,
        ...describeDocumentState(nextDocument),
        ...(chemDrawDocument ? {} : { documentHistory: [] }),
      };
    }),
  setPreviewChemDrawDocument: (previewChemDrawDocument) =>
    set({
      previewChemDrawDocument,
      selectionPreviewTransform: null,
      ...describeDocumentState(previewChemDrawDocument ?? get().chemDrawDocument),
    }),
  clearPreviewChemDrawDocument: () =>
    set({
      previewChemDrawDocument: null,
      selectionPreviewTransform: null,
      ...describeDocumentState(get().chemDrawDocument),
    }),
  setSelectionPreviewTransform: (selectionPreviewTransform) =>
    set({ selectionPreviewTransform, previewChemDrawDocument: null }),
  clearSelectionPreviewTransform: () => set({ selectionPreviewTransform: null }),
  setChemDrawWarnings: (chemDrawWarnings) => set({ chemDrawWarnings }),

  // ── Viewer actions ───────────────────────────────────────────────────────────
  setViewerSmiles: (viewerSmiles) => set({ viewerSmiles }),
  setViewerGeometrySmiles: (viewerGeometrySmiles) => set({ viewerGeometrySmiles }),
  setViewerGeometryMolblock: (viewerGeometryMolblock) => set({ viewerGeometryMolblock }),
  setViewerMolblock: (viewerMolblock) => set({ viewerMolblock }),
  setViewerStructureStatus: (viewerStructureStatus) => set({ viewerStructureStatus }),
  setViewerAtomIndexById: (viewerAtomIndexById) => set({ viewerAtomIndexById }),
  setViewerAtomIdByMapNumber: (viewerAtomIdByMapNumber) => set({ viewerAtomIdByMapNumber }),
  setHoveredCanvasAtomId: (hoveredCanvasAtomId) => set({ hoveredCanvasAtomId }),
  setHoveredCanvasBondId: (hoveredCanvasBondId) => set({ hoveredCanvasBondId }),
  setEditableSmiles: (editableSmiles) => set({ editableSmiles }),
  setIsInputFocused: (isInputFocused) => set({ isInputFocused }),
  setPreviewMode: (previewMode) => set({ previewMode }),
  setShowViewer: (showViewer) => set({ showViewer }),
  setViewerMode: (viewerMode) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, mode: viewerMode },
      };
      persistPreferences(appPreferences);
      return { viewerMode, appPreferences };
    }),
  setViewerPos: (viewerPos) => set({ viewerPos }),
  setViewerSize: (viewerSize) => set({ viewerSize }),
  setSplitWidth: (splitWidth) => set({ splitWidth }),
  setMinimizeGeometry: (minimizeGeometry) => set({ minimizeGeometry }),
  setRawConformer: (rawConformer) => set({ rawConformer }),
  setViewerHoveredAtomIdx: (viewerHoveredAtomIdx) => set({ viewerHoveredAtomIdx }),
  setViewerSelectedAtomIdx: (viewerSelectedAtomIdx) => set({ viewerSelectedAtomIdx }),
  setViewerRepresentation: (viewerRepresentation) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, representation: viewerRepresentation },
      };
      persistPreferences(appPreferences);
      return { viewerRepresentation, appPreferences };
    }),
  setViewerSpin: (viewerSpin) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, spin: viewerSpin },
      };
      persistPreferences(appPreferences);
      return { viewerSpin, appPreferences };
    }),
  setViewerSpinSpeed: (viewerSpinSpeed) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, spinSpeed: viewerSpinSpeed },
      };
      persistPreferences(appPreferences);
      return { viewerSpinSpeed, appPreferences };
    }),
  setViewerForceField: (viewerForceField) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, forceField: viewerForceField },
      };
      persistPreferences(appPreferences);
      return { viewerForceField, appPreferences };
    }),
  setViewerMultiConformer: (viewerMultiConformer) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, multiConformer: viewerMultiConformer },
      };
      persistPreferences(appPreferences);
      return { viewerMultiConformer, appPreferences };
    }),
  setViewerMaxConformers: (viewerMaxConformers) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, maxConformers: viewerMaxConformers },
      };
      persistPreferences(appPreferences);
      return { viewerMaxConformers, appPreferences };
    }),
  setViewerShowAtomNumbers: (viewerShowAtomNumbers) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, showAtomNumbers: viewerShowAtomNumbers },
      };
      persistPreferences(appPreferences);
      return { viewerShowAtomNumbers, appPreferences };
    }),
  setViewerShowAtomLabels: (viewerShowAtomLabels) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, showAtomLabels: viewerShowAtomLabels },
      };
      persistPreferences(appPreferences);
      return { viewerShowAtomLabels, appPreferences };
    }),
  setViewerShowMeasureToolbar: (viewerShowMeasureToolbar) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, showMeasureToolbar: viewerShowMeasureToolbar },
      };
      persistPreferences(appPreferences);
      return { viewerShowMeasureToolbar, appPreferences };
    }),
  setViewerAtomScale: (viewerAtomScale) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, atomScale: viewerAtomScale },
      };
      persistPreferences(appPreferences);
      return { viewerAtomScale, appPreferences };
    }),
  setViewerBondScale: (viewerBondScale) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, bondScale: viewerBondScale },
      };
      persistPreferences(appPreferences);
      return { viewerBondScale, appPreferences };
    }),
  setViewerPerspectiveFov: (viewerPerspectiveFov) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, perspectiveFov: viewerPerspectiveFov },
      };
      persistPreferences(appPreferences);
      return { viewerPerspectiveFov, appPreferences };
    }),
  setViewerBackgroundColor: (viewerBackgroundColor) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, backgroundColor: viewerBackgroundColor },
      };
      persistPreferences(appPreferences);
      return { viewerBackgroundColor, appPreferences };
    }),
  setViewerBondColor: (viewerBondColor) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, bondColor: viewerBondColor },
      };
      persistPreferences(appPreferences);
      return { viewerBondColor, appPreferences };
    }),
  setViewerAmbientLightIntensity: (viewerAmbientLightIntensity) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, ambientLightIntensity: viewerAmbientLightIntensity },
      };
      persistPreferences(appPreferences);
      return { viewerAmbientLightIntensity, appPreferences };
    }),
  setViewerHemiLightIntensity: (viewerHemiLightIntensity) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, hemiLightIntensity: viewerHemiLightIntensity },
      };
      persistPreferences(appPreferences);
      return { viewerHemiLightIntensity, appPreferences };
    }),
  setViewerKeyLightIntensity: (viewerKeyLightIntensity) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, keyLightIntensity: viewerKeyLightIntensity },
      };
      persistPreferences(appPreferences);
      return { viewerKeyLightIntensity, appPreferences };
    }),
  setViewerFillLightIntensity: (viewerFillLightIntensity) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, fillLightIntensity: viewerFillLightIntensity },
      };
      persistPreferences(appPreferences);
      return { viewerFillLightIntensity, appPreferences };
    }),
  setViewerRimLightIntensity: (viewerRimLightIntensity) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: { ...s.appPreferences.viewer, rimLightIntensity: viewerRimLightIntensity },
      };
      persistPreferences(appPreferences);
      return { viewerRimLightIntensity, appPreferences };
    }),
  setViewerOrbitalBasis: (viewerOrbitalBasis) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: {
          ...s.appPreferences.viewer,
          orbitals: { ...s.appPreferences.viewer.orbitals, basis: viewerOrbitalBasis },
        },
      };
      persistPreferences(appPreferences);
      return { viewerOrbitalBasis, appPreferences };
    }),
  setViewerOrbitalOpacity: (viewerOrbitalOpacity) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: {
          ...s.appPreferences.viewer,
          orbitals: { ...s.appPreferences.viewer.orbitals, opacity: viewerOrbitalOpacity },
        },
      };
      persistPreferences(appPreferences);
      return { viewerOrbitalOpacity, appPreferences };
    }),
  setViewerOrbitalPositiveColor: (viewerOrbitalPositiveColor) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: {
          ...s.appPreferences.viewer,
          orbitals: {
            ...s.appPreferences.viewer.orbitals,
            positiveColor: viewerOrbitalPositiveColor,
          },
        },
      };
      persistPreferences(appPreferences);
      return { viewerOrbitalPositiveColor, appPreferences };
    }),
  setViewerOrbitalNegativeColor: (viewerOrbitalNegativeColor) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: {
          ...s.appPreferences.viewer,
          orbitals: {
            ...s.appPreferences.viewer.orbitals,
            negativeColor: viewerOrbitalNegativeColor,
          },
        },
      };
      persistPreferences(appPreferences);
      return { viewerOrbitalNegativeColor, appPreferences };
    }),
  setViewerOrbitalMaterial: (viewerOrbitalMaterial) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: {
          ...s.appPreferences.viewer,
          orbitals: { ...s.appPreferences.viewer.orbitals, material: viewerOrbitalMaterial },
        },
      };
      persistPreferences(appPreferences);
      return { viewerOrbitalMaterial, appPreferences };
    }),
  setViewerOrbitalOutline: (viewerOrbitalOutline) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: {
          ...s.appPreferences.viewer,
          orbitals: { ...s.appPreferences.viewer.orbitals, outline: viewerOrbitalOutline },
        },
      };
      persistPreferences(appPreferences);
      return { viewerOrbitalOutline, appPreferences };
    }),
  setViewerOrbitalIsovalue: (viewerOrbitalIsovalue) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: {
          ...s.appPreferences.viewer,
          orbitals: { ...s.appPreferences.viewer.orbitals, isovalue: viewerOrbitalIsovalue },
        },
      };
      persistPreferences(appPreferences);
      return { viewerOrbitalIsovalue, appPreferences };
    }),
  setViewerOrbitalShowPositivePhase: (viewerOrbitalShowPositivePhase) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: {
          ...s.appPreferences.viewer,
          orbitals: {
            ...s.appPreferences.viewer.orbitals,
            showPositivePhase: viewerOrbitalShowPositivePhase,
          },
        },
      };
      persistPreferences(appPreferences);
      return { viewerOrbitalShowPositivePhase, appPreferences };
    }),
  setViewerOrbitalShowNegativePhase: (viewerOrbitalShowNegativePhase) =>
    set((s) => {
      const appPreferences = {
        ...s.appPreferences,
        viewer: {
          ...s.appPreferences.viewer,
          orbitals: {
            ...s.appPreferences.viewer.orbitals,
            showNegativePhase: viewerOrbitalShowNegativePhase,
          },
        },
      };
      persistPreferences(appPreferences);
      return { viewerOrbitalShowNegativePhase, appPreferences };
    }),

  // ── UI actions ───────────────────────────────────────────────────────────────
  hydrateAppPreferences: (appPreferences) =>
    set((s) => ({
      appPreferences,
      preferencesHydrated: true,
      isDarkMode: appPreferences.isDarkMode,
      showGrid: appPreferences.showGrid,
      showHydrogens: appPreferences.showHydrogens,
      pageSetup: resolveDocumentPageSetup(s.chemDrawDocument, appPreferences),
      viewerMode: appPreferences.viewer.mode,
      viewerRepresentation: appPreferences.viewer.representation,
      viewerSpin: appPreferences.viewer.spin,
      viewerSpinSpeed: appPreferences.viewer.spinSpeed,
      viewerForceField: appPreferences.viewer.forceField,
      viewerMultiConformer: appPreferences.viewer.multiConformer,
      viewerMaxConformers: appPreferences.viewer.maxConformers,
      viewerShowAtomNumbers: appPreferences.viewer.showAtomNumbers,
      viewerShowAtomLabels: appPreferences.viewer.showAtomLabels,
      viewerShowMeasureToolbar: appPreferences.viewer.showMeasureToolbar,
      viewerAtomScale: appPreferences.viewer.atomScale,
      viewerBondScale: appPreferences.viewer.bondScale,
      viewerPerspectiveFov: appPreferences.viewer.perspectiveFov,
      viewerBackgroundColor: appPreferences.viewer.backgroundColor,
      viewerBondColor: appPreferences.viewer.bondColor,
      viewerAmbientLightIntensity: appPreferences.viewer.ambientLightIntensity,
      viewerHemiLightIntensity: appPreferences.viewer.hemiLightIntensity,
      viewerKeyLightIntensity: appPreferences.viewer.keyLightIntensity,
      viewerFillLightIntensity: appPreferences.viewer.fillLightIntensity,
      viewerRimLightIntensity: appPreferences.viewer.rimLightIntensity,
      viewerOrbitalBasis: appPreferences.viewer.orbitals.basis,
      viewerOrbitalOpacity: appPreferences.viewer.orbitals.opacity,
      viewerOrbitalPositiveColor: appPreferences.viewer.orbitals.positiveColor,
      viewerOrbitalNegativeColor: appPreferences.viewer.orbitals.negativeColor,
      viewerOrbitalMaterial: appPreferences.viewer.orbitals.material,
      viewerOrbitalOutline: appPreferences.viewer.orbitals.outline,
      viewerOrbitalIsovalue: appPreferences.viewer.orbitals.isovalue,
      viewerOrbitalShowPositivePhase: appPreferences.viewer.orbitals.showPositivePhase,
      viewerOrbitalShowNegativePhase: appPreferences.viewer.orbitals.showNegativePhase,
      documentStyleSettings: resolveDocumentStyleSettings(s.chemDrawDocument, appPreferences),
      documentViewSettings: resolveDocumentViewSettings(s.chemDrawDocument, appPreferences),
      textFormat: buildTextFormatFromDocumentSettings(
        resolveDocumentStyleSettings(s.chemDrawDocument, appPreferences),
      ),
    })),
  setAppPreferences: (appPreferences) => {
    persistPreferences(appPreferences);
    get().hydrateAppPreferences(appPreferences);
  },
  setDocumentStyleSettings: (documentStyleSettings) =>
    set((s) => {
      const normalizedDocumentStyleSettings = normalizeDocumentStyleSettings(documentStyleSettings);
      const resolvedTextFormat = buildTextFormatFromDocumentSettings(
        normalizedDocumentStyleSettings,
      );
      const appPreferences = { ...s.appPreferences, drawing: normalizedDocumentStyleSettings };
      persistPreferences(appPreferences);
      return {
        documentStyleSettings: normalizedDocumentStyleSettings,
        textFormat: {
          ...s.textFormat,
          fontFamily: resolvedTextFormat.fontFamily,
          fontSize: resolvedTextFormat.fontSize,
          color: resolvedTextFormat.color,
          textAlign: resolvedTextFormat.textAlign,
        },
        appPreferences,
        chemDrawDocument: s.chemDrawDocument
          ? applyDocumentStyleSettings(s.chemDrawDocument, normalizedDocumentStyleSettings)
          : s.chemDrawDocument,
      };
    }),
  setDocumentViewSettings: (documentViewSettings) =>
    set((s) => {
      const normalizedDocumentViewSettings = normalizeDocumentViewSettings(documentViewSettings);
      return {
        documentViewSettings: normalizedDocumentViewSettings,
        chemDrawDocument: s.chemDrawDocument
          ? applyDocumentViewSettings(s.chemDrawDocument, normalizedDocumentViewSettings)
          : s.chemDrawDocument,
      };
    }),
  applyDefaultsToCurrentDocument: () => {
    const {
      atoms,
      bonds,
      arrows,
      groups,
      textBoxes,
      appPreferences,
      documentStyleSettings,
      setPageSetup,
      setDocumentStyleSettings,
      pushToHistory,
    } = get();
    const nextSettings = appPreferences.drawing;
    setDocumentStyleSettings(nextSettings);
    setPageSetup(appPreferences.pageSetup);
    pushToHistory(
      applyDocumentStyleSettingsToCanvas(
        { atoms, bonds, arrows, groups, textBoxes },
        documentStyleSettings,
        nextSettings,
      ),
    );
  },
  setIsDarkMode: (isDarkMode) =>
    set((s) => {
      const appPreferences = { ...s.appPreferences, isDarkMode };
      persistPreferences(appPreferences);
      return { isDarkMode, appPreferences };
    }),
  setShowGrid: (showGrid) =>
    set((s) => {
      const appPreferences = { ...s.appPreferences, showGrid };
      persistPreferences(appPreferences);
      return { showGrid, appPreferences };
    }),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
  setEditMenusHidden: (editMenusHidden) => set({ editMenusHidden }),
  setShowBondMenu: (showBondMenu) => set({ showBondMenu }),
  setShowSmilesBar: (showSmilesBar) => set({ showSmilesBar }),
  setIsFileDropdownOpen: (isFileDropdownOpen) => set({ isFileDropdownOpen }),
  setIsExportSubmenuOpen: (isExportSubmenuOpen) => set({ isExportSubmenuOpen }),
  setIsEditDropdownOpen: (isEditDropdownOpen) => set({ isEditDropdownOpen }),
  setIsAlignSubmenuOpen: (isAlignSubmenuOpen) => set({ isAlignSubmenuOpen }),
  setIsSettingsDropdownOpen: (isSettingsDropdownOpen) => set({ isSettingsDropdownOpen }),
  setIsPreferencesPanelOpen: (isPreferencesPanelOpen) => set({ isPreferencesPanelOpen }),
  setIsPeriodicTableOpen: (isPeriodicTableOpen) => set({ isPeriodicTableOpen }),
  setIsAboutOpen: (isAboutOpen) => set({ isAboutOpen }),
  setIsViewerSettingsOpen: (isViewerSettingsOpen) => set({ isViewerSettingsOpen }),
  setIsCalculateDropdownOpen: (isCalculateDropdownOpen) => set({ isCalculateDropdownOpen }),
  setShowPropertiesPanel: (showPropertiesPanel) => set({ showPropertiesPanel }),
  setShowIrPanel: (showIrPanel) => set({ showIrPanel }),
  setShowNmrPanel: (showNmrPanel) => set({ showNmrPanel }),
  setShowMsPanel: (showMsPanel) => set({ showMsPanel }),
  setPropertiesPos: (propertiesPos) => set({ propertiesPos }),
  setIrPos: (irPos) => set({ irPos }),
  setNmrPos: (nmrPos) => set({ nmrPos }),
  setMsPos: (msPos) => set({ msPos }),
  setPropertiesSize: (propertiesSize) => set({ propertiesSize }),
  setIrSize: (irSize) => set({ irSize }),
  setNmrSize: (nmrSize) => set({ nmrSize }),
  setMsSize: (msSize) => set({ msSize }),
  setMoleculeProperties: (moleculeProperties) => set({ moleculeProperties }),
  setIrSpectrum: (irSpectrum) => set({ irSpectrum }),
  setNmrSpectrum: (nmrSpectrum) => set({ nmrSpectrum }),
  setMsSpectrum: (msSpectrum) => set({ msSpectrum }),
  toggleSection: (name) =>
    set((s) => {
      const next = new Set(s.collapsedSections);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return { collapsedSections: next };
    }),
  setLicensesText: (licensesText) => set({ licensesText }),
  setTextFormat: (fmt) =>
    set((s) => {
      const textFormat = { ...s.textFormat, ...fmt };
      const documentStyleSettings = normalizeDocumentStyleSettings({
        ...s.documentStyleSettings,
        textFormat: {
          fontFamily: textFormat.fontFamily,
          fontSize: textFormat.fontSize,
          color: textFormat.color,
          textAlign: textFormat.textAlign,
        },
      });
      const resolvedTextFormat = buildTextFormatFromDocumentSettings(documentStyleSettings);
      const appPreferences = { ...s.appPreferences, drawing: documentStyleSettings };
      persistPreferences(appPreferences);
      return {
        textFormat: {
          ...textFormat,
          fontFamily: resolvedTextFormat.fontFamily,
          fontSize: resolvedTextFormat.fontSize,
          color: resolvedTextFormat.color,
          textAlign: resolvedTextFormat.textAlign,
        },
        documentStyleSettings,
        appPreferences,
      };
    }),

  groupSelected: () => {
    const { chemDrawDocument, selectedObjectIds } = get();
    if (chemDrawDocument && selectedObjectIds.size >= 2) {
      const nextDocument = createGroupFromSelection(chemDrawDocument, selectedObjectIds);
      set({ chemDrawDocument: nextDocument, previewChemDrawDocument: null });
      get().pushToHistory(chemDrawDocumentToCanvasState(nextDocument).state);
      return;
    }
    const {
      atoms,
      bonds,
      arrows,
      groups,
      textBoxes,
      selectedAtomIds,
      selectedArrowIds,
      selectedTextBoxIds,
      pushToHistory,
    } = get();
    const hasAtoms = selectedAtomIds.size > 0;
    const hasArrows = selectedArrowIds.size > 0;
    const hasTextBoxes = selectedTextBoxIds.size > 0;
    const totalItems = selectedAtomIds.size + selectedArrowIds.size + selectedTextBoxIds.size;
    if (totalItems < 2) return;
    const childGroups = hasAtoms
      ? groups.filter((g) => g.atomIds.every((id) => selectedAtomIds.has(id)))
      : [];
    const childGroupIds = childGroups.length > 0 ? childGroups.map((g) => g.id) : undefined;
    const keptGroups = groups.filter(
      (g) =>
        !g.atomIds.some((id) => selectedAtomIds.has(id)) ||
        g.atomIds.every((id) => selectedAtomIds.has(id)),
    );
    const newGroup: Group = {
      id: crypto.randomUUID(),
      atomIds: [...selectedAtomIds],
      childGroupIds,
      arrowIds: hasArrows ? [...selectedArrowIds] : undefined,
      textBoxIds: hasTextBoxes ? [...selectedTextBoxIds] : undefined,
    };
    pushToHistory({ atoms, bonds, arrows, groups: [...keptGroups, newGroup], textBoxes });
  },

  ungroupSelected: () => {
    const { chemDrawDocument, selectedObjectIds } = get();
    if (chemDrawDocument && selectedObjectIds.size > 0) {
      const nextDocument = removeGroupsFromSelection(chemDrawDocument, selectedObjectIds);
      set({ chemDrawDocument: nextDocument, previewChemDrawDocument: null });
      get().pushToHistory(chemDrawDocumentToCanvasState(nextDocument).state);
      return;
    }
    const { atoms, bonds, arrows, groups, textBoxes, selectedAtomIds, pushToHistory } = get();
    const overlapping = groups
      .filter((g) => g.atomIds.some((id) => selectedAtomIds.has(id)))
      .sort((a, b) => b.atomIds.length - a.atomIds.length);
    if (!overlapping.length) return;
    const removed = overlapping[0];
    const newGroups = groups
      .filter((g) => g.id !== removed.id)
      .map((g) => ({ ...g, childGroupIds: g.childGroupIds?.filter((id) => id !== removed.id) }));
    pushToHistory({ atoms, bonds, arrows, groups: newGroups, textBoxes });
  },

  alignSelection: (op: AlignOp) => {
    const { chemDrawDocument, selectedObjectIds } = get();
    if (chemDrawDocument && selectedObjectIds.size > 1) {
      const nextDocument = alignSelectedObjects(chemDrawDocument, selectedObjectIds, op);
      set({ chemDrawDocument: nextDocument, previewChemDrawDocument: null });
      get().pushToHistory(chemDrawDocumentToCanvasState(nextDocument).state);
      return;
    }
    const {
      atoms,
      bonds,
      arrows,
      groups,
      textBoxes,
      selectedAtomIds,
      selectedArrowIds,
      selectedTextBoxIds,
      pushToHistory,
    } = get();
    const units = buildAlignmentUnits(
      atoms,
      bonds,
      arrows,
      selectedAtomIds,
      selectedArrowIds,
      groups,
      textBoxes,
      selectedTextBoxIds,
    );
    if (units.length < 2) return;
    const {
      atoms: newAtoms,
      arrows: newArrows,
      textBoxes: newTextBoxes,
    } = applyAlignment(atoms, arrows, units, op, textBoxes);
    pushToHistory({ atoms: newAtoms, bonds, arrows: newArrows, groups, textBoxes: newTextBoxes });
  },

  dispatchEditorCommand: (command) => {
    const {
      chemDrawDocument,
      atoms,
      bonds,
      arrows,
      groups,
      textBoxes,
      documentStyleSettings,
      pageSetup,
      selectedObjectIds,
      selectedAtomIds,
      selectedBondIds,
      selectedArrowIds,
      selectedTextBoxIds,
      pushToHistory,
      setChemDrawDocument,
    } = get();
    const document = createEditorSessionState({
      document: chemDrawDocument,
      canvasState: { atoms, bonds, arrows, groups, textBoxes },
      selection: {
        objectIds: selectedObjectIds,
        atomIds: selectedAtomIds,
        bondIds: selectedBondIds,
        arrowIds: selectedArrowIds,
        textBoxIds: selectedTextBoxIds,
      },
      documentStyleSettings,
      pageSetup,
    }).document;
    if (!document) return;
    const context = createEditorCommandContext({
      activePageId: document.pages[0]?.id ?? null,
      documentStyleSettings,
      pageSetup,
      selection: {
        objectIds: selectedObjectIds,
        atomIds: selectedAtomIds,
        bondIds: selectedBondIds,
        arrowIds: selectedArrowIds,
        textBoxIds: selectedTextBoxIds,
      },
    });
    const result = applyEditorCommand(document, command, context);
    setChemDrawDocument(result.document);
    pushToHistory(chemDrawDocumentToCanvasState(result.document).state);
  },

  runEditorTransaction: (transaction) => {
    const {
      chemDrawDocument,
      atoms,
      bonds,
      arrows,
      groups,
      textBoxes,
      documentStyleSettings,
      pageSetup,
      selectedObjectIds,
      selectedAtomIds,
      selectedBondIds,
      selectedArrowIds,
      selectedTextBoxIds,
      pushToHistory,
      setChemDrawDocument,
    } = get();
    const document = createEditorSessionState({
      document: chemDrawDocument,
      canvasState: { atoms, bonds, arrows, groups, textBoxes },
      selection: {
        objectIds: selectedObjectIds,
        atomIds: selectedAtomIds,
        bondIds: selectedBondIds,
        arrowIds: selectedArrowIds,
        textBoxIds: selectedTextBoxIds,
      },
      documentStyleSettings,
      pageSetup,
    }).document;
    if (!document) return;
    const context = createEditorCommandContext({
      activePageId: document.pages[0]?.id ?? null,
      documentStyleSettings,
      pageSetup,
      selection: {
        objectIds: selectedObjectIds,
        atomIds: selectedAtomIds,
        bondIds: selectedBondIds,
        arrowIds: selectedArrowIds,
        textBoxIds: selectedTextBoxIds,
      },
    });
    const result = applyEditorTransaction(document, transaction, context);
    setChemDrawDocument(result.document);
    pushToHistory(chemDrawDocumentToCanvasState(result.document).state);
  },

  closeAllMenus: () =>
    set({
      isFileDropdownOpen: false,
      isExportSubmenuOpen: false,
      isEditDropdownOpen: false,
      isAlignSubmenuOpen: false,
      isSettingsDropdownOpen: false,
      isPreferencesPanelOpen: false,
      isCalculateDropdownOpen: false,
      showBondMenu: false,
      isPeriodicTableOpen: false,
      isViewerSettingsOpen: false,
    }),

  showToast: (message, type = 'error') => {
    const id = Date.now() + Math.random();
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => get().dismissToast(id), 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export function selectEditorSessionState(
  state: AppState,
  viewport: Partial<EditorSessionState['viewport']>,
): EditorSessionState {
  return createEditorSessionState({
    document: state.previewChemDrawDocument ?? state.chemDrawDocument,
    canvasState: {
      atoms: state.atoms,
      bonds: state.bonds,
      arrows: state.arrows,
      groups: state.groups,
      textBoxes: state.textBoxes,
    },
    selection: {
      objectIds: state.selectedObjectIds,
      atomIds: state.selectedAtomIds,
      bondIds: state.selectedBondIds,
      arrowIds: state.selectedArrowIds,
      textBoxIds: state.selectedTextBoxIds,
      hoveredObjectId: state.hoveredCanvasAtomId ?? state.hoveredCanvasBondId ?? null,
    },
    viewport,
    activeTool: state.tool,
    editMenusHidden: state.editMenusHidden,
    previewMode: state.previewMode,
    showViewer: state.showViewer,
    viewerMode: state.viewerMode,
    documentStyleSettings: state.documentStyleSettings,
    pageSetup: state.pageSetup,
    revision: state.documentRevision,
  });
}
