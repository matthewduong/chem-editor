import type {
  ChemDrawBond,
  ChemDrawDocument,
  ChemDrawFragment,
  ChemDrawGroup,
  ChemDrawNode,
  ChemDrawObject,
  ChemDrawObjectTag,
  ChemDrawTable,
} from '../types/chemdraw';
import { moveSelectedObjects } from './chemdrawModel';

/**
 * Document-level clipboard. The flat `ClipboardBuffer` only knows atoms, bonds, arrows and text
 * boxes, so copying through it drops graphics, brackets, tables, embedded objects and everything
 * in preservation metadata. These helpers copy the selected *document objects* instead.
 */

function hasOpaqueChildren(value: {
  preservation?: { rawChildrenXml?: string[] };
  objectTags?: ChemDrawObjectTag[];
}): boolean {
  if (value.preservation?.rawChildrenXml?.length) return true;
  return (value.objectTags ?? []).some((tag) => hasOpaqueChildren(tag));
}

function objectHasOpaqueChildren(object: ChemDrawObject): boolean {
  if (hasOpaqueChildren(object)) return true;
  if (object.type === 'table') {
    return object.cells.some((cell) => (cell.preservation?.rawChildrenXml?.length ?? 0) > 0);
  }
  return false;
}

/**
 * Build a one-page document holding the selected objects, or `null` when the selection cannot be
 * copied faithfully this way (nothing selected, opaque preserved children whose internal ids we
 * could not remap, or a reference that would dangle). Callers fall back to the flat buffer on
 * `null`, which is the previous behaviour.
 */
export function extractDocumentSelection(
  document: ChemDrawDocument,
  selectedObjectIds: ReadonlySet<string>,
): ChemDrawDocument | null {
  const page = document.pages[0];
  if (!page || selectedObjectIds.size === 0) return null;
  const byId = new Map(page.objects.map((object) => [object.id, object]));
  const included = new Set<string>();

  const include = (id: string): void => {
    if (included.has(id)) return;
    const object = byId.get(id);
    if (!object) return;
    included.add(id);
    if (object.type === 'group') object.childIds.forEach(include);
    if (object.type === 'fragment') {
      object.nodeIds.forEach(include);
      object.bondIds.forEach(include);
    }
    if (object.type === 'bond') {
      include(object.beginNodeId);
      include(object.endNodeId);
    }
  };
  selectedObjectIds.forEach(include);
  // A bond whose two ends were both copied comes with them, as in the flat extraction.
  for (const object of page.objects) {
    if (
      object.type === 'bond' &&
      included.has(object.beginNodeId) &&
      included.has(object.endNodeId)
    ) {
      included.add(object.id);
    }
  }
  if (included.size === 0) return null;

  const objects: ChemDrawObject[] = [];
  for (const object of page.objects) {
    if (!included.has(object.id)) continue;
    if (objectHasOpaqueChildren(object)) return null;
    if (
      object.type === 'graphic' &&
      object.representedObjectId &&
      !included.has(object.representedObjectId)
    ) {
      return null;
    }
    if (object.type === 'fragment') {
      objects.push({
        ...object,
        nodeIds: object.nodeIds.filter((id) => included.has(id)),
        bondIds: object.bondIds.filter((id) => included.has(id)),
      });
    } else if (object.type === 'group') {
      objects.push({ ...object, childIds: object.childIds.filter((id) => included.has(id)) });
    } else {
      objects.push(structuredClone(object));
    }
  }

  const { preservedExtraPages: _extraPages, ...metadata } = document.metadata ?? {};
  void _extraPages;
  return {
    ...document,
    pages: [{ id: page.id, objects }],
    metadata,
  };
}

export interface DocumentPasteResult {
  document: ChemDrawDocument;
  /** Ids of the pasted top-level objects in the returned document, for selection. */
  objectIds: string[];
}

function collectUsedIds(document: ChemDrawDocument): Set<string> {
  const used = new Set<string>();
  const addTags = (tags?: ChemDrawObjectTag[]) =>
    tags?.forEach((tag) => {
      if (tag.id) used.add(tag.id);
    });
  for (const page of document.pages) {
    used.add(page.id);
    for (const object of page.objects) {
      used.add(object.id);
      addTags(object.objectTags);
      if (object.type === 'table') object.cells.forEach((cell) => used.add(cell.id));
    }
  }
  for (const extra of document.metadata?.preservedExtraPages ?? []) used.add(extra.id);
  return used;
}

