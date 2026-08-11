import type { Arrow, Atom, Bond, Group, TextBox } from '../../types/chemistry';
import type {
  ChemDrawArrow,
  ChemDrawBond,
  ChemDrawDocument,
  ChemDrawNode,
} from '../../types/chemdraw';
import type { DocumentStyleSettings, DocumentViewSettings, PageSetup } from '../../types/settings';
import { convertNativeToCanvas } from '../../lib/chemdrawMetrics';
import { computeBondVisibleIntervals, computeRingCentroids } from '../../lib/renderGeometry';
import { buildDocumentIndex } from '../document';
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
}

export interface BuildSceneInput {
  document: ChemDrawDocument | null;
  canvasState: SceneCanvasState;
  documentStyleSettings: DocumentStyleSettings;
  documentViewSettings: DocumentViewSettings;
  pageSetup: PageSetup;
  interaction?: Partial<SceneInteractionState>;
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
export function buildLegacySceneState(
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
    bondVisibleIntervals: new Map(
      bonds.map((bond) => [
        bond.id,
        computeBondVisibleIntervals(bond, atoms, bonds, resolveLineWidth, documentStyleSettings),
      ]),
    ),
  };
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

  return {
    index: buildDocumentIndex(document, { documentStyleSettings }),
    legacy: buildLegacySceneState(canvasState, document, documentStyleSettings),
    documentStyleSettings,
    documentViewSettings,
    pageSetup,
    ...defaultInteractionState(),
    ...interaction,
  };
}
