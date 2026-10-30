import { expandSupportedAliasGraph } from './aliasGraphExpansion';
import { graphToMolblock } from './graph';
import type { ShorthandEntry } from './shorthand';
import type { Atom, Bond } from '../types/chemistry';
import type { RdkitModule } from '../types/rdkit';

/**
 * Stereochemistry indicators (ChemDraw 17.1 guide, "Stereochemistry Indicators"): the CIP label
 * of each stereocentre, `(R)` or `(S)`, and of each stereo double bond, `(E)` or `(Z)`, perceived
 * by RDKit from the drawn wedges and coordinates. Nicknames are expanded first so a label's
 * substituents count; atoms the expansion adds are not on the canvas and get no label.
 */
export interface StereoLabels {
  atoms: Map<string, string>;
  bonds: Map<string, string>;
}

export function computeStereoLabels(
  rdkit: RdkitModule,
  atoms: Atom[],
  bonds: Bond[],
  resolveAliasEntry: (atom: Atom, label: string | undefined) => ShorthandEntry | undefined,
): StereoLabels {
  const labels: StereoLabels = { atoms: new Map(), bonds: new Map() };
  if (atoms.length === 0) return labels;
  const expanded = expandSupportedAliasGraph(rdkit, atoms, bonds, resolveAliasEntry);
  const graph = expanded ?? { atoms, bonds };
  // The molblock's atom i is graph.atoms[i]; expansion keeps the canvas atoms first, by id.
  const { molblock } = graphToMolblock(
    graph.atoms,
    graph.bonds,
    1,
    1,
    expanded ? undefined : resolveAliasEntry,
  );
  let mol: ReturnType<RdkitModule['get_mol']> = null;
  try {
    mol = rdkit.get_mol(molblock);
    const json = mol?.get_stereo_tags?.();
    if (!json) return labels;
    const parsed = JSON.parse(json) as {
      CIP_atoms?: Array<[number, string]>;
      CIP_bonds?: Array<[number, number, string]>;
    };
    const onCanvas = new Set(atoms.map((atom) => atom.id));
    for (const [index, label] of parsed.CIP_atoms ?? []) {
      const id = graph.atoms[index]?.id;
      if (id && onCanvas.has(id)) labels.atoms.set(id, label);
    }
    const bondIds = new Set(bonds.map((bond) => bond.id));
    for (const [begin, end, label] of parsed.CIP_bonds ?? []) {
      const a = graph.atoms[begin]?.id;
      const b = graph.atoms[end]?.id;
      const bond = graph.bonds.find(
        (entry) => (entry.from === a && entry.to === b) || (entry.from === b && entry.to === a),
      );
      if (bond && bondIds.has(bond.id)) labels.bonds.set(bond.id, label);
    }
  } catch {
    // A structure RDKit rejects simply has no indicators.
  } finally {
    mol?.delete();
  }
  return labels;
}
