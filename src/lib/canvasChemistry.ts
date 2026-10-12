import { expandAliasSmiles, resolveAliasChemistry } from '../lib/aliasChemistry';
import { expandSupportedAliasGraph } from '../lib/aliasGraphExpansion';
import { getAtomAlias, getAtomLeadElement, isAliasAtom } from '../lib/atomIdentity';
import { resolveChemicalTextStructure } from '../lib/chemicalText';
import { isElementSymbol, VALENCIES } from '../lib/elements';
import { graphToMolblock } from '../lib/graph';
import { type ShorthandEntry } from '../lib/shorthand';
import type { Arrow, Atom, Bond, TextBox } from '../types/chemistry';
import type { RdkitModule, RdkitMol } from '../types/rdkit';

export function getAtomFreeValence(atom: Atom, bonds: Bond[]): number {
  const knownVal = VALENCIES[getAtomLeadElement(atom)] ?? null;
  if (knownVal === null) return 100; // variable valency — always allow bonding
  const usedVal = bonds
    .filter((b) => b.from === atom.id || b.to === atom.id)
    .reduce((s, b) => s + (b.order || 1), 0);
  return Math.max(0, knownVal - usedVal);
}

export function getCanvasContentBounds(
  atoms: Atom[],
  arrows: Arrow[],
  textBoxes: TextBox[],
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  const pts: { x: number; y: number }[] = [
    ...atoms.map((a) => ({ x: a.x, y: a.y })),
    ...arrows.flatMap((a) => [
      { x: a.x1, y: a.y1 },
      { x: a.x2, y: a.y2 },
      { x: a.cpx, y: a.cpy },
    ]),
    ...textBoxes.map((t) => ({ x: t.x, y: t.y })),
  ];
  if (!pts.length) return null;
  return {
    minX: Math.min(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxX: Math.max(...pts.map((p) => p.x)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
}

export function describeRdkitError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  return 'Chemistry engine rejected this structure';
}

export function buildAliasValidator(rdkit: RdkitModule | null) {
  if (!rdkit) return undefined;
  return (fragmentSmiles: string) => {
    const fragment = getMolWithFallback(rdkit, fragmentSmiles);
    if (!fragment) return { error: 'Chemistry engine rejected alias fragment' };
    let canonicalSmiles: string;
    try {
      canonicalSmiles = fragment.get_smiles();
    } catch {
      canonicalSmiles = fragmentSmiles;
    }
    fragment.delete();
    return { canonicalSmiles };
  };
}

export function getMolWithFallback(
  rdkit: RdkitModule | null,
  input: string,
  options?: { sanitizeOnly?: boolean },
): RdkitMol | null {
  if (!rdkit || !input.trim()) return null;

  const attempts: Array<() => RdkitMol | null> = options?.sanitizeOnly
    ? [() => rdkit.get_mol(input)]
    : [
        () => rdkit.get_mol(input),
        () => rdkit.get_mol(input, JSON.stringify({ sanitize: false, removeHs: false })),
      ];

  for (const attempt of attempts) {
    try {
      const mol = attempt();
      if (mol) return mol;
    } catch {
      /* intentional */
    }
  }
  return null;
}

export interface ResolvedChemicalInput {
  smiles: string;
  molblock: string;
  source: 'smiles' | 'formula';
}

export function resolveChemicalInput(
  rdkit: RdkitModule | null,
  input: string,
  validateSmiles?: ReturnType<typeof buildAliasValidator>,
): ResolvedChemicalInput | null {
  const trimmed = input.trim();
  if (!rdkit || !trimmed) return null;

  let mol = getMolWithFallback(rdkit, trimmed);
  let smiles = trimmed;
  let source: ResolvedChemicalInput['source'] = 'smiles';

  if (!mol) {
    const resolution = resolveChemicalTextStructure(trimmed, { validateSmiles });
    if (!resolution.ok || !resolution.smiles) return null;
    mol = getMolWithFallback(rdkit, resolution.smiles);
    if (!mol) return null;
    smiles = resolution.smiles;
    source = 'formula';
  }

  try {
    mol.set_new_coords?.();
  } catch {
    /* intentional */
  }

  let canonicalSmiles = smiles;
  try {
    canonicalSmiles = mol.get_smiles();
  } catch {
    /* intentional */
  }

  const molblock = mol.get_molblock?.() ?? '';
  mol.delete();
  return {
    smiles: canonicalSmiles || smiles,
    molblock,
    source,
  };
}

export function aliasResolutionMessage(
  resolution: ReturnType<typeof resolveAliasChemistry>,
): string {
  if (resolution.reason === 'ambiguous')
    return 'Choose one interpretation for this label before enabling chemistry-backed features.';
  if (resolution.reason === 'chemically_invalid')
    return 'Chemistry engine rejected all parsed interpretations for this label.';
  if (resolution.selected?.semanticKind === 'coordination')
    return 'Coordination-style ligands are preserved, but chemistry-backed features need a curated covalent fallback.';
  return 'Chemistry-backed features are unavailable for this labeled alias.';
}

export function extractImplicitHydrogensByMapNumber(molJson: string): Map<number, number> {
  const implicitHydrogensByMapNumber = new Map<number, number>();
  try {
    const parsed = JSON.parse(molJson) as {
      defaults?: { atom?: { impHs?: number } };
      molecules?: Array<{ atoms?: Array<{ impHs?: number }> }>;
    };
    const fallbackImplicitHydrogens = parsed.defaults?.atom?.impHs ?? 0;
    const atoms = parsed.molecules?.[0]?.atoms ?? [];
    atoms.forEach((atom, index) => {
      const implicitHydrogens =
        typeof atom?.impHs === 'number' ? atom.impHs : fallbackImplicitHydrogens;
      if (implicitHydrogens > 0) implicitHydrogensByMapNumber.set(index + 1, implicitHydrogens);
    });
  } catch {
    /* intentional */
  }
  return implicitHydrogensByMapNumber;
}

export function tryGetSmilesFromMolblock(
  rdkit: RdkitModule | null,
  molblock: string,
  shorthandMap: Map<number, string>,
  options?: { preserveAtomMaps?: boolean },
): { smiles: string | null; error: string | null } {
  if (!rdkit || !molblock) return { smiles: null, error: null };
  let mol: RdkitMol | null = null;
  try {
    try {
      mol = rdkit.get_mol(molblock);
    } catch {
      /* sanitized parse may throw */
    }
    if (!mol) {
      try {
        mol = rdkit.get_mol(molblock, JSON.stringify({ sanitize: false, removeHs: false }));
      } catch {
        mol = null;
      }
    }
    if (!mol) return { smiles: null, error: 'Chemistry engine rejected this structure' };
    const implicitHydrogensByMapNumber =
      options?.preserveAtomMaps && typeof mol.get_json === 'function'
        ? extractImplicitHydrogensByMapNumber(mol.get_json())
        : undefined;
    const smiles = expandAliasSmiles(mol.get_smiles(), shorthandMap, {
      validateSmiles: buildAliasValidator(rdkit),
      preserveAtomMaps: options?.preserveAtomMaps,
      implicitHydrogensByMapNumber,
    });
    return { smiles, error: null };
  } catch (error) {
    return { smiles: null, error: describeRdkitError(error) };
  } finally {
    mol?.delete();
  }
}

export function buildChemistryMolblockInputs(
  rdkit: RdkitModule | null,
  atoms: Atom[],
  bonds: Bond[],
  width: number,
  height: number,
  resolveAliasEntry: (atom: Atom, label: string | undefined) => ShorthandEntry | undefined,
) {
  const direct = graphToMolblock(atoms, bonds, width, height, resolveAliasEntry);
  const mapped = graphToMolblock(atoms, bonds, width, height, resolveAliasEntry, true);
  const expanded = expandSupportedAliasGraph(rdkit, atoms, bonds, resolveAliasEntry);
  if (!expanded) {
    return {
      molblock: direct.molblock,
      shorthandMap: direct.shorthandMap,
      mappedMolblock: mapped.molblock,
      mappedShorthandMap: mapped.shorthandMap,
      usesExpandedAliases: false,
    };
  }

  const expandedDirect = graphToMolblock(expanded.atoms, expanded.bonds, width, height);
  const expandedMapped = graphToMolblock(
    expanded.atoms,
    expanded.bonds,
    width,
    height,
    undefined,
    true,
  );
  return {
    molblock: expandedDirect.molblock,
    shorthandMap: new Map<number, string>(),
    mappedMolblock: expandedMapped.molblock,
    mappedShorthandMap: new Map<number, string>(),
    usesExpandedAliases: true,
  };
}

export function hasCustomChemistryLabel(
  atom: Atom,
  resolveAlias: (atom: Atom, label: string | undefined) => ReturnType<typeof resolveAliasChemistry>,
): boolean {
  if (!isAliasAtom(atom)) {
    return !isElementSymbol(atom.element) && atom.element !== 'D';
  }
  const alias = getAtomAlias(atom);
  if (!alias) return false;
  const resolution = resolveAlias(atom, alias);
  if (resolution.selected?.semanticKind === 'coordination') return true;
  if (!resolution.selected?.subsSmiles) return true;
  return Boolean(!resolution.selected && !isElementSymbol(alias) && alias !== 'D');
}
