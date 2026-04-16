import type { Atom, Bond } from '../types/chemistry';
import type { RdkitModule, RdkitMol } from '../types/rdkit';
import type { ShorthandEntry } from './shorthand';
import { getAtomKind, getAtomLeadElement, getAtomNodeText } from './atomIdentity';

export type AliasEntryResolver = (
  atom: Atom,
  label: string | undefined,
) => ShorthandEntry | undefined;

interface ParsedFragmentAtom {
  x: number;
  y: number;
  element: string;
  charge?: number;
  isotope?: number;
  mapNum?: number;
}

interface ParsedFragmentBond {
  from: number;
  to: number;
  order: number;
}

interface FragmentTemplate {
  atoms: ParsedFragmentAtom[];
  bonds: ParsedFragmentBond[];
}

function parseFragmentTemplate(molblock: string): FragmentTemplate | null {
  const lines = molblock.split('\n');
  const countsLine = lines[3];
  if (!countsLine || countsLine.length < 6) return null;

  const atomCount = Number.parseInt(countsLine.slice(0, 3).trim(), 10);
  const bondCount = Number.parseInt(countsLine.slice(3, 6).trim(), 10);
  if (
    !Number.isFinite(atomCount) ||
    atomCount <= 0 ||
    !Number.isFinite(bondCount) ||
    bondCount < 0
  ) {
    return null;
  }

  const atoms: ParsedFragmentAtom[] = [];
  for (let index = 0; index < atomCount; index += 1) {
    const line = lines[index + 4];
    if (!line || line.length < 34) return null;
    atoms.push({
      x: Number.parseFloat(line.slice(0, 10)) * 30,
      y: -Number.parseFloat(line.slice(10, 20)) * 30,
      element: line.slice(31, 34).trim(),
      mapNum: Number.parseInt(line.slice(60, 63).trim(), 10) || undefined,
    });
  }

  const bonds: ParsedFragmentBond[] = [];
  for (let index = 0; index < bondCount; index += 1) {
    const line = lines[atomCount + index + 4];
    if (!line || line.length < 9) return null;
    bonds.push({
      from: Number.parseInt(line.slice(0, 3).trim(), 10) - 1,
      to: Number.parseInt(line.slice(3, 6).trim(), 10) - 1,
      order: Number.parseInt(line.slice(6, 9).trim(), 10) || 1,
    });
  }

  for (const line of lines.slice(atomCount + bondCount + 4)) {
    if (line.startsWith('M  CHG')) {
      const count = Number.parseInt(line.slice(6, 9).trim(), 10);
      for (let index = 0; index < count; index += 1) {
        const cursor = 10 + index * 8;
        const atomIndex = Number.parseInt(line.slice(cursor, cursor + 4).trim(), 10) - 1;
        const charge = Number.parseInt(line.slice(cursor + 4, cursor + 8).trim(), 10);
        if (
          Number.isFinite(atomIndex) &&
          atomIndex >= 0 &&
          atomIndex < atoms.length &&
          Number.isFinite(charge)
        ) {
          atoms[atomIndex].charge = charge;
        }
      }
      continue;
    }

    if (line.startsWith('M  ISO')) {
      const count = Number.parseInt(line.slice(6, 9).trim(), 10);
      for (let index = 0; index < count; index += 1) {
        const cursor = 10 + index * 8;
        const atomIndex = Number.parseInt(line.slice(cursor, cursor + 4).trim(), 10) - 1;
        const isotope = Number.parseInt(line.slice(cursor + 4, cursor + 8).trim(), 10);
        if (
          Number.isFinite(atomIndex) &&
          atomIndex >= 0 &&
          atomIndex < atoms.length &&
          Number.isFinite(isotope)
        ) {
          atoms[atomIndex].isotope = isotope;
        }
      }
    }
  }

  return { atoms, bonds };
}

function loadFragmentTemplate(rdkit: RdkitModule, smiles: string): FragmentTemplate | null {
  let mol: RdkitMol | null = null;
  try {
    mol = rdkit.get_mol(smiles);
  } catch {
    /* sanitized parse may throw */
  }
  if (!mol) {
    try {
      mol = rdkit.get_mol(smiles, JSON.stringify({ sanitize: false }));
    } catch {
      /* intentional */
    }
  }
  if (!mol || typeof mol.set_new_coords !== 'function' || typeof mol.get_molblock !== 'function') {
    mol?.delete();
    return null;
  }
  try {
    try {
      mol.set_new_coords();
    } catch {
      /* may fail on unsanitized mol — proceed with default coords */
    }
    return parseFragmentTemplate(mol.get_molblock());
  } catch {
    return null;
  } finally {
    mol.delete();
  }
}

