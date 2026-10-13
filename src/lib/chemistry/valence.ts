/**
 * Allowed valences by element, charge and radical count.
 *
 * Replaces the single-valence `VALENCIES` table for *validation*: that table flagged every
 * sulfoxide, sulfone, phosphate and ClF3 as an error. Charge is handled by the isoelectronic
 * rule (N+ behaves as C, O- as F, S+ as P, ...), the same approach RDKit and Ketcher's
 * group-based `Atom.calcValence` take. Elements outside the p-block and H return `null`:
 * their valence is variable and must not raise an error.
 *
 * This is deliberately not used for drawn hydrogen counts. Those follow ChemDraw's display
 * rules, which are verified through `pnpm test:chemdraw:mac`, not RDKit's.
 */

interface PBlockEntry {
  /** valence electrons of the neutral atom */
  ve: number;
  /** row 2 elements have no hypervalent states */
  row2: boolean;
}

const P_BLOCK: Record<string, PBlockEntry> = {
  B: { ve: 3, row2: true },
  C: { ve: 4, row2: true },
  N: { ve: 5, row2: true },
  O: { ve: 6, row2: true },
  F: { ve: 7, row2: true },
  Al: { ve: 3, row2: false },
  Si: { ve: 4, row2: false },
  P: { ve: 5, row2: false },
  S: { ve: 6, row2: false },
  Cl: { ve: 7, row2: false },
  Ga: { ve: 3, row2: false },
  Ge: { ve: 4, row2: false },
  As: { ve: 5, row2: false },
  Se: { ve: 6, row2: false },
  Br: { ve: 7, row2: false },
  In: { ve: 3, row2: false },
  Sn: { ve: 4, row2: false },
  Sb: { ve: 5, row2: false },
  Te: { ve: 6, row2: false },
  I: { ve: 7, row2: false },
  At: { ve: 7, row2: false },
};

function valencesForElectrons(ve: number, row2: boolean): number[] | null {
  switch (ve) {
    case 3:
      return [3];
    case 4:
      return [4];
    case 5:
      return row2 ? [3] : [3, 5];
    case 6:
      return row2 ? [2] : [2, 4, 6];
    case 7:
      return row2 ? [1] : [1, 3, 5, 7];
    default:
      return null;
  }
}

/**
 * Ascending list of valences the atom may take, or `null` when unknown/variable.
 * `radicalElectrons` unpaired electrons each consume one valence.
 */
export function allowedValences(
  element: string,
  charge = 0,
  radicalElectrons = 0,
): number[] | null {
  if (!Number.isFinite(charge) || !Number.isFinite(radicalElectrons)) return null;
  let base: number[] | null;
  if (element === 'H' || element === 'D' || element === 'T') {
    const ve = 1 - charge;
    base = ve === 1 ? [1] : ve === 0 || ve === 2 ? [0] : null;
  } else {
    const entry = P_BLOCK[element];
    if (!entry) return null;
    base = valencesForElectrons(entry.ve - charge, entry.row2);
  }
  if (!base) return null;
  const rad = Math.max(0, Math.round(radicalElectrons));
  const adjusted = base.map((v) => v - rad).filter((v) => v >= 0);
  return adjusted.length > 0 ? adjusted : null;
}

export interface ValenceCheck {
  ok: boolean;
  /** valences the atom may take; empty when unknown */
  allowed: number[];
}

/**
 * Is `bondOrderSum` a legal valence? Unknown elements and non-integral sums (aromatic
 * bonds drawn at order 1.5) are never reported as errors.
 */
export function checkValence(
  element: string,
  charge: number,
  radicalElectrons: number,
  bondOrderSum: number,
): ValenceCheck {
  const allowed = allowedValences(element, charge, radicalElectrons);
  if (!allowed) return { ok: true, allowed: [] };
  if (!Number.isInteger(bondOrderSum)) return { ok: true, allowed };
  // An atom may be under-valent (implicit hydrogens fill it); it is wrong only when it exceeds
  // the largest allowed valence.
  const max = allowed[allowed.length - 1];
  if (bondOrderSum > max) return { ok: false, allowed };
  return { ok: true, allowed };
}
