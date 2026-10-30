import type { ChemDrawDocument, ChemDrawGraphic, ChemDrawPoint } from '../types/chemdraw';
import { createSymbolGraphic } from './shapeGesture';

/**
 * Charges shown as chemical symbols (ChemDraw 17.1 guide, "Chemical Symbols"): a circled plus or
 * minus, or a radical cation or anion. The symbol is a Symbol graphic tied to its atom with
 * `<represent attribute="Charge" object=…>`, as ChemDraw writes it, and the atom carries the
 * charge. A radical ion's unpaired electron is the symbol's dot: whether ChemDraw also sets the
 * atom's Radical is not measured (gaps.md), and setting it here would draw the dot twice.
 * Applying the same symbol again removes it and the charge.
 */
export type ChargeSymbolType = 'CirclePlus' | 'CircleMinus' | 'RadicalCation' | 'RadicalAnion';

export function toggleChargeSymbol(
  document: ChemDrawDocument,
  nodeId: string,
  symbolType: ChargeSymbolType,
  place: ChemDrawPoint,
  size: number,
  newId: () => string,
): ChemDrawDocument {
  const page = document.pages[0];
  if (!page) return document;
  const node = page.objects.find((object) => object.id === nodeId);
  if (node?.type !== 'node' || node.preservation?.capability === 'render-only') return document;
  const existing = page.objects.find(
    (object): object is ChemDrawGraphic =>
      object.type === 'graphic' &&
      object.graphicType === 'symbol' &&
      object.representedObjectId === nodeId &&
      (object.representedAttribute ?? '').toLowerCase() === 'charge',
  );
  const removing = existing?.symbolType === symbolType;
  const charge = removing
    ? 0
    : symbolType === 'CirclePlus' || symbolType === 'RadicalCation'
      ? 1
      : -1;
  const objects = page.objects
    .filter((object) => object !== existing)
    .map((object) => {
      if (object !== node) return object;
      const next = { ...node, charge };
      if (charge === 0) delete (next as { charge?: number }).charge;
      return next;
    });
  if (!removing) {
    objects.push({
      ...createSymbolGraphic(newId(), symbolType, place, size),
      representedObjectId: nodeId,
      representedAttribute: 'Charge',
    });
  }
  return { ...document, pages: [{ ...page, objects }, ...document.pages.slice(1)] };
}

/**
 * Where a charge symbol goes beside an atom: on the diagonal (upper right first, as ChemDraw puts
 * a charge) farthest from the atom's bonds, clear of a label and of hydrogens stacked above or
 * below it.
 */
export function chargeSymbolPlace(
  atom: ChemDrawPoint,
  neighbours: readonly ChemDrawPoint[],
  bondLength: number,
): ChemDrawPoint {
  const diagonals = [-Math.PI / 4, -(3 * Math.PI) / 4, Math.PI / 4, (3 * Math.PI) / 4];
  const bondAngles = neighbours.map((n) => Math.atan2(n.y - atom.y, n.x - atom.x));
  const clearance = (angle: number) =>
    bondAngles.length === 0
      ? Math.PI
      : Math.min(
          ...bondAngles.map((b) => {
            const d = Math.abs(((angle - b + Math.PI) % (2 * Math.PI)) - Math.PI);
            return Math.min(d, 2 * Math.PI - d);
          }),
        );
  let best = diagonals[0]!;
  for (const angle of diagonals) if (clearance(angle) > clearance(best) + 1e-9) best = angle;
  const reach = bondLength * 0.7;
  return { x: atom.x + Math.cos(best) * reach, y: atom.y + Math.sin(best) * reach };
}
