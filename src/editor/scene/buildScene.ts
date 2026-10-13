import type { Arrow, Atom, Bond, Group, TextBox } from '../../types/chemistry';
import type {
  ChemDrawArrow,
  ChemDrawBond,
  ChemDrawDocument,
  ChemDrawNode,
} from '../../types/chemdraw';
import type { DocumentStyleSettings, DocumentViewSettings, PageSetup } from '../../types/settings';
import { convertNativeToCanvas } from '../../lib/chemdrawMetrics';
import {
  computeAllBondVisibleIntervals,
  computeRingCentroids,
  type AtomLabelMetricsCache,
} from '../../lib/renderGeometry';
import { buildDocumentIndex, buildDocumentIndexUncached } from '../document';
import type { DocumentSceneState, LegacyCanvasSceneState } from './types';

export interface SceneCanvasState {
  atoms: Atom[];
  bonds: Bond[];
  arrows: Arrow[];
  groups: Group[];
  textBoxes: TextBox[];
}

/**
 * The parts of {@link DocumentSceneState} that describe editing intent rather than content.
 *
 * Headless callers (tests, the golden harness, export) leave these at their defaults; the app
 * supplies live selection and hover state.
 */
export interface SceneInteractionState {
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
  showValenceErrors: boolean;
}

export interface BuildSceneInput {
  document: ChemDrawDocument | null;
  canvasState: SceneCanvasState;
  documentStyleSettings: DocumentStyleSettings;
  documentViewSettings: DocumentViewSettings;
  pageSetup: PageSetup;
  interaction?: Partial<SceneInteractionState>;
  /** Opt-out for parity tests and the opt-in benchmark. */
  useCache?: boolean;
}

function defaultInteractionState(): SceneInteractionState {
  return {
    isDarkMode: false,
    showHydrogens: true,
    selectedAtomIds: new Set(),
    selectedBondIds: new Set(),
    selectedArrowIds: new Set(),
    selectedTextBoxIds: new Set(),
    selectedObjectIds: new Set(),
    fullySelectedComponentAtomIds: new Set(),
    hiddenObjectIds: new Set(),
    hoveredAtomId: null,
    hoveredBondId: null,
    hoveredArrowId: null,
    hoveredTextBoxId: null,
    hoveredNativeObjectId: null,
    editingTextBoxId: null,
    rdkitInvalidAtomIds: new Set(),
    showValenceErrors: false,
  };
}

function indexNativeObjects(document: ChemDrawDocument | null) {
  const objects = document?.pages[0]?.objects ?? [];
  const nativeNodes = new Map<string, ChemDrawNode>();
  const nativeBonds = new Map<string, ChemDrawBond>();
  const nativeArrows = new Map<string, ChemDrawArrow>();
  for (const object of objects) {
    if (object.type === 'node') nativeNodes.set(object.id, object);
    else if (object.type === 'bond') nativeBonds.set(object.id, object);
    else if (object.type === 'arrow') nativeArrows.set(object.id, object);
  }
  return { nativeNodes, nativeBonds, nativeArrows };
}

/**
 * Derives the flat-array half of the scene state.
 *
 * This is deliberately free of React and of the DOM so the same assembly runs in the app, in
 * `node --test`, and in the golden harness. The geometry helpers it calls
 * (`computeRingCentroids`, `computeBondVisibleIntervals`) are the same ones `svgExport` uses, so
 * there is no second implementation to keep in sync.
 */
export function buildLegacySceneStateUncached(
  canvasState: SceneCanvasState,
  document: ChemDrawDocument | null,
  documentStyleSettings: DocumentStyleSettings,
): LegacyCanvasSceneState {
  const { atoms, bonds, arrows, groups, textBoxes } = canvasState;
  const { nativeNodes, nativeBonds, nativeArrows } = indexNativeObjects(document);

  const bondsByAtomId = new Map<string, Bond[]>();
  for (const atom of atoms) bondsByAtomId.set(atom.id, []);
  for (const bond of bonds) {
    bondsByAtomId.get(bond.from)?.push(bond);
    bondsByAtomId.get(bond.to)?.push(bond);
  }

  const resolveLineWidth = (bond: Bond) => {
    if (bond.lineWidth != null) return bond.lineWidth;
    const nativeLineWidth = nativeBonds.get(bond.id)?.style?.lineWidth;
    return nativeLineWidth != null
      ? convertNativeToCanvas(nativeLineWidth, documentStyleSettings)
      : documentStyleSettings.bondLineWidth;
  };

  const labelMetricsCache: AtomLabelMetricsCache = new Map();
  return {
    atoms,
    bonds,
    arrows,
    groups,
    textBoxes,
    atomById: new Map(atoms.map((atom) => [atom.id, atom])),
    bondById: new Map(bonds.map((bond) => [bond.id, bond])),
    arrowById: new Map(arrows.map((arrow) => [arrow.id, arrow])),
    textBoxById: new Map(textBoxes.map((textBox) => [textBox.id, textBox])),
    bondsByAtomId,
    nativeNodes,
    nativeBonds,
    nativeArrows,
    ringCentroids: computeRingCentroids(atoms, bonds),
    bondVisibleIntervals: computeAllBondVisibleIntervals(
      atoms,
      bonds,
      resolveLineWidth,
      documentStyleSettings,
      labelMetricsCache,
    ),
    labelMetricsCache,
  };
}

const geometryCache = new WeakMap<
  ChemDrawDocument,
  { settings: string; scene: LegacyCanvasSceneState }
>();
export function buildLegacySceneState(
  canvasState: SceneCanvasState,
  document: ChemDrawDocument | null,
  documentStyleSettings: DocumentStyleSettings,
): LegacyCanvasSceneState {
  const arrays = ['atoms', 'bonds', 'arrows', 'groups', 'textBoxes'] as const;
  if (
    !document ||
    !Object.isFrozen(document) ||
    arrays.some((key) => !Object.isFrozen(canvasState[key]))
  )
    return buildLegacySceneStateUncached(canvasState, document, documentStyleSettings);
  const settings = JSON.stringify(documentStyleSettings);
  const cached = geometryCache.get(document);
  if (
    cached?.settings === settings &&
    arrays.every((key) => cached.scene[key] === canvasState[key])
  )
    return cached.scene;
  const scene = buildLegacySceneStateUncached(canvasState, document, documentStyleSettings);
  geometryCache.set(document, { settings, scene });
  return scene;
}

/** Assembles a complete, renderable scene. See {@link buildLegacySceneState} for the constraints. */
export function buildDocumentSceneState(input: BuildSceneInput): DocumentSceneState {
  const {
    document,
    canvasState,
    documentStyleSettings,
    documentViewSettings,
    pageSetup,
    interaction,
  } = input;

  // Accept editing affordances only: a scene spread must never replace the new
  // document index or geometry projection (preview callers carry the old scene).
  const resolvedInteraction = defaultInteractionState();
  for (const key of Object.keys(resolvedInteraction) as Array<keyof SceneInteractionState>) {
    if (interaction && key in interaction)
      Object.assign(resolvedInteraction, { [key]: interaction[key] });
  }
  return {
    index: (input.useCache === false ? buildDocumentIndexUncached : buildDocumentIndex)(document, {
      documentStyleSettings,
    }),
    legacy: (input.useCache === false ? buildLegacySceneStateUncached : buildLegacySceneState)(
      canvasState,
      document,
      documentStyleSettings,
    ),
    documentStyleSettings,
    documentViewSettings,
    pageSetup,
    ...resolvedInteraction,
  };
}
