import { DEFAULT_DOUBLE_BOND_MODE } from '../../lib/renderGeometry';
import { setAliasAtomValue } from '../../lib/atomIdentity';
import type { Arrow } from '../../types/chemistry';
import type { ChemDrawDocument } from '../../types/chemdraw';
import type { SelectionPreviewTransform } from '../types';
import type { DocumentSceneState } from './types';
import { buildDocumentSceneState } from './buildScene';
import { chemDrawDocumentToCanvasState } from '../../lib/chemdrawModel';
import { createProjectionEditCommand } from '../commands/projectionEdit';
import {
  createEditorCommandContext,
  createMoveSelectionCommand,
  createRotateSelectionCommand,
  createScaleSelectionCommand,
} from '../commands';
import {
  materializeResolvedRingTemplatePlacement,
  materializeRingGeometry,
  type RingGeometry,
  type ResolvedRingTemplatePlacement,
} from '../../lib/ringTemplates';

export interface ScenePreview {
  transform: SelectionPreviewTransform | null;
  arrow: Arrow | null;
  ring:
    | { kind: 'template'; placement: ResolvedRingTemplatePlacement }
    | { kind: 'polygon'; geometry: RingGeometry }
    | null;
  line: {
    fromId: string;
    x2: number;
    y2: number;
    targetId?: string;
    element: string;
    alias?: boolean;
    order: number;
    stereo: number;
  } | null;
}

/** Preview and commit use identical document commands and identical drawing modules. */
export function buildPreviewScene(
  scene: DocumentSceneState,
  source: ChemDrawDocument | null,
  preview: ScenePreview,
): DocumentSceneState {
  if (!source || (!preview.transform && !preview.arrow && !preview.ring && !preview.line))
    return scene;
  const context = createEditorCommandContext({
    activePageId: source.pages[0]?.id ?? null,
    documentStyleSettings: scene.documentStyleSettings,
    pageSetup: scene.pageSetup,
  });
  let document = source;
  const transform = preview.transform;
  if (transform) {
    const options = { objectIds: transform.selectedObjectIds };
    const command =
      transform.kind === 'move'
        ? createMoveSelectionCommand({ dx: transform.dx, dy: transform.dy }, options)
        : transform.kind === 'rotate'
          ? createRotateSelectionCommand(transform.center, transform.radians, options)
          : createScaleSelectionCommand(transform.anchor, transform.factor, options);
    document = command.apply(document, context).document;
  }
  let state = chemDrawDocumentToCanvasState(document).state;
  if (preview.arrow)
    state = { ...state, arrows: [...state.arrows, { ...preview.arrow, id: '__preview-arrow' }] };
  if (preview.ring) {
    const ring =
      preview.ring.kind === 'template'
        ? materializeResolvedRingTemplatePlacement(preview.ring.placement, state.atoms, state.bonds)
        : (() => {
            const ring = materializeRingGeometry(preview.ring.geometry);
            return {
              atoms: [...state.atoms, ...ring.atoms],
              bonds: [...state.bonds, ...ring.bonds],
            };
          })();
    state = { ...state, ...ring };
  }
  if (preview.line && state.atoms.some((atom) => atom.id === preview.line!.fromId)) {
    const line = preview.line;
    const targetId = line.targetId ?? '__preview-target';
    if (targetId !== line.fromId) {
      const existing = state.bonds.find(
        (bond) =>
          (bond.from === line.fromId && bond.to === targetId) ||
          (bond.to === line.fromId && bond.from === targetId),
      );
      state = {
        ...state,
        atoms: line.targetId
          ? state.atoms
          : [
              ...state.atoms,
              line.alias
                ? setAliasAtomValue(
                    { id: targetId, kind: 'element', element: 'C', x: line.x2, y: line.y2 },
                    line.element,
                  )
                : { id: targetId, kind: 'element', element: line.element, x: line.x2, y: line.y2 },
            ],
        bonds: existing
          ? state.bonds.map((bond) =>
              bond.id === existing.id
                ? {
                    ...bond,
                    order: (bond.order % 3) + 1,
                    stereo: 0,
                    doubleBondMode:
                      (bond.order % 3) + 1 === 2
                        ? (bond.doubleBondMode ?? DEFAULT_DOUBLE_BOND_MODE)
                        : undefined,
                  }
                : bond,
            )
          : [
              ...state.bonds,
              {
                id: '__preview-bond',
                from: line.fromId,
                to: targetId,
                order: line.order,
                stereo: line.stereo,
                ...(line.order === 2 && line.stereo === 0
                  ? { doubleBondMode: DEFAULT_DOUBLE_BOND_MODE }
                  : {}),
              },
            ],
      };
    }
  }
  document = createProjectionEditCommand(document, state).apply(document, context).document;
  const next = buildDocumentSceneState({
    document,
    canvasState: { ...state, groups: state.groups ?? [], textBoxes: state.textBoxes ?? [] },
    documentStyleSettings: scene.documentStyleSettings,
    documentViewSettings: scene.documentViewSettings,
    pageSetup: scene.pageSetup,
    interaction: { ...scene, hiddenObjectIds: new Set() },
  });
  return next;
}