export function expandSupportedAliasGraph(
  rdkit: RdkitModule | null,
  atoms: Atom[],
  bonds: Bond[],
  resolveAliasEntry: AliasEntryResolver,
): { atoms: Atom[]; bonds: Bond[] } | null {
  if (!rdkit) return null;

  const templateCache = new Map<string, FragmentTemplate | null>();
  const expandedAtoms: Atom[] = atoms.map((atom) => ({
    ...atom,
    kind: 'element',
    element: getAtomLeadElement(atom),
    alias: undefined,
    aliasResolution: undefined,
    labelRuns: undefined,
  }));
  const expandedBonds: Bond[] = bonds.map((bond) => ({ ...bond }));
  let containsExpandedAliases = false;

  const rerouteBondEndpoint = (
    atomId: string,
    previousId: string,
    nextId: string,
    bondIndex: number,
  ) => {
    const bond = expandedBonds[bondIndex];
    if (bond.from === previousId) bond.from = nextId;
    if (bond.to === previousId) bond.to = nextId;
    if (bond.from === previousId && bond.to === previousId) {
      expandedBonds[bondIndex] = { ...bond, from: atomId, to: nextId };
    }
  };

  for (let atomIndex = 0; atomIndex < atoms.length; atomIndex += 1) {
    const atom = atoms[atomIndex];
    const entry =
      getAtomKind(atom) === 'alias' ? resolveAliasEntry(atom, getAtomNodeText(atom)) : undefined;
    if (!entry?.subsSmiles) continue;

    const templateSmiles = entry.residueTemplateSmiles ?? entry.subsSmiles;
    if (!templateSmiles) continue;

    let template = templateCache.get(templateSmiles);
    if (template === undefined) {
      template = loadFragmentTemplate(rdkit, templateSmiles);
      templateCache.set(templateSmiles, template);
    }
    if (!template || template.atoms.length === 0) return null;

    containsExpandedAliases = true;
    const attachmentAIndex = template.atoms.findIndex((fragmentAtom) => fragmentAtom.mapNum === 1);
    const attachmentBIndex = template.atoms.findIndex((fragmentAtom) => fragmentAtom.mapNum === 2);
    const anchorIndex = template.atoms.findIndex((fragmentAtom) => fragmentAtom.mapNum === 3);
    const rootIndex = anchorIndex >= 0 ? anchorIndex : 0;
    const root = template.atoms[rootIndex];
    const rootAtom = expandedAtoms[atomIndex];
    expandedAtoms[atomIndex] = {
      ...rootAtom,
      element: root.element,
      ...(root.charge != null ? { charge: root.charge } : {}),
      ...(root.isotope != null ? { isotope: root.isotope } : {}),
    };

    const rootX = root.x;
    const rootY = root.y;
    const fragmentIdByIndex = new Map<number, string>([[rootIndex, atom.id]]);
    template.atoms.forEach((fragmentAtom, fragmentIndex) => {
      if (fragmentIndex === rootIndex) return;
      const fragmentId = `${atom.id}::alias::${fragmentIndex}`;
      fragmentIdByIndex.set(fragmentIndex, fragmentId);
      expandedAtoms.push({
        id: fragmentId,
        x: atom.x + (fragmentAtom.x - rootX),
        y: atom.y + (fragmentAtom.y - rootY),
        kind: 'element',
        element: fragmentAtom.element,
        ...(fragmentAtom.charge != null ? { charge: fragmentAtom.charge } : {}),
        ...(fragmentAtom.isotope != null ? { isotope: fragmentAtom.isotope } : {}),
      });
    });

    template.bonds.forEach((fragmentBond, bondIndex) => {
      const from = fragmentIdByIndex.get(fragmentBond.from) ?? atom.id;
      const to = fragmentIdByIndex.get(fragmentBond.to) ?? atom.id;
      expandedBonds.push({
        id: `${atom.id}::alias-bond::${bondIndex}`,
        from,
        to,
        order: fragmentBond.order,
      });
    });

    if (entry.residueTemplateSmiles && attachmentAIndex >= 0 && attachmentBIndex >= 0) {
      const connectedBondIndices: number[] = [];
      bonds.forEach((bond, bondIndex) => {
        if (bond.from === atom.id || bond.to === atom.id) connectedBondIndices.push(bondIndex);
      });
      const connectedNeighbors = connectedBondIndices
        .map((bondIndex) => {
          const bond = bonds[bondIndex];
          const neighborId = bond.from === atom.id ? bond.to : bond.from;
          const neighbor = atoms.find((candidate) => candidate.id === neighborId);
          return neighbor ? { bondIndex, neighbor } : null;
        })
        .filter((value): value is { bondIndex: number; neighbor: Atom } => Boolean(value))
        .sort((left, right) => left.neighbor.x - right.neighbor.x);

      connectedNeighbors.forEach(({ bondIndex, neighbor }, index) => {
        const onlyNeighbor = connectedNeighbors.length === 1;
        const useLeftAttachment = onlyNeighbor ? neighbor.x <= atom.x : index === 0;
        const targetIndex = useLeftAttachment ? attachmentAIndex : attachmentBIndex;
        const targetId = fragmentIdByIndex.get(targetIndex) ?? atom.id;
        rerouteBondEndpoint(atom.id, atom.id, targetId, bondIndex);
      });
    }
  }

  return containsExpandedAliases ? { atoms: expandedAtoms, bonds: expandedBonds } : null;
}
