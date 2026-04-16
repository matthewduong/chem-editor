import type {
  AtomAliasCandidateSnapshot,
  AtomAliasResolution,
  AtomAliasSemanticKind,
} from '../types/chemistry';
import { VALENCIES, isElementSymbol } from './elements';
import { SHORTHAND_DATA, type ShorthandEntry } from './shorthand';

export type AliasChemistryFailureReason =
  | 'empty'
  | 'unsupported_syntax'
  | 'unsupported_structure'
  | 'ambiguous'
  | 'chemically_invalid';

export interface AliasChemistryCandidate {
  id: string;
  entry: ShorthandEntry;
  score: number;
  source: 'shorthand' | 'parsed' | 'ligand' | 'rewrite';
  displayLabel: string;
  semanticKind: AtomAliasSemanticKind;
  subsSmiles?: string;
  canonicalSmiles?: string;
  validationError?: string | null;
}

export interface AliasChemistryResolution {
  ok: boolean;
  reason?: AliasChemistryFailureReason;
  selected?: AliasChemistryCandidate;
  candidates: AliasChemistryCandidate[];
}

export interface AliasChemistryValidationResult {
  canonicalSmiles?: string | null;
  error?: string | null;
}

export interface AliasChemistryOptions {
  maxCandidates?: number;
  validateSmiles?: (smiles: string) => AliasChemistryValidationResult;
  preferredCandidateId?: string;
  preserveAtomMaps?: boolean;
  implicitHydrogensByMapNumber?: Map<number, number>;
}

export type AliasLibrarySupport = 'structure' | 'coordination' | 'display-only';

export interface AliasLibraryEntry {
  label: string;
  lead: string;
  valency: number;
  source: 'shorthand' | 'ligand';
  support: AliasLibrarySupport;
  chemistryAvailable: boolean;
  hasCoordinationOption: boolean;
}

interface LigandDefinition {
  key: string;
  lead: string;
  valency: number;
  donorCount: number;
  donorAtoms: string[];
  coordinationMode: 'monodentate' | 'bidentate' | 'eta5';
  fallbackSubsSmiles?: string;
  aliases?: string[];
}

interface AliasRegistryEntry extends ShorthandEntry {
  key: string;
  source: 'shorthand' | 'ligand';
  semanticKind: AtomAliasSemanticKind;
}

interface AliasEdge {
  bondOrder: number;
  node: AliasNode;
}

interface AliasNode {
  lead: string;
  baseSmiles: string;
  budget: number;
  canContinue: boolean;
  source: 'element' | 'alias' | 'hydrogen';
  children: AliasEdge[];
}

interface ParseState {
  root: AliasNode;
  currentPath: number[];
  score: number;
}

interface ParsedItem {
  node: AliasNode;
  pos: number;
  score: number;
}

const OVERRIDE_BUDGETS: Record<string, number> = {
  P: 5,
  S: 6,
};

const LEGACY_REGISTRY: Record<string, AliasRegistryEntry> = Object.fromEntries(
  Object.entries(SHORTHAND_DATA).map(([key, entry]) => [
    key,
    {
      key,
      ...entry,
      source: 'shorthand',
      semanticKind: 'covalent',
    },
  ]),
);

const SHORTHAND_VARIANTS = new Map<string, AliasRegistryEntry[]>();

for (const [key, entry] of Object.entries(LEGACY_REGISTRY)) {
  const variants = [key, entry.reverse, entry.withH, entry.reverseWithH].filter(
    (value): value is string => Boolean(value),
  );
  for (const variant of variants) {
    const existing = SHORTHAND_VARIANTS.get(variant) ?? [];
    existing.push(entry);
    SHORTHAND_VARIANTS.set(variant, existing);
  }
}

