import type { Atom, Bond } from '../types/chemistry';

/**
 * Lookups over the flat atom/bond arrays that every label and bond computation needs.
 *
 * Callers used to scan the whole graph per atom (`bonds.filter`, `atoms.find`), which made a
 * paint O(atoms x (atoms + bonds)). Frozen arrays are immutable, so an index built for one is
 * valid for its lifetime and is cached by array identity. Arrays that are not frozen may still
 * be mutated in place, so they fall back to the plain scan and behave exactly as before.
 *
 * Results match the scans: bonds come back in array order, a self-bond appears once, and the
 * first atom wins when an id repeats.
 */
const bondsByAtom = new WeakMap<readonly Bond[], Map<string, Bond[]>>();
const atomsById = new WeakMap<readonly Atom[], Map<string, Atom>>();
const NONE: readonly Bond[] = Object.freeze([]);

export function bondsOfAtom(atomId: string, bonds: readonly Bond[]): readonly Bond[] {
  if (!Object.isFrozen(bonds)) {
    return bonds.filter((bond) => bond.from === atomId || bond.to === atomId);
  }
  let index = bondsByAtom.get(bonds);
  if (!index) {
    index = new Map();
    for (const bond of bonds) {
      for (const id of bond.from === bond.to ? [bond.from] : [bond.from, bond.to]) {
        const list = index.get(id);
        if (list) list.push(bond);
        else index.set(id, [bond]);
      }
    }
    bondsByAtom.set(bonds, index);
  }
  return index.get(atomId) ?? NONE;
}

export function findAtomById(atomId: string, atoms: readonly Atom[]): Atom | undefined {
  if (!Object.isFrozen(atoms)) return atoms.find((atom) => atom.id === atomId);
  let index = atomsById.get(atoms);
  if (!index) {
    index = new Map();
    for (const atom of atoms) if (!index.has(atom.id)) index.set(atom.id, atom);
    atomsById.set(atoms, index);
  }
  return index.get(atomId);
}
