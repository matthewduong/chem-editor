import type { Atom } from '../types/chemistry';
import { isElementSymbol } from './elements';
import { getCanonicalAliasEntry, resolveAliasChemistry } from './aliasChemistry';

export function getAtomKind(atom: Atom): 'element' | 'alias' {
  return atom.kind;
}

export function getAtomAlias(atom: Atom): string | undefined {
  return atom.alias;
}

export function getAtomNodeText(atom: Atom): string {
  return getAtomAlias(atom) ?? atom.element;
}

export function isAliasAtom(atom: Atom): boolean {
  return getAtomKind(atom) === 'alias';
}

export function getAtomLeadElement(atom: Atom): string {
  const alias = getAtomAlias(atom);
  return (
    resolveAliasChemistry(alias, {
      preferredCandidateId: atom.aliasResolution?.selectedCandidateId,
    }).selected?.entry.lead ?? atom.element
  );
}

export function setAtomValue(atom: Atom, value: string): Atom {
  if (isElementSymbol(value) || value === 'D') {
    return {
      ...atom,
      kind: 'element',
      element: value,
      alias: undefined,
      aliasResolution: undefined,
      labelRuns: undefined,
    };
  }

  const fallbackElement =
    resolveAliasChemistry(value).selected?.entry.lead ??
    (isElementSymbol(atom.element) ? atom.element : 'C');

  return {
    ...atom,
    kind: 'alias',
    element: fallbackElement,
    alias: value,
    aliasResolution: undefined,
    labelRuns: undefined,
  };
}

export function setAliasAtomValue(atom: Atom, alias: string): Atom {
  const fallbackElement =
    getCanonicalAliasEntry(alias)?.lead ??
    resolveAliasChemistry(alias).selected?.entry.lead ??
    (isElementSymbol(atom.element) ? atom.element : 'C');

  return {
    ...atom,
    kind: 'alias',
    element: fallbackElement,
    alias,
    aliasResolution: undefined,
    labelRuns: undefined,
  };
}

export function normalizeAtom(atom: Atom): Atom {
  const kind = atom.kind ?? (atom.alias ? 'alias' : 'element');

  if (kind === 'alias') {
    const alias =
      atom.alias ??
      (!isElementSymbol(atom.element) && atom.element !== 'D' ? atom.element : undefined);
    const fallbackElement =
      resolveAliasChemistry(alias, {
        preferredCandidateId: atom.aliasResolution?.selectedCandidateId,
      }).selected?.entry.lead ??
      (isElementSymbol(atom.element) || atom.element === 'D' ? atom.element : 'C');
    return {
      ...atom,
      kind: 'alias',
      element: fallbackElement,
      alias,
    };
  }

  if (isElementSymbol(atom.element) || atom.element === 'D') {
    return {
      ...atom,
      kind: 'element',
      alias: undefined,
    };
  }

  return {
    ...atom,
    kind: 'alias',
    element: 'C',
    alias: atom.alias ?? atom.element,
  };
}

export function normalizeAtoms(atoms: Atom[]): Atom[] {
  return atoms.map(normalizeAtom);
}
