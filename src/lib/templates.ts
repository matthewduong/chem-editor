import type { ChemDrawDocument, ChemDrawNode, ChemDrawObject } from '../types/chemdraw';
import { assertFiniteNumbers } from './cdxmlValidation';
import { extractDocumentSelection, pasteDocumentFragment } from './documentClipboard';
import { buildDocumentIndex } from '../editor/document';

export interface UserTemplate {
  id: string;
  name: string;
  tags: string[];
  fragment: ChemDrawDocument;
  attachment?: { atomId: string } | { bondId: string };
}
export interface TemplateLibrary {
  version: 1;
  templates: UserTemplate[];
}
export const emptyTemplateLibrary = (): TemplateLibrary => ({ version: 1, templates: [] });

export function validateTemplate(template: UserTemplate): void {
  if (
    !template ||
    typeof template.id !== 'string' ||
    !template.id ||
    typeof template.name !== 'string' ||
    !template.name.trim() ||
    !Array.isArray(template.tags) ||
    template.tags.some((t) => typeof t !== 'string')
  )
    throw new Error('Invalid template identity, name or tags.');
  const fragment = template.fragment;
  if (
    !fragment ||
    fragment.schemaVersion !== 1 ||
    !Array.isArray(fragment.pages) ||
    fragment.pages.length !== 1 ||
    !Array.isArray(fragment.pages[0]?.objects) ||
    !fragment.pages[0].objects.length
  )
    throw new Error('Invalid native template fragment.');
  assertFiniteNumbers(fragment, 'template');
  const objects = fragment.pages[0].objects;
  const ids = new Set(objects.map((o) => o.id));
  if (
    objects.some(
      (o) =>
        ![
          'node',
          'bond',
          'fragment',
          'group',
          'text',
          'arrow',
          'bracket',
          'graphic',
          'embedded-object',
          'table',
        ].includes(o.type),
    )
  )
    throw new Error('Unsupported template object type.');
  if (ids.size !== objects.length || objects.some((o) => !o.id || typeof o.id !== 'string'))
    throw new Error('Duplicate or missing template object IDs.');
  for (const o of objects) {
    const references =
      o.type === 'bond'
        ? [o.beginNodeId, o.endNodeId]
        : o.type === 'fragment'
          ? [...o.nodeIds, ...o.bondIds]
          : o.type === 'group'
            ? o.childIds
            : o.type === 'node'
              ? (o.bondOrdering ?? []).filter((id): id is string => typeof id === 'string')
              : o.type === 'graphic' && o.representedObjectId
                ? [o.representedObjectId]
                : [];
    if (references.some((id) => !ids.has(id)))
      throw new Error('Template contains invalid references.');
    if (
      o.type === 'node' &&
      (!o.position || !Number.isFinite(o.position.x) || !Number.isFinite(o.position.y))
    )
      throw new Error('Invalid template atom coordinates.');
    if (
      o.type === 'bond' &&
      [o.beginNodeId, o.endNodeId].some((id) => objects.find((o) => o.id === id)?.type !== 'node')
    )
      throw new Error('Template bond references a non-atom.');
  }
  // This also refuses opaque preserved children and unsafe annotation references.
  if (!extractDocumentSelection(fragment, ids))
    throw new Error('Template cannot be copied faithfully.');
  // Validate remaining object shapes with the same native index used by screen/export.
  buildDocumentIndex(fragment);
  if (template.attachment) {
    const a = template.attachment;
    const object = objects.find((o) => o.id === ('atomId' in a ? a.atomId : a.bondId));
    if (object?.type !== ('atomId' in a ? 'node' : 'bond'))
      throw new Error('Invalid template attachment point.');
  }
}
export function parseTemplateLibrary(text: string): TemplateLibrary {
  const library: TemplateLibrary = JSON.parse(text);
  if (!library || library.version !== 1)
    throw new Error('Unsupported template library version. The original file was retained.');
  if (!Array.isArray(library.templates))
    throw new Error('Malformed template library. The original file was retained.');
  library.templates.forEach(validateTemplate);
  if (new Set(library.templates.map((t) => t.id)).size !== library.templates.length)
    throw new Error('Duplicate template IDs.');
  return library;
}
export function saveSelectionTemplate(
  document: ChemDrawDocument,
  selection: ReadonlySet<string>,
  name: string,
  tags: string[],
  attachment?: UserTemplate['attachment'],
): UserTemplate {
  const fragment = extractDocumentSelection(document, selection);
  if (!fragment)
    throw new Error('This selection cannot be copied faithfully as a native template.');
  const template = { id: crypto.randomUUID(), name: name.trim(), tags, fragment, attachment };
  validateTemplate(template);
  return template;
}

