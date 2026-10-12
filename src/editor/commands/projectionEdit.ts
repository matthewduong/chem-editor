import type { CanvasState } from '../../types/chemistry';
import type { ChemDrawDocument, ChemDrawObject } from '../../types/chemdraw';
import type { EditorCommand } from '../types';
import {
  chemDrawDocumentToCanvasState,
  mergeCanvasStateIntoChemDrawDocument,
} from '../../lib/chemdrawModel';
import { assertFiniteNumbers } from '../../lib/cdxmlValidation';

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const entries = (state: CanvasState) => [
  ...state.atoms,
  ...state.bonds,
  ...state.arrows,
  ...(state.textBoxes ?? []),
  ...(state.groups ?? []),
];

/** Translate a tool's geometric calculation into changes to specific document objects.
 * Unchanged source objects retain fields the projection cannot express.
 */
export function createProjectionEditCommand(
  source: ChemDrawDocument,
  nextState: CanvasState,
  description = 'edit-objects',
): EditorCommand {
  if (nextState.groups?.length) throw new Error('Group edits require a native document command.');
  const nextEntries = entries(nextState);
  if (new Set(nextEntries.map((object) => object.id)).size !== nextEntries.length)
    throw new Error('An edit contains duplicate object IDs.');
  const before = new Map(
    entries(chemDrawDocumentToCanvasState(source).state).map((o) => [o.id, o]),
  );
  const after = new Map(nextEntries.map((o) => [o.id, o]));
  const changed = new Set(
    [...before.keys(), ...after.keys()].filter((id) => !same(before.get(id), after.get(id))),
  );
  return {
    type: 'edit-projected-objects',
    description,
    apply(document) {
      if (document !== source) throw new Error('The document changed during this edit.');
      if (!changed.size) return { document, inversePatch: null, changedObjectIds: changed };
      const page = document.pages[0];
      if (!page) throw new Error('The document has no editable page.');
      for (const object of page.objects) {
        if (!changed.has(object.id)) continue;
        const capability = object.preservation?.capability ?? 'editable';
        if (
          capability !== 'editable' ||
          (object.type === 'node' && object.query) ||
          (object.type === 'bond' && (object.query || object.secondaryDisplay))
        ) {
          throw new Error(`Object ${object.id} cannot be edited without losing preserved content.`);
        }
      }
      const candidate = mergeCanvasStateIntoChemDrawDocument(document, nextState).document.pages[0];
      const replacements = new Map(candidate.objects.map((object) => [object.id, object]));
      const objects: ChemDrawObject[] = [];
      for (const object of page.objects) {
        if (object.type === 'fragment') {
          const replacement = replacements.get(object.id);
          if (replacement?.type === 'fragment') {
            objects.push(
              same(object.nodeIds, replacement.nodeIds) && same(object.bondIds, replacement.bondIds)
                ? object
                : replacement,
            );
          } else if (!object.nodeIds.some((id) => changed.has(id))) objects.push(object);
        } else if (changed.has(object.id)) {
          const replacement = replacements.get(object.id);
          if (after.has(object.id) && replacement) objects.push(replacement);
        } else objects.push(object);
      }
      const existing = new Set(objects.map((object) => object.id));
      for (const object of candidate.objects) {
        if (!existing.has(object.id) && (changed.has(object.id) || object.type === 'fragment'))
          objects.push(object);
      }
      const ids = new Set(objects.map((object) => object.id));
      const nextDocument = {
        ...document,
        pages: [
          {
            ...page,
            objects: objects.map((object) =>
              object.type === 'group' &&
              object.childIds.some((id) => changed.has(id) && !ids.has(id))
                ? {
                    ...object,
                    childIds: object.childIds.filter((id) => !changed.has(id) || ids.has(id)),
                  }
                : object,
            ),
          },
          ...document.pages.slice(1),
        ],
      };
      assertFiniteNumbers(nextDocument, 'document');
      return {
        document: nextDocument,
        inversePatch: {
          type: 'restore-document',
          apply: () => ({ document, inversePatch: null, changedObjectIds: changed }),
        },
        changedObjectIds: changed,
      };
    },
  };
}