const LIGAND_DEFINITIONS: LigandDefinition[] = [
  { key: 'Cp', lead: 'C', valency: 1, donorCount: 1, donorAtoms: ['C'], coordinationMode: 'eta5' },
  { key: 'Cp*', lead: 'C', valency: 1, donorCount: 1, donorAtoms: ['C'], coordinationMode: 'eta5' },
  {
    key: 'cod',
    lead: 'C',
    valency: 2,
    donorCount: 2,
    donorAtoms: ['C', 'C'],
    coordinationMode: 'bidentate',
  },
  {
    key: 'acac',
    lead: 'O',
    valency: 2,
    donorCount: 2,
    donorAtoms: ['O', 'O'],
    coordinationMode: 'bidentate',
  },
  {
    key: 'bpy',
    lead: 'N',
    valency: 2,
    donorCount: 2,
    donorAtoms: ['N', 'N'],
    coordinationMode: 'bidentate',
  },
  {
    key: 'phen',
    lead: 'N',
    valency: 2,
    donorCount: 2,
    donorAtoms: ['N', 'N'],
    coordinationMode: 'bidentate',
  },
  {
    key: 'TMEDA',
    lead: 'N',
    valency: 2,
    donorCount: 2,
    donorAtoms: ['N', 'N'],
    coordinationMode: 'bidentate',
  },
  {
    key: 'en',
    lead: 'N',
    valency: 2,
    donorCount: 2,
    donorAtoms: ['N', 'N'],
    coordinationMode: 'bidentate',
  },
  {
    key: 'py',
    lead: 'N',
    valency: 1,
    donorCount: 1,
    donorAtoms: ['N'],
    coordinationMode: 'monodentate',
  },
  {
    key: 'dppm',
    lead: 'P',
    valency: 2,
    donorCount: 2,
    donorAtoms: ['P', 'P'],
    coordinationMode: 'bidentate',
  },
  {
    key: 'dppe',
    lead: 'P',
    valency: 2,
    donorCount: 2,
    donorAtoms: ['P', 'P'],
    coordinationMode: 'bidentate',
  },
  {
    key: 'dppp',
    lead: 'P',
    valency: 2,
    donorCount: 2,
    donorAtoms: ['P', 'P'],
    coordinationMode: 'bidentate',
  },
  {
    key: 'dba',
    lead: 'C',
    valency: 2,
    donorCount: 2,
    donorAtoms: ['C', 'C'],
    coordinationMode: 'bidentate',
  },
  {
    key: 'pin',
    lead: 'O',
    valency: 2,
    donorCount: 2,
    donorAtoms: ['O', 'O'],
    coordinationMode: 'bidentate',
  },
  {
    key: 'PPh3',
    lead: 'P',
    valency: 1,
    donorCount: 1,
    donorAtoms: ['P'],
    coordinationMode: 'monodentate',
    fallbackSubsSmiles: 'P(c1ccccc1)(c1ccccc1)(c1ccccc1)',
  },
  {
    key: 'PMe3',
    lead: 'P',
    valency: 1,
    donorCount: 1,
    donorAtoms: ['P'],
    coordinationMode: 'monodentate',
    fallbackSubsSmiles: 'P(C)(C)(C)',
  },
  {
    key: 'PEt3',
    lead: 'P',
    valency: 1,
    donorCount: 1,
    donorAtoms: ['P'],
    coordinationMode: 'monodentate',
    fallbackSubsSmiles: 'P(CC)(CC)(CC)',
  },
  {
    key: 'PCy3',
    lead: 'P',
    valency: 1,
    donorCount: 1,
    donorAtoms: ['P'],
    coordinationMode: 'monodentate',
    fallbackSubsSmiles: 'P(C1(CCCCC1))(C1(CCCCC1))(C1(CCCCC1))',
  },
];

const LIGAND_REGISTRY: Record<string, AliasRegistryEntry> = Object.fromEntries(
  LIGAND_DEFINITIONS.flatMap((definition) => {
    const entry: AliasRegistryEntry = {
      key: definition.key,
      lead: definition.lead,
      valency: definition.valency,
      ...(definition.fallbackSubsSmiles ? { subsSmiles: definition.fallbackSubsSmiles } : {}),
      source: 'ligand',
      semanticKind: 'coordination',
    };
    const variants = [definition.key, ...(definition.aliases ?? [])];
    return variants.map((variant) => [variant, entry] as const);
  }),
);
const CANONICAL_LIGAND_REGISTRY: Record<string, AliasRegistryEntry> = Object.fromEntries(
  LIGAND_DEFINITIONS.map((definition) => [
    definition.key,
    {
      key: definition.key,
      lead: definition.lead,
      valency: definition.valency,
      ...(definition.fallbackSubsSmiles ? { subsSmiles: definition.fallbackSubsSmiles } : {}),
      source: 'ligand' as const,
      semanticKind: 'coordination' as const,
    },
  ]),
);