function compatibleNode(a: ChemDrawNode, b: ChemDrawNode) {
  return (
    (a.element ?? 'C') === (b.element ?? 'C') &&
    (a.charge ?? 0) === (b.charge ?? 0) &&
    (a.isotope ?? 0) === (b.isotope ?? 0) &&
    (a.radicalElectrons ?? 0) === (b.radicalElectrons ?? 0) &&
    JSON.stringify(a.style ?? {}) === JSON.stringify(b.style ?? {})
  );
}
function assertAttachable(objects: ChemDrawObject[]) {
  if (
    objects.some(
      (o) =>
        !['node', 'bond', 'fragment', 'group'].includes(o.type) ||
        (o.preservation?.capability ?? 'editable') !== 'editable' ||
        o.preservation?.rawAttributes ||
        (o.type === 'node' &&
          (o.alias ||
            o.query ||
            o.atomStereo ||
            o.bondOrdering ||
            o.objectTags?.length ||
            o.text ||
            o.lonePairCount ||
            o.electronAngles?.length)) ||
        (o.type === 'bond' &&
          (o.query ||
            o.secondaryDisplay ||
            o.objectTags?.length ||
            (o.display && !['solid', 'bold'].includes(o.display)))),
    )
  )
    throw new Error(
      'Attachment requires fully editable molecular fragments without unsupported stereo or preserved properties.',
    );
}