/**
 * Insert a copied fragment into `target`, giving every pasted object, table cell and object tag a
 * fresh id that cannot collide with the target, rewriting each id reference, and translating the
 * result by (`dx`, `dy`).
 */
export function pasteDocumentFragment(
  target: ChemDrawDocument,
  fragment: ChemDrawDocument,
  dx: number,
  dy: number,
): DocumentPasteResult {
  const source = fragment.pages[0];
  const page = target.pages[0];
  if (!source || !page) return { document: target, objectIds: [] };

  const used = collectUsedIds(target);
  let counter = 1;
  const fresh = (): string => {
    while (used.has(String(counter))) counter++;
    const id = String(counter++);
    used.add(id);
    return id;
  };
  const idMap = new Map<string, string>();
  const remap = (id: string): string => {
    let next = idMap.get(id);
    if (!next) {
      next = fresh();
      idMap.set(id, next);
    }
    return next;
  };
  const lookup = (id: string): string => idMap.get(id) ?? id;
  const remapTags = (tags?: ChemDrawObjectTag[]) =>
    tags?.map((tag) => (tag.id ? { ...tag, id: remap(tag.id) } : tag));

  // Allocate every object id first so forward references resolve.
  for (const object of source.objects) remap(object.id);

  const pasted: ChemDrawObject[] = source.objects.map((original) => {
    const object = structuredClone(original);
    object.id = lookup(object.id);
    if (object.objectTags) object.objectTags = remapTags(object.objectTags);
    switch (object.type) {
      case 'node': {
        const node: ChemDrawNode = object;
        if (node.bondOrdering) {
          node.bondOrdering = node.bondOrdering.map((entry) =>
            typeof entry === 'string' ? lookup(entry) : entry,
          );
        }
        break;
      }
      case 'bond': {
        const bond: ChemDrawBond = object;
        bond.beginNodeId = lookup(bond.beginNodeId);
        bond.endNodeId = lookup(bond.endNodeId);
        break;
      }
      case 'fragment': {
        const frag: ChemDrawFragment = object;
        frag.nodeIds = frag.nodeIds.map(lookup);
        frag.bondIds = frag.bondIds.map(lookup);
        break;
      }
      case 'group': {
        const group: ChemDrawGroup = object;
        group.childIds = group.childIds.map(lookup);
        break;
      }
      case 'graphic':
        if (object.representedObjectId) {
          object.representedObjectId = lookup(object.representedObjectId);
        }
        break;
      case 'table': {
        const table: ChemDrawTable = object;
        table.cells = table.cells.map((cell) => ({ ...cell, id: remap(cell.id) }));
        break;
      }
      default:
        break;
    }
    return object;
  });

  const idsOnly = new Set(pasted.map((object) => object.id));
  const withPasted: ChemDrawDocument = {
    ...target,
    pages: [{ ...page, objects: [...page.objects, ...pasted] }, ...target.pages.slice(1)],
  };
  const document = moveSelectedObjects(withPasted, idsOnly, dx, dy);
  // Top-level selection: the pasted objects that are not owned by a pasted fragment or group.
  const owned = new Set<string>();
  for (const object of pasted) {
    if (object.type === 'fragment') {
      object.nodeIds.forEach((id) => owned.add(id));
      object.bondIds.forEach((id) => owned.add(id));
    }
    if (object.type === 'group') object.childIds.forEach((id) => owned.add(id));
  }
  return {
    document: {
      ...document,
      pages: [document.pages[0], ...target.pages.slice(1)],
    },
    objectIds: pasted.map((object) => object.id).filter((id) => !owned.has(id)),
  };
}

let lastCopy: { fragment: ChemDrawDocument; text: string } | null = null;

/** Remember the fragment behind the CDXML text most recently written to the system clipboard. */
export function rememberDocumentCopy(fragment: ChemDrawDocument, text: string): void {
  lastCopy = { fragment, text };
}

export function forgetDocumentCopy(): void {
  lastCopy = null;
}

/**
 * The remembered fragment, but only while the system clipboard still holds the text we wrote for
 * it; anything copied elsewhere in the meantime wins and takes the normal paste path.
 */
export function getDocumentCopyFor(clipboardText: string | null): ChemDrawDocument | null {
  if (!lastCopy) return null;
  return clipboardText === null || clipboardText === lastCopy.text ? lastCopy.fragment : null;
}