export function getAliasLibraryIssues(): string[] {
  const issues: string[] = [];

  for (const [label, entry] of Object.entries(LEGACY_REGISTRY)) {
    if (!entry.lead.trim()) issues.push(`${label}: missing lead element`);
    if (!Number.isFinite(entry.valency) || entry.valency < 1) {
      issues.push(`${label}: invalid valency ${entry.valency}`);
    }
    if (entry.withH && entry.lead !== 'N') {
      issues.push(`${label}: withH is only expected on nitrogen-led shorthands`);
    }
    if (entry.reverseWithH && !entry.withH) {
      issues.push(`${label}: reverseWithH requires withH`);
    }
    if (entry.subsSmiles != null && entry.subsSmiles.trim().length === 0) {
      issues.push(`${label}: empty subsSmiles`);
    }
  }

  for (const definition of LIGAND_DEFINITIONS) {
    if (!definition.key.trim()) issues.push('Ligand alias is missing a label');
    if (!definition.lead.trim()) issues.push(`${definition.key}: missing ligand lead element`);
    if (!Number.isFinite(definition.valency) || definition.valency < 1) {
      issues.push(`${definition.key}: invalid ligand valency ${definition.valency}`);
    }
    if (
      definition.fallbackSubsSmiles != null &&
      definition.fallbackSubsSmiles.trim().length === 0
    ) {
      issues.push(`${definition.key}: empty fallback ligand structure`);
    }
  }

  return issues;
}

export function getCanonicalAliasEntry(label: string | undefined): ShorthandEntry | undefined {
  const trimmed = label?.trim();
  if (!trimmed) return undefined;
  return LEGACY_REGISTRY[trimmed] ?? CANONICAL_LIGAND_REGISTRY[trimmed];
}

const TERMINAL_ELEMENTS = new Set(['H', 'F', 'Cl', 'Br', 'I']);
const COMPOSABLE_ALIAS_KEYS = Object.entries(LEGACY_REGISTRY)
  .filter(([, entry]) => Boolean(entry.subsSmiles))
  .map(([key]) => key)
  .sort((left, right) => right.length - left.length);

function makeCandidateId(
  label: string,
  source: AliasChemistryCandidate['source'],
  semanticKind: AtomAliasSemanticKind,
  subsSmiles?: string,
): string {
  return `${label}::${source}::${semanticKind}::${subsSmiles ?? ''}`;
}

function toCandidateSnapshot(candidate: AliasChemistryCandidate): AtomAliasCandidateSnapshot {
  return {
    id: candidate.id,
    label: candidate.displayLabel,
    semanticKind: candidate.semanticKind,
    source: candidate.source,
    ...(candidate.subsSmiles ? { subsSmiles: candidate.subsSmiles } : {}),
  };
}

export function buildAliasResolutionSnapshot(
  resolution: AliasChemistryResolution,
): AtomAliasResolution | undefined {
  const selected = resolution.selected;
  if (resolution.ok && selected) {
    return {
      status: selected.semanticKind === 'coordination' ? 'coordination_only' : 'resolved',
      selectedCandidateId: selected.id,
      selectedLabel: selected.displayLabel,
      semanticKind: selected.semanticKind,
      candidates: resolution.candidates.map(toCandidateSnapshot),
    };
  }
  if (!resolution.reason) return undefined;
  return {
    status:
      resolution.reason === 'ambiguous'
        ? 'ambiguous'
        : resolution.reason === 'chemically_invalid'
          ? 'chemically_invalid'
          : resolution.reason === 'unsupported_structure'
            ? 'unsupported_structure'
            : 'unsupported_syntax',
    reason: resolution.reason,
    candidates: resolution.candidates.map(toCandidateSnapshot),
  };
}

function registryEntriesForLabel(label: string): AliasRegistryEntry[] {
  const entries: AliasRegistryEntry[] = [];
  const legacy = SHORTHAND_VARIANTS.get(label) ?? [];
  entries.push(...legacy);
  const ligand = LIGAND_REGISTRY[label];
  if (ligand) entries.push(ligand);
  return entries;
}

function cloneNode(node: AliasNode): AliasNode {
  return {
    ...node,
    children: node.children.map((edge) => ({
      bondOrder: edge.bondOrder,
      node: cloneNode(edge.node),
    })),
  };
}

function getNodeAtPath(node: AliasNode, path: number[]): AliasNode {
  let current = node;
  for (const index of path) current = current.children[index].node;
  return current;
}

function countUsedBudget(node: AliasNode): number {
  return node.children.reduce((sum, edge) => sum + edge.bondOrder, 0);
}

function countNonHydrogenChildren(node: AliasNode): number {
  return node.children.filter((edge) => edge.node.source !== 'hydrogen').length;
}

function isTerminalBareOxygen(node: AliasNode): boolean {
  return node.source === 'element' && node.lead === 'O' && node.children.length === 0;
}

function createHydrogenNode(): AliasNode {
  return {
    lead: 'H',
    baseSmiles: '[H]',
    budget: 1,
    canContinue: false,
    source: 'hydrogen',
    children: [],
  };
}

