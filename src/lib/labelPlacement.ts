import type { Atom, Bond } from '../types/chemistry';
import { bondsOfAtom, findAtomById } from './graphLookup';

/** ChemDraw's `LabelAlignment` values that placement can resolve to. */
export type LabelSide = 'left' | 'right' | 'above' | 'below';

/** How far the label direction may sit from vertical and still stack (measured: 22.5 degrees). */
const STACK_HALF_ANGLE = Math.PI / 8;
const EPSILON = 1e-6;

const HYDROGEN_FIRST_WHEN_ISOLATED = new Set(['O', 'S', 'Se', 'Te', 'F', 'Cl', 'Br', 'I']);

/**
 * Which side of an atom ChemDraw lays its generated label out on, from the directions of the
 * atom's bonds.
 *
 * Measured on ChemDraw 26.1.0.6801 (2026-10-13) by handing it heteroatoms with no label and
 * reading the `LabelAlignment` it saved, 210 element/charge/bond-count combinations and a
 * 2-degree sweep across the stacking boundary. The rule does not depend on the element, the
 * charge or how many hydrogens there are:
 *
 * - The label goes in the middle of the largest angular gap between bonds. Ties go to the gap
 *   whose centre is in the upper half-plane, then to the one nearest vertical, then to the one
 *   furthest to the right (angles counter-clockwise from +x, y up).
 * - With one bond there is no gap to speak of: the label goes opposite the bond, to the right of
 *   the atom unless the bond points right, and to the right when the bond is vertical.
 * - A label with hydrogens stacks (the hydrogens on a second line, under the atom if the gap
 *   points down and over it if it points up) when the gap centre is within 22.5 degrees of
 *   vertical and the atom has two or more bonds. Otherwise it goes left or right.
 *
 * `right` means ChemDraw's `Right` alignment: the text ends at the atom, so the label body is to
 * the left and a hydrogen-first label reads `HN`. `left` is the usual `NH`.
 *
 * An atom with no bonds has no gap to measure. ChemDraw (the same 2026-10-13 run, 62 isolated
 * element and charge combinations) writes its hydrogens first, `H2O`, `HF`, `HCl`, `H2S`, `H2Se`,
 * `H2Te`, only for the neutral oxygen-group and halogen atoms; everything else keeps the atom
 * first: `NH3`, `NH4+`, `OH-`, `OH3+`, `ClH2+`, `BH3`, `SiH4`, `AlH3`, `GeH2`, `CH3-`.
 */
export function resolveGeneratedLabelSide(
  atom: Atom,
  atoms: Atom[],
  bonds: Bond[],
  options: { hasHydrogens: boolean; element?: string; charge?: number },
): LabelSide | null {
  const angles: number[] = [];
  for (const bond of bondsOfAtom(atom.id, bonds)) {
    const other = findAtomById(bond.from === atom.id ? bond.to : bond.from, atoms);
    if (!other) continue;
    const dx = other.x - atom.x;
    const dy = atom.y - other.y; // y up
    if (Math.hypot(dx, dy) < EPSILON) continue;
    angles.push(Math.atan2(dy, dx));
  }
  if (angles.length === 0) {
    const neutral = (options.charge ?? 0) === 0;
    return options.hasHydrogens &&
      neutral &&
      HYDROGEN_FIRST_WHEN_ISOLATED.has(options.element ?? '')
      ? 'right'
      : 'left';
  }

  if (angles.length === 1) {
    const bondDx = Math.cos(angles[0]!);
    return bondDx > Math.sin(Math.PI / 180) ? 'right' : 'left';
  }

  const sorted = angles.map((a) => (a + 2 * Math.PI) % (2 * Math.PI)).sort((a, b) => a - b);
  let largest = 0;
  const centres: number[] = [];
  sorted.forEach((angle, i) => {
    const next = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + 2 * Math.PI;
    const gap = next - angle;
    if (gap > largest + EPSILON) {
      largest = gap;
      centres.length = 0;
    }
    if (Math.abs(gap - largest) <= EPSILON) centres.push((angle + gap / 2) % (2 * Math.PI));
  });

  const vertical = (angle: number) => Math.abs(Math.sin(angle));
  const upper = centres.filter((c) => c >= -EPSILON && c < Math.PI - EPSILON);
  const pool = upper.length > 0 ? upper : centres;
  const direction = pool.reduce((best, c) => {
    const bv = vertical(best);
    const cv = vertical(c);
    if (cv > bv + EPSILON) return c;
    if (cv < bv - EPSILON) return best;
    return Math.cos(c) > Math.cos(best) ? c : best;
  });

  if (options.hasHydrogens) {
    const fromDown = Math.abs(
      Math.atan2(Math.sin(direction + Math.PI / 2), Math.cos(direction + Math.PI / 2)),
    );
    const fromUp = Math.abs(
      Math.atan2(Math.sin(direction - Math.PI / 2), Math.cos(direction - Math.PI / 2)),
    );
    if (fromDown <= STACK_HALF_ANGLE + EPSILON) return 'below';
    if (fromUp <= STACK_HALF_ANGLE + EPSILON) return 'above';
  }
  return Math.cos(direction) > EPSILON ? 'left' : Math.cos(direction) < -EPSILON ? 'right' : 'left';
}

/** Which letter of a lone multi-letter element symbol (Cl, Br, Si) sits on the atom. */
export type ElementLabelAnchor = 'first' | 'last' | 'whole';

/**
 * Where a bare element symbol of more than one letter is anchored on its atom.
 *
 * Read from the label positions of 296 Cl, Br, Si and Se atoms in 121 ChemDraw-authored documents:
 * a Left-justified label starts half its first letter before the atom (Br at -3.3, Cl at -3.6), a
 * Right-justified one ends half its last letter after it (Br at +1.7, Cl and Si at +1.1), and a
 * Centre-justified one is centred as a whole (Si, 0.0). Generated, those labels came out Centre
 * for all 173 atoms with three or more bonds, and Left or Right by the bond direction for one
 * bond, as for any other label (`resolveGeneratedLabelSide`).
 */
export function resolveElementLabelAnchor(
  atom: Atom,
  atoms: Atom[],
  bonds: Bond[],
  explicit?: 'left' | 'center' | 'right' | 'above' | 'below',
): ElementLabelAnchor {
  if (explicit === 'left') return 'first';
  if (explicit === 'right') return 'last';
  if (explicit) return 'whole';
  if (atom.labelOrientation === 'hydrogen-first') return 'last';
  if (atom.labelOrientation === 'label-first') return 'first';
  const connected = bondsOfAtom(atom.id, bonds).length;
  if (connected >= 3) return 'whole';
  const side = resolveGeneratedLabelSide(atom, atoms, bonds, { hasHydrogens: false });
  if (side === 'right') return 'last';
  return 'first';
}
