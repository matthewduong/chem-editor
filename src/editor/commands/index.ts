import type {
  ChemDrawBounds,
  ChemDrawDocument,
  ChemDrawEmbeddedObject,
  ChemDrawGraphic,
  ChemDrawObject,
  ChemDrawPoint,
  ChemDrawTable,
} from '../../types/chemdraw';
import type {
  EditorCommand,
  EditorCommandContext,
  EditorSelectionState,
  EditorTransaction,
  EditorTransactionResult,
} from '../types';
import {
  deleteSelectedObjects,
  moveSelectedObjects,
  rotateSelectedObjects,
  scaleSelectedObjects,
} from '../../lib/chemdrawModel';
import { buildDocumentIndex, getActivePage } from '../document';

function replacePageObjects(
  document: ChemDrawDocument,
  pageId: string,
  objects: ChemDrawObject[],
): ChemDrawDocument {
  return {
    ...document,
    pages: document.pages.map((page) => (page.id === pageId ? { ...page, objects } : page)),
  };
}

function getResolvedPageId(document: ChemDrawDocument, pageId?: string | null): string | null {
  return getActivePage(document, pageId)?.id ?? null;
}

function translatePoint(point: ChemDrawPoint, dx: number, dy: number): ChemDrawPoint {
  return { x: point.x + dx, y: point.y + dy };
}

function translateBounds(bounds: ChemDrawBounds, dx: number, dy: number): ChemDrawBounds {
  return {
    left: bounds.left + dx,
    top: bounds.top + dy,
    right: bounds.right + dx,
    bottom: bounds.bottom + dy,
  };
}

function moveGraphic(graphic: ChemDrawGraphic, dx: number, dy: number): ChemDrawGraphic {
  return {
    ...graphic,
    ...(graphic.points
      ? { points: graphic.points.map((point) => translatePoint(point, dx, dy)) }
      : {}),
    ...(graphic.bounds ? { bounds: translateBounds(graphic.bounds, dx, dy) } : {}),
    ...(graphic.center ? { center: translatePoint(graphic.center, dx, dy) } : {}),
    ...(graphic.majorAxisEnd ? { majorAxisEnd: translatePoint(graphic.majorAxisEnd, dx, dy) } : {}),
    ...(graphic.minorAxisEnd ? { minorAxisEnd: translatePoint(graphic.minorAxisEnd, dx, dy) } : {}),
  };
}

function moveEmbeddedObject(
  embeddedObject: ChemDrawEmbeddedObject,
  dx: number,
  dy: number,
): ChemDrawEmbeddedObject {
  return {
    ...embeddedObject,
    bounds: translateBounds(embeddedObject.bounds, dx, dy),
  };
}

function moveTable(table: ChemDrawTable, dx: number, dy: number): ChemDrawTable {
  return {
    ...table,
    bounds: translateBounds(table.bounds, dx, dy),
    cells: table.cells.map((cell) => ({
      ...cell,
      boundsInParent: translateBounds(cell.boundsInParent, dx, dy),
      ...(cell.text?.bounds
        ? { text: { ...cell.text, bounds: translateBounds(cell.text.bounds, dx, dy) } }
        : {}),
    })),
  };
}

function moveObject(object: ChemDrawObject, dx: number, dy: number): ChemDrawObject {
  if (object.type === 'node')
    return { ...object, position: translatePoint(object.position, dx, dy) };
  if (object.type === 'arrow') {
    return {
      ...object,
      tail: translatePoint(object.tail, dx, dy),
      head: translatePoint(object.head, dx, dy),
      ...(object.controlPoint ? { controlPoint: translatePoint(object.controlPoint, dx, dy) } : {}),
      ...(object.arcCenter ? { arcCenter: translatePoint(object.arcCenter, dx, dy) } : {}),
      ...(object.majorAxisEnd ? { majorAxisEnd: translatePoint(object.majorAxisEnd, dx, dy) } : {}),
      ...(object.minorAxisEnd ? { minorAxisEnd: translatePoint(object.minorAxisEnd, dx, dy) } : {}),
    };
  }
  if (object.type === 'text') return { ...object, anchor: translatePoint(object.anchor, dx, dy) };
  if (object.type === 'bracket')
    return { ...object, bounds: translateBounds(object.bounds, dx, dy) };
  if (object.type === 'graphic') return moveGraphic(object, dx, dy);
  if (object.type === 'embedded-object') return moveEmbeddedObject(object, dx, dy);
  if (object.type === 'table') return moveTable(object, dx, dy);
  return object;
}

