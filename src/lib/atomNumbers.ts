import type { ChemDrawDocument, ChemDrawNode } from '../types/chemdraw';

/**
 * Show Atom Number (ChemDraw 17.1 guide, "Showing Atom Numbers"; hotkey `'`): toggles the number
 * beside each selected atom. When every selected atom already shows its number they are all
 * hidden, otherwise all are shown. An atom keeps the number it has (`AtomNumber`); one without
 * gets its 1-based place in its structure's atom order, which is the order they were drawn.
 */
export function toggleAtomNumbers(
  document: ChemDrawDocument,
  nodeIds: ReadonlySet<string>,
): ChemDrawDocument {
  const page = document.pages[0];
  if (!page) return document;
  const targets = page.objects.filter(
    (object): object is ChemDrawNode =>
      object.type === 'node' &&
      nodeIds.has(object.id) &&
      object.preservation?.capability !== 'render-only',
  );
  if (targets.length === 0) return document;
  const show = !targets.every((node) => node.showAtomNumber === true);
  const placeInStructure = new Map<string, number>();
  for (const object of page.objects) {
    if (object.type !== 'fragment') continue;
    object.nodeIds.forEach((id, index) => placeInStructure.set(id, index + 1));
  }
  const targetIds = new Set(targets.map((node) => node.id));
  const objects = page.objects.map((object) => {
    if (object.type !== 'node' || !targetIds.has(object.id)) return object;
    return {
      ...object,
      showAtomNumber: show,
      ...(show && object.atomNumber == null
        ? { atomNumber: String(placeInStructure.get(object.id) ?? 1) }
        : {}),
    };
  });
  return { ...document, pages: [{ ...page, objects }, ...document.pages.slice(1)] };
}