function elementBaseSmiles(element: string): string {
  if (element === 'H') return '[H]';
  if (['B', 'C', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I'].includes(element)) return element;
  return `[${element}]`;
}

function createElementNode(element: string): AliasNode {
  return {
    lead: element,
    baseSmiles: elementBaseSmiles(element),
    budget: OVERRIDE_BUDGETS[element] ?? VALENCIES[element] ?? 4,
    canContinue: !TERMINAL_ELEMENTS.has(element),
    source: 'element',
    children: [],
  };
}

function createAliasNode(entry: ShorthandEntry): AliasNode {
  return {
    lead: entry.lead,
    baseSmiles: entry.subsSmiles!,
    budget: 1,
    canContinue: false,
    source: 'alias',
    children: [],
  };
}

function cloneState(state: ParseState): ParseState {
  return {
    root: cloneNode(state.root),
    currentPath: [...state.currentPath],
    score: state.score,
  };
}

function splitRootSmiles(smiles: string): { root: string; suffix: string } | null {
  if (!smiles) return null;
  let cursor = 0;
  if (smiles[cursor] === '[') {
    const close = smiles.indexOf(']', cursor);
    if (close === -1) return null;
    cursor = close + 1;
  } else {
    const match = /^[A-Z][a-z]?|^[cnops]/.exec(smiles);
    if (!match) return null;
    cursor = match[0].length;
  }

  while (cursor < smiles.length) {
    if (smiles[cursor] === '%') {
      if (cursor + 2 >= smiles.length) return null;
      cursor += 3;
      continue;
    }
    if (/[0-9]/.test(smiles[cursor])) {
      cursor += 1;
      continue;
    }
    break;
  }

  return {
    root: smiles.slice(0, cursor),
    suffix: smiles.slice(cursor),
  };
}

function serializeNode(node: AliasNode): string | null {
  const root = splitRootSmiles(node.baseSmiles);
  if (!root) return null;
  const branchSmiles: string[] = [];
  for (const edge of node.children) {
    const childSmiles = serializeNode(edge.node);
    if (!childSmiles) return null;
    const bond = edge.bondOrder === 2 ? '=' : edge.bondOrder === 3 ? '#' : '';
    branchSmiles.push(`(${bond}${childSmiles})`);
  }
  return `${root.root}${branchSmiles.join('')}${root.suffix}`;
}

function chooseBondOrder(parent: AliasNode, child: AliasNode): number {
  if (child.source === 'hydrogen') return 1;
  if (isTerminalBareOxygen(child) && (parent.lead === 'S' || parent.lead === 'P')) return 2;
  if (isTerminalBareOxygen(child) && parent.lead === 'C' && countNonHydrogenChildren(parent) === 0)
    return 2;
  return 1;
}

function attachmentPenalty(
  parent: AliasNode,
  child: AliasNode,
  hasMore: boolean,
  mode: 'branch' | 'chain',
): number {
  const bondOrder = chooseBondOrder(parent, child);
  const overBudget = Math.max(0, countUsedBudget(parent) + bondOrder - parent.budget);
  let penalty = overBudget * 25;

  if (mode === 'branch' && child.canContinue && hasMore) penalty += 1;
  if (mode === 'chain' && !child.canContinue && hasMore) penalty += 5;
  if (
    mode === 'chain' &&
    isTerminalBareOxygen(child) &&
    (parent.lead === 'P' || parent.lead === 'S') &&
    hasMore
  )
    penalty += 3;

  return penalty;
}

function attachChild(
  state: ParseState,
  child: AliasNode,
  hasMore: boolean,
  mode: 'branch' | 'chain',
): ParseState {
  const next = cloneState(state);
  const parent = getNodeAtPath(next.root, next.currentPath);
  const childClone = cloneNode(child);
  const bondOrder = chooseBondOrder(parent, childClone);
  parent.children.push({ bondOrder, node: childClone });
  next.score += attachmentPenalty(parent, childClone, hasMore, mode);
  if (mode === 'chain') next.currentPath = [...next.currentPath, parent.children.length - 1];
  return next;
}

function parseNumber(input: string, pos: number): { value: number; pos: number } {
  let cursor = pos;
  while (cursor < input.length && /[0-9]/.test(input[cursor])) cursor += 1;
  if (cursor === pos) return { value: 1, pos };
  return { value: Number.parseInt(input.slice(pos, cursor), 10), pos: cursor };
}

function attachHydrogenSuffix(node: AliasNode, count: number) {
  for (let index = 0; index < count; index += 1) {
    node.children.push({ bondOrder: 1, node: createHydrogenNode() });
  }
}

function parseAliasToken(input: string, pos: number): { node: AliasNode; pos: number } | null {
  for (const key of COMPOSABLE_ALIAS_KEYS) {
    if (!input.startsWith(key, pos)) continue;
    const entry = LEGACY_REGISTRY[key];
    if (!entry?.subsSmiles) continue;
    return { node: createAliasNode(entry), pos: pos + key.length };
  }
  return null;
}

function parseElementToken(input: string, pos: number): { node: AliasNode; pos: number } | null {
  const two = input.slice(pos, pos + 2);
  const one = input.slice(pos, pos + 1);
  const symbol = isElementSymbol(two) ? two : isElementSymbol(one) ? one : null;
  if (!symbol) return null;

  const node = createElementNode(symbol);
  let cursor = pos + symbol.length;
  if (symbol !== 'H' && input[cursor] === 'H') {
    const { value, pos: nextPos } = parseNumber(input, cursor + 1);
    attachHydrogenSuffix(node, value);
    cursor = nextPos;
  }

  return { node, pos: cursor };
}

function parseCoreNode(input: string, pos: number): ParsedItem | null {
  const alias = parseAliasToken(input, pos);
  if (alias) return { node: alias.node, pos: alias.pos, score: 0 };

  const element = parseElementToken(input, pos);
  if (element) return { node: element.node, pos: element.pos, score: 0 };

  if (input[pos] !== '(') return null;
  const grouped = parseSequence(input, pos + 1, ')');
  if (!grouped) return null;
  return {
    node: grouped.root,
    pos: grouped.pos,
    score: grouped.score,
  };
}

function parseNode(input: string, pos: number): ParsedItem | null {
  const parsed = parseCoreNode(input, pos);
  if (!parsed) return null;

  if (parsed.node.source === 'alias' && input[parsed.pos] === '(') return null;

  let cursor = parsed.pos;
  let score = parsed.score;
  while (cursor < input.length && input[cursor] === '(') {
    const grouped = parseSequence(input, cursor + 1, ')');
    if (!grouped) return null;
    const { value: count, pos: afterCount } = parseNumber(input, grouped.pos);
    for (let index = 0; index < count; index += 1) {
      const bondOrder = chooseBondOrder(parsed.node, grouped.root);
      parsed.node.children.push({ bondOrder, node: cloneNode(grouped.root) });
      const overBudget = Math.max(0, countUsedBudget(parsed.node) - parsed.node.budget);
      score += grouped.score + overBudget * 25;
    }
    cursor = afterCount;
  }

  return { node: parsed.node, pos: cursor, score };
}

function parseSequenceCandidates(
  input: string,
  pos: number,
  terminator: ')' | null,
  maxCandidates = 12,
): { states: ParseState[]; pos: number } | null {
  const first = parseNode(input, pos);
  if (!first) return null;

  let states: ParseState[] = [
    {
      root: first.node,
      currentPath: [],
      score: first.score,
    },
  ];
  let cursor = first.pos;

  while (cursor < input.length && input[cursor] !== terminator) {
    const parsed = parseNode(input, cursor);
    if (!parsed) return null;
    const { value: count, pos: nextPos } = parseNumber(input, parsed.pos);
    const hasMore = nextPos < input.length && input[nextPos] !== terminator;
    const nextStates: ParseState[] = [];

    for (const state of states) {
      if (count > 1) {
        let repeated = cloneState(state);
        for (let index = 0; index < count; index += 1) {
          repeated = attachChild(repeated, parsed.node, hasMore, 'branch');
        }
        nextStates.push(repeated);
        continue;
      }

      nextStates.push(attachChild(state, parsed.node, hasMore, 'branch'));
      if (parsed.node.canContinue)
        nextStates.push(attachChild(state, parsed.node, hasMore, 'chain'));
    }

    states = nextStates.sort((left, right) => left.score - right.score).slice(0, maxCandidates);
    cursor = nextPos;
  }

  if (terminator) {
    if (cursor >= input.length || input[cursor] !== terminator) return null;
    cursor += 1;
  }

  return { states: states.sort((left, right) => left.score - right.score), pos: cursor };
}

function parseSequence(
  input: string,
  pos: number,
  terminator: ')' | null,
): { root: AliasNode; score: number; pos: number } | null {
  const parsed = parseSequenceCandidates(input, pos, terminator, 1);
  if (!parsed || parsed.states.length === 0) return null;
  const best = parsed.states[0];
  return { root: best.root, score: best.score, pos: parsed.pos };
}

function isConservativelyRejected(node: AliasNode): boolean {
  if (node.lead !== 'C') return false;
  const nonHydrogen = node.children.filter((edge) => edge.node.source !== 'hydrogen');
  if (nonHydrogen.length === 0) return false;
  return nonHydrogen.every((edge) => edge.node.lead === 'O' && edge.node.children.length === 0);
}

function inferCompositeAliasCandidates(
  label: string,
  maxCandidates = 12,
): AliasChemistryCandidate[] {
  if (!label || /\s/.test(label)) return [];
  const parsed = parseSequenceCandidates(label, 0, null, maxCandidates);
  if (!parsed || parsed.pos !== label.length) return [];

  const candidates: AliasChemistryCandidate[] = [];
  const seen = new Set<string>();

  for (const state of parsed.states) {
    if (isConservativelyRejected(state.root)) continue;
    const subsSmiles = serializeNode(state.root);
    if (!subsSmiles || seen.has(subsSmiles)) continue;
    seen.add(subsSmiles);
    candidates.push({
      id: makeCandidateId(label, 'parsed', 'covalent', subsSmiles),
      source: 'parsed',
      displayLabel: label,
      semanticKind: 'covalent',
      score: state.score,
      subsSmiles,
      entry: {
        lead: state.root.lead,
        valency: 1,
        subsSmiles,
      },
    });
  }

  return candidates;
}

function inferRewriteCandidates(label: string): AliasChemistryCandidate[] {
  const trimmed = label.trim();
  const candidates: AliasChemistryCandidate[] = [];

  if (trimmed === 'Bpin') {
    const subsSmiles = 'B1OC(C)(C)C(C)(C)O1';
    candidates.push({
      id: makeCandidateId(trimmed, 'rewrite', 'covalent', subsSmiles),
      source: 'rewrite',
      displayLabel: trimmed,
      semanticKind: 'covalent',
      score: -10,
      subsSmiles,
      entry: { lead: 'B', valency: 1, subsSmiles },
    });
  }

  const bpinCountMatch = /^B(?:\((pin)\)|pin)(\d+)$/i.exec(trimmed);
  if (bpinCountMatch) {
    const count = Number.parseInt(bpinCountMatch[2], 10);
    if (Number.isFinite(count) && count >= 2 && count <= 3) {
      const pinSmiles = 'O1C(C)(C)C(C)(C)O1';
      const branches = Array.from({ length: count }, () => `(${pinSmiles})`).join('');
      const subsSmiles = `B${branches}`;
      candidates.push({
        id: makeCandidateId(trimmed, 'rewrite', 'covalent', subsSmiles),
        source: 'rewrite',
        displayLabel: trimmed,
        semanticKind: 'covalent',
        score: -8,
        subsSmiles,
        entry: { lead: 'B', valency: 1, subsSmiles },
      });
    }
  }

  const poMatch = /^PO\((.+)\)2$/i.exec(trimmed);
  if (poMatch) {
    const branch = getAliasChemistry(poMatch[1]);
    if (branch?.subsSmiles) {
      const subsSmiles = `P(=O)(${branch.subsSmiles})(${branch.subsSmiles})`;
      candidates.push({
        id: makeCandidateId(trimmed, 'rewrite', 'covalent', subsSmiles),
        source: 'rewrite',
        displayLabel: trimmed,
        semanticKind: 'covalent',
        score: -5,
        subsSmiles,
        entry: { lead: 'P', valency: 1, subsSmiles },
      });
    }
  }

  const reverseHydrogenMatch = /^H(\d*)([NOSP])$/i.exec(trimmed);
  if (reverseHydrogenMatch) {
    const count = reverseHydrogenMatch[1] ? Number.parseInt(reverseHydrogenMatch[1], 10) : 1;
    const hetero = reverseHydrogenMatch[2].toUpperCase();
    if (Number.isFinite(count) && count >= 1 && count <= 3) {
      const branches = Array.from({ length: count }, () => '([H])').join('');
      const subsSmiles = `${hetero}${branches}`;
      candidates.push({
        id: makeCandidateId(trimmed, 'rewrite', 'covalent', subsSmiles),
        source: 'rewrite',
        displayLabel: trimmed,
        semanticKind: 'covalent',
        score: -3,
        subsSmiles,
        entry: { lead: hetero, valency: 1, subsSmiles },
      });
    }
  }

  return candidates;
}

function countRingClosuresInSmiles(smiles: string): number {
  const seen = new Set<string>();
  let inBracket = false;
  for (let index = 0; index < smiles.length; index += 1) {
    const char = smiles[index];
    if (char === '[') {
      inBracket = true;
      continue;
    }
    if (char === ']') {
      inBracket = false;
      continue;
    }
    if (inBracket) continue;
    if (char === '%' && index + 2 < smiles.length) {
      seen.add(`%${smiles[index + 1]}${smiles[index + 2]}`);
      index += 2;
      continue;
    }
    if (/[1-9]/.test(char)) seen.add(char);
  }
  return seen.size;
}

function renumberRingClosures(smiles: string, startNumber: number): string {
  const mapping = new Map<string, string>();
  let counter = startNumber;
  let result = '';
  let inBracket = false;

  for (let index = 0; index < smiles.length; index += 1) {
    const char = smiles[index];
    if (char === '[') {
      inBracket = true;
      result += char;
      continue;
    }
    if (char === ']') {
      inBracket = false;
      result += char;
      continue;
    }
    if (inBracket) {
      result += char;
      continue;
    }

    if (char === '%' && index + 2 < smiles.length) {
      const key = `%${smiles[index + 1]}${smiles[index + 2]}`;
      if (!mapping.has(key)) mapping.set(key, `%${counter++}`);
      result += mapping.get(key);
      index += 2;
      continue;
    }

    if (/[1-9]/.test(char)) {
      if (!mapping.has(char)) mapping.set(char, `%${counter++}`);
      result += mapping.get(char);
      continue;
    }

    result += char;
  }

  return result;
}

function refineCandidatesWithValidation(
  candidates: AliasChemistryCandidate[],
  validateSmiles: ((smiles: string) => AliasChemistryValidationResult) | undefined,
): AliasChemistryCandidate[] {
  if (!validateSmiles) return candidates;
  return candidates.map((candidate) => {
    if (!candidate.subsSmiles) return candidate;
    const validation = validateSmiles(candidate.subsSmiles);
    return {
      ...candidate,
      canonicalSmiles: validation.canonicalSmiles ?? undefined,
      validationError: validation.error ?? null,
    };
  });
}

function rankCandidates(candidates: AliasChemistryCandidate[]): AliasChemistryCandidate[] {
  return [...candidates].sort((left, right) => {
    if (left.source !== right.source) {
      const sourceRank: Record<AliasChemistryCandidate['source'], number> = {
        rewrite: 0,
        shorthand: 1,
        parsed: 2,
        ligand: 3,
      };
      if (sourceRank[left.source] !== sourceRank[right.source])
        return sourceRank[left.source] - sourceRank[right.source];
    }
    const leftValid = !left.validationError;
    const rightValid = !right.validationError;
    if (leftValid !== rightValid) return leftValid ? -1 : 1;
    if (left.score !== right.score) return left.score - right.score;
    const leftSmiles = left.canonicalSmiles ?? left.subsSmiles ?? '';
    const rightSmiles = right.canonicalSmiles ?? right.subsSmiles ?? '';
    return leftSmiles.localeCompare(rightSmiles);
  });
}

export function resolveAliasChemistry(
  label: string | undefined,
  options: AliasChemistryOptions = {},
): AliasChemistryResolution {
  const trimmed = label?.trim();
  if (!trimmed) return { ok: false, reason: 'empty', candidates: [] };

  const registryCandidates: AliasChemistryCandidate[] = registryEntriesForLabel(trimmed).map(
    (entry) => ({
      id: makeCandidateId(trimmed, entry.source, entry.semanticKind, entry.subsSmiles),
      entry,
      source: entry.source,
      displayLabel: trimmed,
      semanticKind: entry.semanticKind,
      score: entry.source === 'ligand' ? 1 : 0,
      subsSmiles: entry.subsSmiles,
    }),
  );
  const baseCandidates: AliasChemistryCandidate[] = [
    ...registryCandidates,
    ...inferRewriteCandidates(trimmed),
    ...inferCompositeAliasCandidates(trimmed, options.maxCandidates ?? 12),
  ];

  if (baseCandidates.length === 0) {
    return { ok: false, reason: 'unsupported_syntax', candidates: [] };
  }

  const deduped = Array.from(
    new Map(baseCandidates.map((candidate) => [candidate.id, candidate])).values(),
  );
  const validated = refineCandidatesWithValidation(deduped, options.validateSmiles);
  const ranked = rankCandidates(validated);
  const viable = ranked.filter((candidate) => !candidate.validationError);

  if (options.validateSmiles && viable.length === 0) {
    return { ok: false, reason: 'chemically_invalid', candidates: ranked };
  }

  let usable = viable.length > 0 ? viable : ranked;
  if (options.preferredCandidateId) {
    const preferred = usable.find((candidate) => candidate.id === options.preferredCandidateId);
    if (preferred) {
      usable = [preferred, ...usable.filter((candidate) => candidate.id !== preferred.id)];
    }
  }
  if (usable.length > 1) {
    const first = usable[0];
    const second = usable[1];
    const firstKey = first.canonicalSmiles ?? first.subsSmiles ?? '';
    const secondKey = second.canonicalSmiles ?? second.subsSmiles ?? '';
    if (first.score === second.score && firstKey !== secondKey) {
      return { ok: false, reason: 'ambiguous', candidates: usable };
    }
  }

  return { ok: true, selected: usable[0], candidates: usable };
}

function buildAliasLibraryEntry(
  label: string,
  source: AliasLibraryEntry['source'],
  fallback: Pick<AliasRegistryEntry, 'lead' | 'valency' | 'semanticKind' | 'subsSmiles'>,
): AliasLibraryEntry {
  const resolution = resolveAliasChemistry(label);
  const selected = resolution.selected;
  const selectedKind = selected?.semanticKind ?? fallback.semanticKind;
  return {
    label,
    lead: selected?.entry.lead ?? fallback.lead,
    valency: selected?.entry.valency ?? fallback.valency,
    source,
    support:
      selectedKind === 'coordination'
        ? 'coordination'
        : (selected?.subsSmiles ?? fallback.subsSmiles)
          ? 'structure'
          : 'display-only',
    chemistryAvailable: Boolean(selected?.subsSmiles ?? fallback.subsSmiles),
    hasCoordinationOption:
      resolution.candidates.some((candidate) => candidate.semanticKind === 'coordination') &&
      selectedKind !== 'coordination',
  };
}

export const SUPPORTED_ALIAS_LIBRARY: AliasLibraryEntry[] = [
  ...Object.entries(LEGACY_REGISTRY).map(([label, entry]) =>
    buildAliasLibraryEntry(label, 'shorthand', entry),
  ),
  ...Object.entries(CANONICAL_LIGAND_REGISTRY).map(([label, entry]) =>
    buildAliasLibraryEntry(label, 'ligand', entry),
  ),
].sort((left, right) => left.label.localeCompare(right.label, undefined, { numeric: true }));

export function getAliasChemistry(
  label: string | undefined,
  options?: AliasChemistryOptions,
): ShorthandEntry | undefined {
  const selected = resolveAliasChemistry(label, options).selected;
  if (!selected || selected.semanticKind === 'coordination') return undefined;
  return selected.entry;
}

export function expandAliasSmiles(
  smiles: string,
  aliasMap: Map<number, string>,
  options?: AliasChemistryOptions,
): string {
  const shouldRestoreMappedHydrogens = Boolean(
    options?.preserveAtomMaps && options.implicitHydrogensByMapNumber?.size,
  );
  if (aliasMap.size === 0 && !shouldRestoreMappedHydrogens) return smiles;
  let result = smiles;
  let ringCounter = 10;

  for (const [mapNumber, label] of aliasMap) {
    const entry = getAliasChemistry(label, options);
    if (!entry?.subsSmiles) continue;
    const pattern = new RegExp(
      `\\[${entry.lead}[^\\]]*:${mapNumber}\\]|\\[${entry.lead.toLowerCase()}[^\\]]*:${mapNumber}\\]`,
      'g',
    );
    if (!pattern.test(result)) continue;
    pattern.lastIndex = 0;
    const replacement = renumberRingClosures(entry.subsSmiles, ringCounter);
    const mappedReplacement = options?.preserveAtomMaps
      ? (() => {
          const split = splitRootSmiles(replacement);
          if (!split) return replacement;
          if (split.root.startsWith('[') && split.root.endsWith(']')) {
            return `${split.root.slice(0, -1)}:${mapNumber}]${split.suffix}`;
          }
          return `[${split.root}:${mapNumber}]${split.suffix}`;
        })()
      : replacement;
    ringCounter += countRingClosuresInSmiles(entry.subsSmiles);
    result = result.replace(pattern, mappedReplacement);
  }

  if (shouldRestoreMappedHydrogens) {
    result = result.replace(
      /\[([^\]]*?):(\d+)\]/g,
      (match, body: string, mapNumberText: string) => {
        const mapNumber = Number.parseInt(mapNumberText, 10);
        if (
          !Number.isFinite(mapNumber) ||
          aliasMap.has(mapNumber) ||
          /H\d*(?=[^a-z]|$)/.test(body)
        ) {
          return match;
        }
        const implicitHydrogens = options?.implicitHydrogensByMapNumber?.get(mapNumber) ?? 0;
        if (implicitHydrogens <= 0) return match;

        const chargeMatch = body.match(/([+-].*)$/);
        const chargeSuffix = chargeMatch?.[1] ?? '';
        const atomBody = chargeSuffix ? body.slice(0, -chargeSuffix.length) : body;
        const hydrogenToken = `H${implicitHydrogens === 1 ? '' : implicitHydrogens}`;
        return `[${atomBody}${hydrogenToken}${chargeSuffix}:${mapNumber}]`;
      },
    );
  }

  return result;
}
