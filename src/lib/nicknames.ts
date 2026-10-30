import type { Atom, Bond, CanvasState } from '../types/chemistry';
import { getAtomAlias, getAtomLeadElement, setAliasAtomValue } from './atomIdentity';
import { SHORTHAND_DATA, type ShorthandEntry } from './shorthand';
import { graphStructureKey, smilesStructureKey } from './smilesKey';

/**
 * Structure > Contract Label (ChemDraw 17.1 guide, "Expanding Labels" / "Contracting Labels"):
 * a selected substructure joined to the rest by one bond becomes one atom labelled with the
 * nickname whose structure it is. The substructure is keyed rooted at the atom on that bond, the
 * same key the shorthand's SMILES gets rooted at its attachment atom.
 */
export interface ContractionPlan {
  alias: string;
  rootId: string;
  /** The bond to the rest of the structure (absent for a whole, unattached molecule). */
  externalBondId?: string;
}

export function findNicknameForSelection(
  atoms: readonly Atom[],
  bonds: readonly Bond[],
  selected: ReadonlySet<string>,
  library: Record<string, ShorthandEntry> = SHORTHAND_DATA,
): ContractionPlan | { error: string } {
  const inside = atoms.filter((atom) => selected.has(atom.id));
  if (inside.length < 2) return { error: 'Select the atoms of the group to contract.' };
  if (inside.some((atom) => getAtomAlias(atom))) {
    return { error: 'The selection already contains a label.' };
  }
  const crossing = bonds.filter((bond) => selected.has(bond.from) !== selected.has(bond.to));
  if (crossing.length > 1) {
    return { error: 'A label can replace a group joined to the rest by one bond only.' };
  }
  const external = crossing[0];
  const root = external
    ? selected.has(external.from)
      ? external.from
      : external.to
    : inside[0]!.id;
  const order = [root, ...inside.map((atom) => atom.id).filter((id) => id !== root)];
  const indexOf = new Map(order.map((id, index) => [id, index]));
  const byId = new Map(inside.map((atom) => [atom.id, atom]));
  const key = graphStructureKey({
    atoms: order.map((id) => getAtomLeadElement(byId.get(id)!).toUpperCase()),
    bonds: bonds
      .filter((bond) => selected.has(bond.from) && selected.has(bond.to))
      .map((bond) => [indexOf.get(bond.from)!, indexOf.get(bond.to)!, Math.round(bond.order || 1)]),
  });
  for (const [alias, entry] of Object.entries(library)) {
    if (!entry.subsSmiles || entry.valency !== 1) continue;
    if (smilesStructureKey(entry.subsSmiles) === key) {
      return { alias, rootId: root, ...(external ? { externalBondId: external.id } : {}) };
    }
  }
  return { error: 'No nickname matches the selected group.' };
}

/** The canvas with the planned group replaced by its labelled root atom. */
export function contractSelection(
  state: CanvasState,
  selected: ReadonlySet<string>,
  plan: ContractionPlan,
): CanvasState {
  return {
    ...state,
    atoms: state.atoms
      .filter((atom) => !selected.has(atom.id) || atom.id === plan.rootId)
      .map((atom) =>
        atom.id === plan.rootId
          ? setAliasAtomValue({ ...atom, charge: undefined, isotope: undefined }, plan.alias)
          : atom,
      ),
    bonds: state.bonds.filter((bond) => !(selected.has(bond.from) && selected.has(bond.to))),
  };
}
