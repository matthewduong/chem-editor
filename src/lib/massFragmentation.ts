import type { ChemDrawText } from '../types/chemdraw';
import type { Atom, Bond } from '../types/chemistry';
import type { DocumentStyleSettings } from '../types/settings';
import { getAtomAlias, getAtomLeadElement } from './atomIdentity';
import { chemDrawImplicitHydrogens } from './chemistry/displayHydrogens';
import { ELEMENTS } from './elements';

/**
 * The Mass Fragmentation tool (ChemDraw 17.1 guide, "Mass Fragmentation"): a line dragged across
 * bonds breaks them homolytically, and each side's formula and exact mass are shown. The
 * structure itself is not changed. Atoms keep the hydrogens they had before the cut (a broken
 * single bond leaves a radical, not a hydrogen); everything on one side of the line counts
 * together; if the bonds crossed leave the structure in one piece (a single ring bond) there is
 * one formula, the whole structure's.
 */
export interface FragmentSide {
  atomIds: string[];
  formula: string;
  exactMass: number;
  /** Electrons left unpaired by the cut, one per broken bond order. */
  radicals: number;
}

type Point = { x: number; y: number };

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const cross = (p: Point, q: Point, r: Point) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** The bonds a polyline crosses. */
export function bondsCrossedBy(
  path: readonly Point[],
  atoms: readonly Atom[],
  bonds: readonly Bond[],
): Bond[] {
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  return bonds.filter((bond) => {
    const a = byId.get(bond.from);
    const b = byId.get(bond.to);
    if (!a || !b) return false;
    for (let i = 1; i < path.length; i += 1) {
      if (segmentsCross(a, b, path[i - 1]!, path[i]!)) return true;
    }
    return false;
  });
}

/**
 * Hydrogens an atom carries as drawn: ChemDraw's measured count for labelled atoms, else the
 * lowest standard valence that its bonds and charge leave room in.
 */
function impliedHydrogens(element: string, charge: number, bondOrderSum: number): number {
  const measured = chemDrawImplicitHydrogens(element, charge, bondOrderSum);
  if (measured != null) return measured;
  const used = bondOrderSum + Math.abs(charge);
  const valence = (ELEMENTS[element]?.valencies ?? []).find((v) => v >= used);
  return valence == null ? 0 : valence - used;
}

function hillFormula(counts: Map<string, number>): string {
  const symbols = [...counts.keys()];
  const hasCarbon = counts.has('C');
  const rank = (s: string) => (hasCarbon ? (s === 'C' ? 0 : s === 'H' ? 1 : 2) : 2);
  return symbols
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((s) => `${s}${counts.get(s)! > 1 ? counts.get(s) : ''}`)
    .join('');
}

/**
 * The fragments on each side of `path`, or null when it crosses no bond or touches an atom whose
 * formula is not known here (a nickname or generic label).
 */
export function fragmentAcross(
  path: readonly Point[],
  atoms: readonly Atom[],
  bonds: readonly Bond[],
): FragmentSide[] | null {
  const crossed = bondsCrossedBy(path, atoms, bonds);
  if (crossed.length === 0) return null;
  const crossedIds = new Set(crossed.map((bond) => bond.id));
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));

  // The structures the line cuts, as they were.
  const whole = new Set<string>();
  const adjacency = new Map<string, Bond[]>();
  for (const bond of bonds) {
    for (const id of [bond.from, bond.to]) adjacency.set(id, [...(adjacency.get(id) ?? []), bond]);
  }
  const flood = (start: string, skip: ReadonlySet<string>, into: Set<string>) => {
    const stack = [start];
    while (stack.length) {
      const id = stack.pop()!;
      if (into.has(id)) continue;
      into.add(id);
      for (const bond of adjacency.get(id) ?? []) {
        if (skip.has(bond.id)) continue;
        stack.push(bond.from === id ? bond.to : bond.from);
      }
    }
  };
  for (const bond of crossed) flood(bond.from, new Set(), whole);

  // Hydrogens and formula contributions as drawn, before anything is broken.
  const hydrogens = new Map<string, number>();
  for (const id of whole) {
    const atom = byId.get(id)!;
    if (getAtomAlias(atom)) return null;
    const order = (adjacency.get(id) ?? []).reduce((sum, bond) => sum + (bond.order || 1), 0);
    const element = getAtomLeadElement(atom);
    if (!ELEMENTS[element]) return null;
    hydrogens.set(id, impliedHydrogens(element, atom.charge ?? 0, Math.round(order)));
  }

  // Pieces once the crossed bonds are gone, gathered by the side of the line they lie on.
  const pieces: Set<string>[] = [];
  const seen = new Set<string>();
  for (const id of whole) {
    if (seen.has(id)) continue;
    const piece = new Set<string>();
    flood(id, crossedIds, piece);
    piece.forEach((member) => seen.add(member));
    pieces.push(piece);
  }
  const [p0, p1] = [path[0]!, path[path.length - 1]!];
  const side = (piece: Set<string>) => {
    const members = [...piece].map((id) => byId.get(id)!);
    const cx = members.reduce((sum, atom) => sum + atom.x, 0) / members.length;
    const cy = members.reduce((sum, atom) => sum + atom.y, 0) / members.length;
    return (p1.x - p0.x) * (cy - p0.y) - (p1.y - p0.y) * (cx - p0.x) >= 0 ? 1 : -1;
  };
  const groups =
    pieces.length === 1
      ? [pieces[0]!]
      : [1, -1].map((s) => new Set(pieces.filter((p) => side(p) === s).flatMap((p) => [...p])));

  return groups
    .filter((group) => group.size > 0)
    .map((group) => {
      const counts = new Map<string, number>();
      let mass = 0;
      for (const id of group) {
        const element = getAtomLeadElement(byId.get(id)!);
        counts.set(element, (counts.get(element) ?? 0) + 1);
        mass += ELEMENTS[element]!.exact;
        const h = hydrogens.get(id) ?? 0;
        if (h > 0) {
          counts.set('H', (counts.get('H') ?? 0) + h);
          mass += h * ELEMENTS.H!.exact;
        }
      }
      const radicals =
        pieces.length === 1
          ? 0
          : crossed
              .filter((bond) => group.has(bond.from) !== group.has(bond.to))
              .reduce((sum, bond) => sum + Math.round(bond.order || 1), 0);
      return { atomIds: [...group], formula: hillFormula(counts), exactMass: mass, radicals };
    });
}