function expandObjectIdsForMove(
  document: ChemDrawDocument,
  pageId: string,
  objectIds: Iterable<string>,
): Set<string> {
  const expanded = new Set<string>(objectIds);
  const index = buildDocumentIndex(document, { activePageId: pageId });
  const queue = [...expanded];
  while (queue.length > 0) {
    const nextId = queue.shift();
    if (!nextId) continue;
    const children = index.childrenByParent.get(nextId) ?? [];
    for (const childId of children) {
      if (expanded.has(childId)) continue;
      expanded.add(childId);
      queue.push(childId);
    }
  }
  return expanded;
}

export function createReplaceDocumentCommand(
  nextDocument: ChemDrawDocument,
  description = 'replace-document',
): EditorCommand {
  return {
    type: 'replace-document',
    description,
    apply(document) {
      const changedObjectIds = new Set<string>();
      for (const page of document.pages) {
        for (const object of page.objects) changedObjectIds.add(object.id);
      }
      for (const page of nextDocument.pages) {
        for (const object of page.objects) changedObjectIds.add(object.id);
      }
      return {
        document: nextDocument,
        inversePatch: createReplaceDocumentCommand(document, `undo:${description}`),
        changedObjectIds,
      };
    },
  };
}

export function createUpsertObjectsCommand(
  objects: ChemDrawObject[],
  options?: { pageId?: string | null; description?: string },
): EditorCommand {
  return {
    type: 'upsert-objects',
    description: options?.description ?? 'upsert-objects',
    apply(document, context) {
      const pageId = getResolvedPageId(document, options?.pageId ?? context.activePageId);
      if (!pageId) {
        return { document, inversePatch: null, changedObjectIds: new Set() };
      }
      const page = getActivePage(document, pageId);
      if (!page) return { document, inversePatch: null, changedObjectIds: new Set() };
      const nextObjects = [...page.objects];
      const previousDocument = document;
      for (const object of objects) {
        const index = nextObjects.findIndex((entry) => entry.id === object.id);
        if (index >= 0) nextObjects[index] = object;
        else nextObjects.push(object);
      }
      return {
        document: replacePageObjects(document, pageId, nextObjects),
        inversePatch: createReplaceDocumentCommand(previousDocument, 'undo:upsert-objects'),
        changedObjectIds: new Set(objects.map((object) => object.id)),
      };
    },
  };
}

export function createRemoveObjectsCommand(
  objectIds: Iterable<string>,
  options?: { pageId?: string | null; description?: string },
): EditorCommand {
  const ids = new Set(objectIds);
  return {
    type: 'remove-objects',
    description: options?.description ?? 'remove-objects',
    apply(document, context) {
      const pageId = getResolvedPageId(document, options?.pageId ?? context.activePageId);
      if (!pageId) {
        return { document, inversePatch: null, changedObjectIds: new Set() };
      }
      const page = getActivePage(document, pageId);
      if (!page) return { document, inversePatch: null, changedObjectIds: new Set() };
      const previousDocument = document;
      const nextObjects = page.objects
        .filter((object) => !ids.has(object.id))
        .map((object) => {
          if (object.type === 'fragment') {
            return {
              ...object,
              nodeIds: object.nodeIds.filter((id) => !ids.has(id)),
              bondIds: object.bondIds.filter((id) => !ids.has(id)),
            };
          }
          if (object.type === 'group') {
            return { ...object, childIds: object.childIds.filter((id) => !ids.has(id)) };
          }
          return object;
        })
        .filter(
          (object) =>
            object.type !== 'fragment' || object.nodeIds.length > 0 || object.bondIds.length > 0,
        );
      return {
        document: replacePageObjects(document, pageId, nextObjects),
        inversePatch: createReplaceDocumentCommand(previousDocument, 'undo:remove-objects'),
        changedObjectIds: ids,
      };
    },
  };
}

export function createMoveObjectsCommand(
  objectIds: Iterable<string>,
  delta: { dx: number; dy: number },
  options?: { pageId?: string | null; description?: string },
): EditorCommand {
  const ids = new Set(objectIds);
  return {
    type: 'move-objects',
    description: options?.description ?? 'move-objects',
    apply(document, context) {
      const pageId = getResolvedPageId(document, options?.pageId ?? context.activePageId);
      if (!pageId) {
        return { document, inversePatch: null, changedObjectIds: new Set() };
      }
      const page = getActivePage(document, pageId);
      if (!page) return { document, inversePatch: null, changedObjectIds: new Set() };
      const previousDocument = document;
      const expandedIds = expandObjectIdsForMove(document, pageId, ids);
      const nextObjects = page.objects.map((object) =>
        expandedIds.has(object.id) ? moveObject(object, delta.dx, delta.dy) : object,
      );
      return {
        document: replacePageObjects(document, pageId, nextObjects),
        inversePatch: createReplaceDocumentCommand(previousDocument, 'undo:move-objects'),
        changedObjectIds: expandedIds,
      };
    },
  };
}

function resolveSelectionIds(
  context: EditorCommandContext,
  objectIds?: Iterable<string>,
): Set<string> {
  return objectIds ? new Set(objectIds) : new Set(context.selection.objectIds);
}

