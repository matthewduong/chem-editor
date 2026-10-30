import type {
  ChemDrawAtomQueryProperties,
  ChemDrawBond,
  ChemDrawBondRxnParticipation,
  ChemDrawDocument,
  ChemDrawNode,
} from '../types/chemdraw';

/**
 * Atom > Query Properties and Bond > Query Properties: set (or with `undefined`, clear) query
 * properties on the selected atoms or bonds. Render-only content is left alone.
 */
export function updateAtomQueryProperties(
  document: ChemDrawDocument,
  nodeIds: ReadonlySet<string>,
  patch: Partial<Record<keyof ChemDrawAtomQueryProperties, unknown>>,
): ChemDrawDocument {
  const page = document.pages[0];
  if (!page) return document;
  let changed = false;
  const objects = page.objects.map((object) => {
    if (object.type !== 'node' || !nodeIds.has(object.id)) return object;
    if (object.preservation?.capability === 'render-only') return object;
    const properties: Record<string, unknown> = { ...object.queryProperties };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined || value === false) delete properties[key];
      else properties[key] = value;
    }
    // Exactly n and up to n substituents are alternatives; the newer one wins.
    if ('substituentsExactly' in patch && patch.substituentsExactly !== undefined) {
      delete properties.substituentsUpTo;
    }
    if ('substituentsUpTo' in patch && patch.substituentsUpTo !== undefined) {
      delete properties.substituentsExactly;
    }
    changed = true;
    const next: ChemDrawNode = { ...object };
    if (Object.keys(properties).length) {
      next.queryProperties = properties as ChemDrawAtomQueryProperties;
    } else delete next.queryProperties;
    return next;
  });
  return changed
    ? { ...document, pages: [{ ...page, objects }, ...document.pages.slice(1)] }
    : document;
}

export type BondTopology = 'ring' | 'chain' | 'either' | undefined;

export function updateBondQuery(
  document: ChemDrawDocument,
  bondIds: ReadonlySet<string>,
  patch: { topology?: BondTopology; rxnParticipation?: ChemDrawBondRxnParticipation | null },
): ChemDrawDocument {
  const page = document.pages[0];
  if (!page) return document;
  let changed = false;
  const objects = page.objects.map((object) => {
    if (object.type !== 'bond' || !bondIds.has(object.id)) return object;
    if (object.preservation?.capability === 'render-only') return object;
    changed = true;
    const next: ChemDrawBond = { ...object };
    if ('topology' in patch) {
      const query = { ...next.query };
      if (patch.topology) query.ringState = patch.topology;
      else delete query.ringState;
      if (Object.keys(query).length) next.query = query;
      else delete next.query;
    }
    if ('rxnParticipation' in patch) {
      if (patch.rxnParticipation) next.rxnParticipation = patch.rxnParticipation;
      else delete next.rxnParticipation;
    }
    return next;
  });
  return changed
    ? { ...document, pages: [{ ...page, objects }, ...document.pages.slice(1)] }
    : document;
}
