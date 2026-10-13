/**
 * Implicit hydrogens ChemDraw displays on an unlabelled heteroatom, by element, charge and total
 * bond order.
 *
 * Measured on ChemDraw 26.1.0.6801 (macOS) by handing it a document whose heteroatom carries no
 * label and reading the label it writes back: 11 elements, charges -1/0/+1, and 0-4 single bonds or
 * one double bond plus 0-3 singles, 324 cases (27 per element) (`development/chemdraw-implicit-hydrogens.md`).
 *
 * The rule that fits every measured row:
 *
 * - the atom takes the valences of the neutral element isoelectronic with it (N+ behaves as C,
 *   S+ as P, Cl+ as S): `group - charge` valence electrons;
 * - a second-row atom has one valence; a third-row or later atom steps through the odd or even
 *   ladder (3, 5 / 2, 4, 6 / 1, 3, 5, 7);
 * - the hydrogens are the distance up to the smallest valence that is not below the bond order sum,
 *   and none when the sum is above them all;
 * - two measured exceptions: with no bond at all an isolated atom of valence-electron count 5 in
 *   row 3 or later (P, Si-, S+, Se+), B+ and a halide ion show no hydrogens; and Br- and I- keep a valence ladder
 *   that Cl- lacks (Br- shows one hydrogen on one bond, I- on one, three or five).
 *
 * Elements, charges or bond sums outside the measurement return `null`, so the caller keeps its
 * own rule rather than inventing a ChemDraw behaviour.
 */

const GROUP_ELECTRONS: Record<string, number> = {
  B: 3,
  Si: 4,
  N: 5,
  P: 5,
  O: 6,
  S: 6,
  Se: 6,
  F: 7,
  Cl: 7,
  Br: 7,
  I: 7,
};
const SECOND_ROW = new Set(['B', 'N', 'O', 'F']);

function ladder(element: string, valenceElectrons: number): number[] {
  const secondRow = SECOND_ROW.has(element);
  switch (valenceElectrons) {
    case 2:
      return [2];
    case 3:
      return [3];
    case 4:
      return [4];
    case 5:
      return secondRow ? [3] : [3, 5];
    case 6:
      return secondRow ? [2] : [2, 4, 6];
    case 7:
      return secondRow ? [1] : [1, 3, 5, 7];
    case 8:
      // Anions of the heavier halogens still bond, to a limit that differs by element.
      if (element === 'Br') return [2];
      if (element === 'I') return [2, 4, 6];
      return [];
    default:
      return [];
  }
}

/**
 * Neutral atoms with no bond, for elements the bonded measurement did not cover (ChemDraw
 * 26.1.0.6801, 2026-10-13). Ge, Sn and Ga take fewer hydrogens than their group valence, As and
 * Sb none, like phosphorus.
 */
const ISOLATED_NEUTRAL_HYDROGENS: Record<string, number> = {
  Al: 3,
  Ga: 2,
  Ge: 2,
  Sn: 2,
  As: 0,
  Sb: 0,
  Te: 2,
};

export function chemDrawImplicitHydrogens(
  element: string,
  charge: number,
  bondOrderSum: number,
): number | null {
  if (bondOrderSum === 0 && charge === 0 && element in ISOLATED_NEUTRAL_HYDROGENS) {
    return ISOLATED_NEUTRAL_HYDROGENS[element]!;
  }
  const group = GROUP_ELECTRONS[element];
  if (group === undefined) return null;
  if (!Number.isInteger(charge) || Math.abs(charge) > 1) return null;
  if (!Number.isInteger(bondOrderSum) || bondOrderSum < 0 || bondOrderSum > 6) return null;

  const electrons = group - charge;
  if (
    bondOrderSum === 0 &&
    (electrons === 2 || electrons === 8 || (electrons === 5 && !SECOND_ROW.has(element)))
  )
    return 0;
  for (const valence of ladder(element, electrons)) {
    if (valence >= bondOrderSum) return valence - bondOrderSum;
  }
  return 0;
}