export function createMoveSelectionCommand(
  delta: { dx: number; dy: number },
  options?: { objectIds?: Iterable<string>; description?: string },
): EditorCommand {
  return {
    type: 'move-selection',
    description: options?.description ?? 'move-selection',
    apply(document, context) {
      const selectionIds = resolveSelectionIds(context, options?.objectIds);
      if (selectionIds.size === 0) {
        return { document, inversePatch: null, changedObjectIds: new Set() };
      }
      return {
        document: moveSelectedObjects(document, selectionIds, delta.dx, delta.dy),
        inversePatch: createReplaceDocumentCommand(document, 'undo:move-selection'),
        changedObjectIds: selectionIds,
      };
    },
  };
}

export function createRotateSelectionCommand(
  center: { x: number; y: number },
  radians: number,
  options?: { objectIds?: Iterable<string>; description?: string },
): EditorCommand {
  return {
    type: 'rotate-selection',
    description: options?.description ?? 'rotate-selection',
    apply(document, context) {
      const selectionIds = resolveSelectionIds(context, options?.objectIds);
      if (selectionIds.size === 0) {
        return { document, inversePatch: null, changedObjectIds: new Set() };
      }
      return {
        document: rotateSelectedObjects(document, selectionIds, center, radians),
        inversePatch: createReplaceDocumentCommand(document, 'undo:rotate-selection'),
        changedObjectIds: selectionIds,
      };
    },
  };
}

export function createScaleSelectionCommand(
  center: { x: number; y: number },
  factor: number,
  options?: { objectIds?: Iterable<string>; description?: string },
): EditorCommand {
  return {
    type: 'scale-selection',
    description: options?.description ?? 'scale-selection',
    apply(document, context) {
      const selectionIds = resolveSelectionIds(context, options?.objectIds);
      if (selectionIds.size === 0) {
        return { document, inversePatch: null, changedObjectIds: new Set() };
      }
      return {
        document: scaleSelectedObjects(document, selectionIds, center, factor),
        inversePatch: createReplaceDocumentCommand(document, 'undo:scale-selection'),
        changedObjectIds: selectionIds,
      };
    },
  };
}

export function createDeleteSelectionCommand(options?: {
  objectIds?: Iterable<string>;
  description?: string;
}): EditorCommand {
  return {
    type: 'delete-selection',
    description: options?.description ?? 'delete-selection',
    apply(document, context) {
      const selectionIds = resolveSelectionIds(context, options?.objectIds);
      if (selectionIds.size === 0) {
        return { document, inversePatch: null, changedObjectIds: new Set() };
      }
      return {
        document: deleteSelectedObjects(document, selectionIds),
        inversePatch: createReplaceDocumentCommand(document, 'undo:delete-selection'),
        changedObjectIds: selectionIds,
      };
    },
  };
}

export function applyEditorCommand(
  document: ChemDrawDocument,
  command: EditorCommand,
  context: EditorCommandContext,
) {
  return command.apply(document, context);
}

export function applyEditorTransaction(
  document: ChemDrawDocument,
  transaction: EditorTransaction,
  context: EditorCommandContext,
): EditorTransactionResult {
  let currentDocument = document;
  const inverses: EditorCommand[] = [];
  const changedObjectIds = new Set<string>();

  for (const command of transaction.commands) {
    const result = command.apply(currentDocument, context);
    currentDocument = result.document;
    if (result.inversePatch) inverses.unshift(result.inversePatch);
    for (const id of result.changedObjectIds) changedObjectIds.add(id);
  }

  return {
    document: currentDocument,
    inverseTransaction: {
      id: `${transaction.id}:inverse`,
      label: transaction.label ? `undo:${transaction.label}` : undefined,
      commands: inverses,
    },
    changedObjectIds,
  };
}

export function createEditorCommandContext(options: {
  activePageId: string | null;
  documentStyleSettings: EditorCommandContext['documentStyleSettings'];
  pageSetup: EditorCommandContext['pageSetup'];
  selection?: Partial<EditorSelectionState>;
}): EditorCommandContext {
  return {
    activePageId: options.activePageId,
    documentStyleSettings: options.documentStyleSettings,
    pageSetup: options.pageSetup,
    selection: {
      objectIds: options.selection?.objectIds ?? new Set(),
      atomIds: options.selection?.atomIds ?? new Set(),
      bondIds: options.selection?.bondIds ?? new Set(),
      arrowIds: options.selection?.arrowIds ?? new Set(),
      textBoxIds: options.selection?.textBoxIds ?? new Set(),
      hoveredObjectId: options.selection?.hoveredObjectId ?? null,
      hoveredObjectType: options.selection?.hoveredObjectType ?? null,
    },
  };
}