/** Same native placement is used for preview and commit. Atom/bond merges remap all references. */
export function placeTemplate(
  target: ChemDrawDocument,
  template: UserTemplate,
  point: { x: number; y: number },
  targetId?: string,
) {
  validateTemplate(template);
  const source = template.fragment;
  const sourceObjects = source.pages[0]!.objects;
  const index = buildDocumentIndex(source);
  const bounds = index.pageBounds;
  const center = bounds
    ? { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
    : { x: 0, y: 0 };
  let transformed = source;
  const mergeOriginal = new Map<string, string>();

  if (targetId) {
    assertAttachable(sourceObjects);
    const targetObject = target.pages[0]?.objects.find((o) => o.id === targetId);
    const attachment = template.attachment;
    if (!attachment || !targetObject)
      throw new Error('Choose an attachment point in the template.');
    let from: ChemDrawNode,
      to: ChemDrawNode,
      angle = 0;
    if ('atomId' in attachment && targetObject.type === 'node') {
      from = sourceObjects.find((o) => o.id === attachment.atomId) as ChemDrawNode;
      to = targetObject;
      assertAttachable([to]);
      if (!compatibleNode(from, to))
        throw new Error('Template atom properties conflict with the target atom.');
      mergeOriginal.set(from.id, to.id);
    } else if ('bondId' in attachment && targetObject.type === 'bond') {
      const bond = sourceObjects.find((o) => o.id === attachment.bondId);
      if (bond?.type !== 'bond') throw new Error('Invalid template bond.');
      assertAttachable([targetObject]);
      if (
        (bond.order ?? 1) !== (targetObject.order ?? 1) ||
        Boolean(bond.aromatic) !== Boolean(targetObject.aromatic) ||
        (bond.display ?? 'solid') !== (targetObject.display ?? 'solid') ||
        JSON.stringify(bond.style ?? {}) !== JSON.stringify(targetObject.style ?? {})
      )
        throw new Error('Template bond properties conflict with the target bond.');
      from = sourceObjects.find((o) => o.id === bond.beginNodeId) as ChemDrawNode;
      const end = sourceObjects.find((o) => o.id === bond.endNodeId) as ChemDrawNode;
      to = target.pages[0]!.objects.find((o) => o.id === targetObject.beginNodeId) as ChemDrawNode;
      const targetEnd = target.pages[0]!.objects.find(
        (o) => o.id === targetObject.endNodeId,
      ) as ChemDrawNode;
      if (!from || !end || !to || !targetEnd) throw new Error('Missing attachment atoms.');
      assertAttachable([to, targetEnd]);
      if (!compatibleNode(from, to) || !compatibleNode(end, targetEnd))
        throw new Error('Template endpoint properties conflict.');
      const sourceLength = Math.hypot(
          end.position.x - from.position.x,
          end.position.y - from.position.y,
        ),
        targetLength = Math.hypot(
          targetEnd.position.x - to.position.x,
          targetEnd.position.y - to.position.y,
        );
      if (sourceLength < 1e-6 || Math.abs(sourceLength - targetLength) > sourceLength * 0.01)
        throw new Error('Attachment bond lengths must match.');
      angle =
        Math.atan2(targetEnd.position.y - to.position.y, targetEnd.position.x - to.position.x) -
        Math.atan2(end.position.y - from.position.y, end.position.x - from.position.x);
      mergeOriginal.set(from.id, to.id);
      mergeOriginal.set(end.id, targetEnd.id);

      mergeOriginal.set(bond.id, targetObject.id);
    } else throw new Error('The selected template and target attachment types differ.');
    transformed = {
      ...source,
      pages: [
        {
          ...source.pages[0]!,
          objects: sourceObjects.map((o) =>
            o.type === 'node'
              ? {
                  ...o,
                  position: {
                    x:
                      to.position.x +
                      (o.position.x - from.position.x) * Math.cos(angle) -
                      (o.position.y - from.position.y) * Math.sin(angle),
                    y:
                      to.position.y +
                      (o.position.x - from.position.x) * Math.sin(angle) +
                      (o.position.y - from.position.y) * Math.cos(angle),
                  },
                }
              : o,
          ),
        },
      ],
    };
  }
  const pasted = pasteDocumentFragment(
    target,
    transformed,
    targetId ? 0 : point.x - center.x,
    targetId ? 0 : point.y - center.y,
  );
  const oldCount = target.pages[0]!.objects.length;
  const additions = pasted.document.pages[0]!.objects.slice(oldCount);
  const freshId = new Map(sourceObjects.map((o, i) => [o.id, additions[i]!.id]));
  if (!targetId) return pasted;
  const merge = new Map([...mergeOriginal].map(([id, target]) => [freshId.get(id)!, target]));
  const remap = (id: string) => merge.get(id) ?? id;
  const objects = pasted.document.pages[0]!.objects.filter((o) => !merge.has(o.id)).map((o) => {
    if (o.type === 'bond')
      return { ...o, beginNodeId: remap(o.beginNodeId), endNodeId: remap(o.endNodeId) };
    if (o.type === 'fragment')
      return {
        ...o,
        nodeIds: [...new Set(o.nodeIds.map(remap))],
        bondIds: [...new Set(o.bondIds.map(remap))],
      };
    if (o.type === 'group') return { ...o, childIds: [...new Set(o.childIds.map(remap))] };
    return o;
  });

  // A merged atom must have one fragment owner in CDXML. Fold a template fragment
  // into the existing molecular fragment, retaining the existing fragment identity.
  const fragmentRemap = new Map<string, string>();
  const addedIds = new Set(additions.map((o) => o.id));
  for (const added of [...objects]) {
    if (added.type !== 'fragment' || !addedIds.has(added.id)) continue;
    const owner = objects.find(
      (o) =>
        o.type === 'fragment' &&
        !addedIds.has(o.id) &&
        o.nodeIds.some((id) => added.nodeIds.includes(id)),
    );
    if (owner?.type !== 'fragment') continue;
    assertAttachable([owner]);
    if (JSON.stringify(owner.style ?? {}) !== JSON.stringify(added.style ?? {}))
      throw new Error('Fragment styles conflict during attachment.');
    const ownerIndex = objects.indexOf(owner);
    objects[ownerIndex] = {
      ...owner,
      nodeIds: [...new Set([...owner.nodeIds, ...added.nodeIds])],
      bondIds: [...new Set([...owner.bondIds, ...added.bondIds])],
    };
    objects.splice(objects.indexOf(added), 1);
    fragmentRemap.set(added.id, owner.id);
  }
  for (let i = 0; i < objects.length; i++) {
    const o = objects[i]!;
    if (o.type === 'group')
      objects[i] = {
        ...o,
        childIds: [...new Set(o.childIds.map((id) => fragmentRemap.get(id) ?? id))],
      };
  }
  let mergedGroup = true;
  while (mergedGroup) {
    mergedGroup = false;
    for (const added of [...objects]) {
      if (added.type !== 'group' || !addedIds.has(added.id)) continue;
      const owner = objects.find(
        (o) =>
          o.type === 'group' &&
          !addedIds.has(o.id) &&
          o.childIds.some((id) => added.childIds.includes(id)),
      );
      if (owner?.type !== 'group') continue;
      assertAttachable([owner, added]);
      if (JSON.stringify(owner.style ?? {}) !== JSON.stringify(added.style ?? {}))
        throw new Error('Group styles conflict during attachment.');
      objects[objects.indexOf(owner)] = {
        ...owner,
        childIds: [...new Set([...owner.childIds, ...added.childIds])],
      };
      objects.splice(objects.indexOf(added), 1);
      fragmentRemap.set(added.id, owner.id);
      for (let i = 0; i < objects.length; i++) {
        const o = objects[i]!;
        if (o.type === 'group')
          objects[i] = {
            ...o,
            childIds: [...new Set(o.childIds.map((id) => (id === added.id ? owner.id : id)))],
          };
      }
      mergedGroup = true;
    }
  }
  const pairs = new Set<string>();
  for (const o of objects)
    if (o.type === 'bond') {
      const key = [o.beginNodeId, o.endNodeId].sort().join('\0');
      if (o.beginNodeId === o.endNodeId || pairs.has(key))
        throw new Error('Attachment creates a self-bond or duplicate bond.');
      pairs.add(key);
    }
  return {
    document: {
      ...pasted.document,
      pages: [{ ...pasted.document.pages[0]!, objects }, ...target.pages.slice(1)],
    },
    objectIds: pasted.objectIds
      .filter((id) => !merge.has(id))
      .map((id) => fragmentRemap.get(id) ?? id),
  };
}