/**
 * Each side's formula and exact mass as a caption, as ChemDraw 26.1.0.6801 writes it (measured by
 * dragging the Mass Fragmentation tool across the middle bond of isopentanol; gaps.md): two
 * centred lines in the caption style, "Chemical formula: " then the formula, its digits subscript
 * and one superscript bullet per radical, over "Exact mass: " with five decimals. The caption
 * stands 7.5pt clear of its structure (3.6pt more past a heteroatom's label), centred on its
 * horizontal extent, below it when the side lies below the line and above it otherwise; ChemDraw
 * chose the vertical both times though the line was a diagonal.
 */
const CAPTION_CLEARANCE = 7.5;
const LABEL_HALF_HEIGHT = 3.6;
/** First baseline below a two-line caption's top edge at the caption size 10: 10.87pt. */
const FIRST_BASELINE_OF_SIZE = 1.087;
const TWO_LINE_HEIGHT_OF_SIZE = 2.25;

export function fragmentationCaptions(
  sides: readonly FragmentSide[],
  atoms: readonly Atom[],
  path: readonly Point[],
  settings: DocumentStyleSettings,
  newId: () => string,
): ChemDrawText[] {
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));
  const [p0, p1] = [path[0]!, path[path.length - 1]!];
  const length = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
  const normal = { x: -(p1.y - p0.y) / length, y: (p1.x - p0.x) / length };
  const size = settings.nativeMetrics.captionSize;
  return sides.map((side) => {
    const members = side.atomIds.map((id) => byId.get(id)!).filter(Boolean);
    const cx = members.reduce((sum, atom) => sum + atom.x, 0) / members.length;
    const cy = members.reduce((sum, atom) => sum + atom.y, 0) / members.length;
    const left = Math.min(...members.map((atom) => atom.x));
    const right = Math.max(...members.map((atom) => atom.x));
    const pad = (atom: Atom) => (getAtomLeadElement(atom) === 'C' ? 0 : LABEL_HALF_HEIGHT);
    const top = Math.min(...members.map((atom) => atom.y - pad(atom)));
    const bottom = Math.max(...members.map((atom) => atom.y + pad(atom)));
    // Which side of the line this structure lies on; a single formula goes below.
    const awayY =
      sides.length === 1
        ? 1
        : ((cx - p0.x) * normal.x + (cy - p0.y) * normal.y >= 0 ? normal.y : -normal.y) >= 0
          ? 1
          : -1;
    const topEdge =
      awayY > 0
        ? bottom + CAPTION_CLEARANCE
        : top - CAPTION_CLEARANCE - TWO_LINE_HEIGHT_OF_SIZE * size;
    return {
      id: newId(),
      type: 'text',
      anchor: { x: (left + right) / 2, y: topEdge + FIRST_BASELINE_OF_SIZE * size },
      text: {
        runs: [
          { text: 'Chemical formula: ' },
          { text: side.formula, formula: true },
          ...(side.radicals > 0 ? [{ text: '\u2022'.repeat(side.radicals), sup: true }] : []),
          { text: `\nExact mass: ${side.exactMass.toFixed(5)}` },
        ],
        justification: 'center',
      },
      style: {
        fontFamily: settings.nativeMetrics.captionFontFamily,
        fontSize: size,
      },
    };
  });
}
