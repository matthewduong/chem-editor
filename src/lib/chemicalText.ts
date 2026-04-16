import type {
  ChemicalTextMetadata,
  TextBoxChemicalConversionStatus,
  TextBoxSemanticMode,
  TextRun,
} from '../types/chemistry';
import type { AliasChemistryValidationResult } from './aliasChemistry';
import { resolveAliasChemistry } from './aliasChemistry';
import { isElementSymbol, VALENCIES } from './elements';

export interface ChemicalTextStructureResolution {
  ok: boolean;
  input: string;
  normalizedInput: string;
  smiles?: string;
  source?: ChemicalTextMetadata['source'];
  reason?: ChemicalTextMetadata['reason'];
  message?: string;
}

export interface ChemicalTextInspection {
  intent: boolean;
  formula: string;
  resolution: ChemicalTextStructureResolution;
}

export interface ChemicalTextOptions {
  validateSmiles?: (smiles: string) => AliasChemistryValidationResult;
  forceIntent?: boolean;
}

export interface TextBoxChemicalState {
  semanticMode: TextBoxSemanticMode;
  normalizedRuns: TextRun[];
  formula: string;
  metadata: ChemicalTextMetadata | null;
  intent: boolean;
  conversionStatus: TextBoxChemicalConversionStatus;
}

interface FragmentDescriptor {
  smiles: string;
  lead: string;
  terminalBareOxygen?: boolean;
  preferredBondOrder?: number;
}

interface StructureCandidate {
  smiles: string;
  source: ChemicalTextStructureResolution['source'];
}

interface AssemblyNode {
  lead: string;
  baseSmiles: string;
  budget: number;
  assignedChildren: number;
  children: Array<{ bondOrder: number; node: AssemblyNode }>;
}

interface AttachmentUnit {
  formula: string;
  count: number;
}

interface ElementToken {
  element: string;
  count: number;
}

const EXACT_FORMULA_SMILES: Record<string, string> = {
  CO: '[C-]#[O+]',
  CO2: 'C(=O)(=O)',
  N2: 'N#N',
  NO: 'N=O',
  O2: 'O=O',
};

const HYDROGEN_HALIDES = new Map([
  ['F', '[H]F'],
  ['Cl', '[H]Cl'],
  ['Br', '[H]Br'],
  ['I', '[H]I'],
]);

const SUBSCRIPT_TO_ASCII: Record<string, string> = {
  '₀': '0',
  '₁': '1',
  '₂': '2',
  '₃': '3',
  '₄': '4',
  '₅': '5',
  '₆': '6',
  '₇': '7',
  '₈': '8',
  '₉': '9',
  '₊': '+',
  '₋': '-',
  '₍': '(',
  '₎': ')',
};

const SUPERSCRIPT_TO_ASCII: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
  '⁺': '+',
  '⁻': '-',
  '⁽': '(',
  '⁾': ')',
};

function normalizeUnicodeFormulaText(text: string): string {
  return Array.from(text)
    .map((char) => SUBSCRIPT_TO_ASCII[char] ?? SUPERSCRIPT_TO_ASCII[char] ?? char)
    .join('')
    .replace(/\u2212/g, '-')
    .replace(/\u2013/g, '-')
    .replace(/\u2014/g, '-')
    .replace(/\u00b7/g, '.');
}

function mergeAdjacentRuns(runs: TextRun[]): TextRun[] {
  const merged: TextRun[] = [];
  for (const run of runs) {
    if (!run.text) continue;
    const previous = merged[merged.length - 1];
    if (
      previous &&
      previous.bold === run.bold &&
      previous.italic === run.italic &&
      previous.sub === run.sub &&
      previous.sup === run.sup &&
      previous.color === run.color
    ) {
      previous.text += run.text;
      continue;
    }
    merged.push({ ...run });
  }
  return merged;
}

function pushStyledChunk(target: TextRun[], base: TextRun, text: string, mode?: 'sub' | 'sup') {
  if (!text) return;
  const next: TextRun = {
    text,
    ...(base.bold ? { bold: true } : {}),
    ...(base.italic ? { italic: true } : {}),
    ...(base.color ? { color: base.color } : {}),
    ...(mode === 'sub' ? { sub: true } : {}),
    ...(mode === 'sup' ? { sup: true } : {}),
  };
  target.push(next);
}

function readMarkerChunk(text: string, start: number): { value: string; end: number } | null {
  if (start >= text.length) return null;
  const opener = text[start];
  const closer = opener === '{' ? '}' : opener === '(' ? ')' : null;
  if (closer) {
    let depth = 1;
    let cursor = start + 1;
    while (cursor < text.length) {
      if (text[cursor] === opener) depth += 1;
      else if (text[cursor] === closer) depth -= 1;
      if (depth === 0) {
        return { value: text.slice(start + 1, cursor), end: cursor + 1 };
      }
      cursor += 1;
    }
    return null;
  }

  let cursor = start;
  while (cursor < text.length && /[A-Za-z0-9+-]/.test(text[cursor])) cursor += 1;
  if (cursor === start) return null;
  return { value: text.slice(start, cursor), end: cursor };
}

function expandExplicitFormulaMarkup(run: TextRun): TextRun[] {
  if (run.sub || run.sup || (!run.text.includes('_') && !run.text.includes('^'))) {
    return [{ ...run, text: normalizeUnicodeFormulaText(run.text) }];
  }

  const text = normalizeUnicodeFormulaText(run.text);
  const expanded: TextRun[] = [];
  let plain = '';
  let cursor = 0;

  while (cursor < text.length) {
    const marker = text[cursor];
    if (marker !== '_' && marker !== '^') {
      plain += text[cursor];
      cursor += 1;
      continue;
    }

    const chunk = readMarkerChunk(text, cursor + 1);
    if (!chunk) {
      plain += marker;
      cursor += 1;
      continue;
    }

    pushStyledChunk(expanded, run, plain);
    plain = '';
    pushStyledChunk(expanded, run, chunk.value, marker === '_' ? 'sub' : 'sup');
    cursor = chunk.end;
  }

  pushStyledChunk(expanded, run, plain);
  return expanded;
}

function hasSinglePlainStyle(runs: TextRun[]): boolean {
  if (runs.length === 0) return false;
  const [first] = runs;
  return runs.every(
    (run) =>
      !run.sub &&
      !run.sup &&
      run.bold === first.bold &&
      run.italic === first.italic &&
      run.color === first.color,
  );
}

function splitSimpleChargeSuffix(text: string): { body: string; charge: string } {
  if (/^[A-Z][a-z]?\d+[+-]$/.test(text)) {
    return { body: text.slice(0, -2), charge: text.slice(-2) };
  }
  const simpleCharge = text.match(/^(.*?)([+-])$/);
  if (simpleCharge && simpleCharge[1]) {
    return { body: simpleCharge[1], charge: simpleCharge[2] };
  }
  return { body: text, charge: '' };
}

function autoFormatPlainChemicalText(runs: TextRun[]): TextRun[] {
  if (!hasSinglePlainStyle(runs)) return runs;
  const [base] = runs;
  const joined = normalizeUnicodeFormulaText(runs.map((run) => run.text).join(''));
  const { body, charge } = splitSimpleChargeSuffix(joined);
  const formatted: TextRun[] = [];
  let plain = '';
  let cursor = 0;

  while (cursor < body.length) {
    const char = body[cursor];
    const previous = cursor > 0 ? body[cursor - 1] : '';
    if (/[0-9]/.test(char) && /[A-Za-z)\]]/.test(previous)) {
      pushStyledChunk(formatted, base, plain);
      plain = '';
      let end = cursor + 1;
      while (end < body.length && /[0-9]/.test(body[end])) end += 1;
      pushStyledChunk(formatted, base, body.slice(cursor, end), 'sub');
      cursor = end;
      continue;
    }
    plain += char;
    cursor += 1;
  }

  pushStyledChunk(formatted, base, plain);
  if (charge) pushStyledChunk(formatted, base, charge, 'sup');
  return mergeAdjacentRuns(formatted);
}

export function normalizeChemicalTextRuns(runs: TextRun[]): TextRun[] {
  const expanded = mergeAdjacentRuns(runs.flatMap(expandExplicitFormulaMarkup));
  if (expanded.some((run) => run.sub || run.sup)) return expanded;
  if (!hasSinglePlainStyle(expanded)) return expanded;
  const plain = normalizeUnicodeFormulaText(expanded.map((run) => run.text).join('')).trim();
  if (!plain || plain.includes('\n')) return expanded;
  if (!chemicalTextHasIntentCue(plain)) return expanded;
  if (!resolveChemicalTextStructure(plain).ok) return expanded;
  return autoFormatPlainChemicalText(expanded);
}

export function textRunsToChemicalFormula(runs: TextRun[]): string {
  return normalizeUnicodeFormulaText(
    runs
      .map((run) => {
        if (run.text === '\n') return '\n';
        if (run.sup) return `^${run.text}`;
        return run.text;
      })
      .join(''),
  ).trim();
}

export function chemicalTextInputToFormula(input: string): string {
  if (!input) return '';
  return textRunsToChemicalFormula(expandExplicitFormulaMarkup({ text: input }));
}

function normalizeChemicalInput(input: string): string {
  return chemicalTextInputToFormula(input).replace(/\s+/g, '');
}

export function chemicalTextHasIntentCue(input: string): boolean {
  const formula = chemicalTextInputToFormula(input);
  if (!formula || formula.includes('\n')) return false;
  const normalized = formula.replace(/\s+/g, '');
  if (!normalized) return false;
  if (/[0-9()[\]{}@=#%./\\]/.test(normalized)) return true;
  if (/\^[0-9]*[+-]+$/.test(formula)) return true;
  const tokens = parseElementTokens(normalized);
  return Boolean(
    tokens && tokens.length >= 2 && /[A-Z]/.test(normalized) && /[a-z]/.test(normalized),
  );
}

function elementBaseSmiles(element: string): string {
  if (element === 'H') return '[H]';
  if (['B', 'C', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I'].includes(element)) return element;
  return `[${element}]`;
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

  return { root: smiles.slice(0, cursor), suffix: smiles.slice(cursor) };
}

function serializeNode(node: AssemblyNode): string | null {
  const split = splitRootSmiles(node.baseSmiles);
  if (!split) return null;
  const branches = node.children
    .map((edge) => {
      const child = serializeNode(edge.node);
      if (!child) return null;
      const bond = edge.bondOrder === 2 ? '=' : edge.bondOrder === 3 ? '#' : '';
      return `(${bond}${child})`;
    })
    .filter((value): value is string => Boolean(value));
  return `${split.root}${branches.join('')}${split.suffix}`;
}

function hasDirectSmilesMarkers(input: string): boolean {
  return /[@=#%/\\[\]]/.test(input);
}

function buildValidatedResolution(
  input: string,
  normalizedInput: string,
  candidate: StructureCandidate | null,
  validateSmiles: ChemicalTextOptions['validateSmiles'],
): ChemicalTextStructureResolution {
  if (!candidate) {
    return {
      ok: false,
      input,
      normalizedInput,
      reason: 'unsupported_syntax',
      message: 'This text looks chemical, but the editor could not infer a structure from it.',
    };
  }

  if (!validateSmiles) {
    return {
      ok: true,
      input,
      normalizedInput,
      smiles: candidate.smiles,
      source: candidate.source,
    };
  }

  const validation = validateSmiles(candidate.smiles);
  if (validation.error) {
    return {
      ok: false,
      input,
      normalizedInput,
      reason: 'chemically_invalid',
      message: validation.error,
    };
  }

  return {
    ok: true,
    input,
    normalizedInput,
    smiles: validation.canonicalSmiles ?? candidate.smiles,
    source: candidate.source,
  };
}

function parseLeadingElement(input: string, start = 0): { element: string; end: number } | null {
  const two = input.slice(start, start + 2);
  if (isElementSymbol(two)) return { element: two, end: start + 2 };
  const one = input.slice(start, start + 1);
  if (isElementSymbol(one)) return { element: one, end: start + 1 };
  return null;
}

function parseCount(input: string, start: number): { count: number; end: number } {
  let end = start;
  while (end < input.length && /[0-9]/.test(input[end])) end += 1;
  return {
    count: end === start ? 1 : Number.parseInt(input.slice(start, end), 10),
    end,
  };
}

function parseElementTokens(input: string): ElementToken[] | null {
  const tokens: ElementToken[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    const token = parseLeadingElement(input, cursor);
    if (!token) return null;
    const count = parseCount(input, token.end);
    tokens.push({ element: token.element, count: count.count });
    cursor = count.end;
  }
  return tokens;
}

function parseAttachmentUnits(input: string): AttachmentUnit[] | null {
  const units: AttachmentUnit[] = [];
  let cursor = 0;
  while (cursor < input.length) {
    if (input[cursor] === '(') {
      let depth = 1;
      let end = cursor + 1;
      while (end < input.length && depth > 0) {
        if (input[end] === '(') depth += 1;
        else if (input[end] === ')') depth -= 1;
        end += 1;
      }
      if (depth !== 0) return null;
      const inner = input.slice(cursor + 1, end - 1);
      if (!inner) return null;
      const count = parseCount(input, end);
      units.push({ formula: inner, count: count.count });
      cursor = count.end;
      continue;
    }
    const token = parseLeadingElement(input, cursor);
    if (!token) return null;
    const count = parseCount(input, token.end);
    units.push({ formula: token.element, count: count.count });
    cursor = count.end;
  }
  return units;
}

function budgetForElement(element: string): number {
  if (element === 'P') return 5;
  if (element === 'S') return 6;
  return VALENCIES[element] ?? 6;
}

function createAssemblyNode(element: string): AssemblyNode {
  return {
    lead: element,
    baseSmiles: elementBaseSmiles(element),
    budget: budgetForElement(element),
    assignedChildren: 0,
    children: [],
  };
}

function createFragmentNode(fragment: FragmentDescriptor): AssemblyNode {
  return {
    lead: fragment.lead,
    baseSmiles: fragment.smiles,
    budget: 0,
    assignedChildren: 0,
    children: [],
  };
}

function usedBudget(node: AssemblyNode): number {
  return node.children.reduce((sum, edge) => sum + edge.bondOrder, 0);
}

function remainingBudget(node: AssemblyNode): number {
  return node.budget - usedBudget(node);
}

function determineBondOrder(
  rootElement: string,
  fragment: FragmentDescriptor,
  totalFragments: number,
  allBareOxygen: boolean,
): number {
  if (fragment.preferredBondOrder) return fragment.preferredBondOrder;
  if (!fragment.terminalBareOxygen) return 1;
  if (rootElement === 'P' || rootElement === 'S') return 2;
  if (rootElement === 'C' && allBareOxygen && totalFragments === 2) return 2;
  return 1;
}

function pickAttachmentRoot(roots: AssemblyNode[]): AssemblyNode {
  return [...roots].sort((left, right) => {
    const budgetDelta = remainingBudget(right) - remainingBudget(left);
    if (budgetDelta !== 0) return budgetDelta;
    return left.assignedChildren - right.assignedChildren;
  })[0];
}

function resolveFragmentFormula(input: string): FragmentDescriptor | null {
  const normalized = normalizeChemicalInput(input);
  if (!normalized) return null;
  if (normalized === 'CO') {
    return {
      smiles: '[C-]#[O+]',
      lead: 'C',
      preferredBondOrder: 1,
    };
  }

  const alias = resolveAliasChemistry(normalized);
  const selectedAlias = alias.selected;
  if (
    alias.ok &&
    selectedAlias &&
    selectedAlias.semanticKind !== 'coordination' &&
    selectedAlias.subsSmiles
  ) {
    return {
      smiles: selectedAlias.subsSmiles,
      lead: selectedAlias.entry.lead,
      terminalBareOxygen: selectedAlias.subsSmiles === 'O',
    };
  }

  const repeatedRoot = resolveRepeatedRootFragment(normalized);
  if (repeatedRoot) return repeatedRoot;
  return null;
}

function resolveRepeatedRootFragment(input: string): FragmentDescriptor | null {
  const rootToken = parseLeadingElement(input);
  if (!rootToken) return null;
  const rootCount = parseCount(input, rootToken.end);
  const suffix = input.slice(rootCount.end);

  if (!suffix) {
    if (rootCount.count !== 1) return null;
    return {
      smiles: elementBaseSmiles(rootToken.element),
      lead: rootToken.element,
      terminalBareOxygen: rootToken.element === 'O',
    };
  }

  if (rootToken.element === 'H') return null;

  const units = parseAttachmentUnits(suffix);
  if (!units || units.length === 0) return null;

  const roots = Array.from({ length: rootCount.count }, () =>
    createAssemblyNode(rootToken.element),
  );
  for (let index = 0; index < roots.length - 1; index += 1) {
    roots[index].children.push({ bondOrder: 1, node: roots[index + 1] });
    roots[index].assignedChildren += 1;
    roots[index + 1].assignedChildren += 1;
  }

  const expandedFragments: FragmentDescriptor[] = [];
  for (const unit of units) {
    if (unit.formula === 'H') continue;
    const fragment = resolveFragmentFormula(unit.formula);
    if (!fragment) return null;
    for (let count = 0; count < unit.count; count += 1) {
      expandedFragments.push(fragment);
    }
  }

  const nonHydrogenCount = expandedFragments.length;
  const allBareOxygen =
    nonHydrogenCount > 0 && expandedFragments.every((fragment) => fragment.terminalBareOxygen);

  for (const fragment of expandedFragments) {
    const root = pickAttachmentRoot(roots);
    const bondOrder = determineBondOrder(root.lead, fragment, nonHydrogenCount, allBareOxygen);
    root.children.push({ bondOrder, node: createFragmentNode(fragment) });
    root.assignedChildren += 1;
  }

  const smiles = serializeNode(roots[0]);
  if (!smiles) return null;
  return { smiles, lead: rootToken.element };
}

function resolveHydrogenLedFormula(input: string): StructureCandidate | null {
  const tokens = parseElementTokens(input);
  if (!tokens || tokens.length !== 2 || tokens[0].element !== 'H') return null;
  const [, root] = tokens;
  if (root.count !== 1) return null;

  const hydrogenHalide = HYDROGEN_HALIDES.get(root.element);
  if (tokens[0].count === 1 && hydrogenHalide) {
    return { smiles: hydrogenHalide, source: 'hydrogen-led' };
  }

  if (!VALENCIES[root.element]) return null;
  return { smiles: elementBaseSmiles(root.element), source: 'hydrogen-led' };
}

export function resolveChemicalTextStructure(
  input: string,
  options: ChemicalTextOptions = {},
): ChemicalTextStructureResolution {
  const normalizedInput = normalizeChemicalInput(input);
  if (!normalizedInput) {
    return {
      ok: false,
      input,
      normalizedInput,
      reason: 'empty',
      message: 'Type a chemical formula or SMILES string.',
    };
  }

  const shouldTryDirectSmiles =
    hasDirectSmilesMarkers(normalizedInput) ||
    (Boolean(options.validateSmiles) && /[a-z]/.test(normalizedInput));
  if (shouldTryDirectSmiles) {
    const directSmiles = buildValidatedResolution(
      input,
      normalizedInput,
      { smiles: normalizedInput, source: 'exact' },
      options.validateSmiles,
    );
    if (directSmiles.ok) return directSmiles;
  }

  const exact = EXACT_FORMULA_SMILES[normalizedInput];
  if (exact) {
    return buildValidatedResolution(
      input,
      normalizedInput,
      { smiles: exact, source: 'exact' },
      options.validateSmiles,
    );
  }

  const alias = resolveAliasChemistry(normalizedInput, { validateSmiles: options.validateSmiles });
  const selectedAlias = alias.selected;
  if (
    alias.ok &&
    selectedAlias &&
    selectedAlias.semanticKind !== 'coordination' &&
    selectedAlias.subsSmiles
  ) {
    return buildValidatedResolution(
      input,
      normalizedInput,
      { smiles: selectedAlias.subsSmiles, source: 'alias' },
      options.validateSmiles,
    );
  }

  const repeatedRoot = resolveRepeatedRootFragment(normalizedInput);
  if (repeatedRoot) {
    return buildValidatedResolution(
      input,
      normalizedInput,
      { smiles: repeatedRoot.smiles, source: 'repeated-root' },
      options.validateSmiles,
    );
  }

  const hydrogenLed = resolveHydrogenLedFormula(normalizedInput);
  if (hydrogenLed) {
    return buildValidatedResolution(input, normalizedInput, hydrogenLed, options.validateSmiles);
  }

  if (alias.reason === 'chemically_invalid') {
    return {
      ok: false,
      input,
      normalizedInput,
      reason: 'chemically_invalid',
      message: 'The inferred structure failed chemistry validation.',
    };
  }

  return {
    ok: false,
    input,
    normalizedInput,
    reason: 'unsupported_syntax',
    message: 'This text looks chemical, but the editor could not infer a structure from it.',
  };
}

export function inspectChemicalText(runs: TextRun[]): ChemicalTextInspection {
  const formula = textRunsToChemicalFormula(runs);
  if (!formula || formula.includes('\n')) {
    return {
      intent: false,
      formula,
      resolution: {
        ok: false,
        input: formula,
        normalizedInput: normalizeChemicalInput(formula),
        reason: 'unsupported_syntax',
      },
    };
  }

  const resolution = resolveChemicalTextStructure(formula);
  const intent =
    runs.some((run) => run.sub || run.sup) || (chemicalTextHasIntentCue(formula) && resolution.ok);
  return { intent, formula, resolution };
}

export function buildChemicalTextMetadata(
  runs: TextRun[],
  options: ChemicalTextOptions = {},
): ChemicalTextMetadata | null {
  const inspection = inspectChemicalText(runs);
  const formula = inspection.formula;
  if (!formula) {
    if (!options.forceIntent) return null;
    return {
      intent: true,
      formula,
      chemistryAvailable: false,
      reason: 'empty',
      message: 'Chemical mode is enabled, but this text box is empty.',
    };
  }
  if (formula.includes('\n')) {
    if (!options.forceIntent) return null;
    return {
      intent: true,
      formula,
      chemistryAvailable: false,
      reason: 'unsupported_syntax',
      message: 'Chemical mode currently supports single-line formulas and structures only.',
    };
  }
  if (!inspection.intent && !options.forceIntent) return null;

  const resolution = resolveChemicalTextStructure(formula, {
    validateSmiles: options.validateSmiles,
  });
  return {
    intent: true,
    formula,
    chemistryAvailable: Boolean(resolution.ok && resolution.smiles),
    ...(resolution.smiles ? { smiles: resolution.smiles } : {}),
    ...(resolution.source ? { source: resolution.source } : {}),
    ...(resolution.reason ? { reason: resolution.reason } : {}),
    ...(resolution.message ? { message: resolution.message } : {}),
  };
}

export function evaluateTextBoxChemicalState(
  runs: TextRun[],
  semanticMode: TextBoxSemanticMode = 'auto',
  options: ChemicalTextOptions = {},
): TextBoxChemicalState {
  const normalizedRuns =
    semanticMode === 'plain'
      ? mergeAdjacentRuns(runs.map((run) => ({ ...run })))
      : normalizeChemicalTextRuns(runs);
  const formula = textRunsToChemicalFormula(normalizedRuns);
  if (semanticMode === 'plain') {
    return {
      semanticMode,
      normalizedRuns,
      formula,
      metadata: null,
      intent: false,
      conversionStatus: 'plain',
    };
  }

  const metadata = buildChemicalTextMetadata(normalizedRuns, {
    validateSmiles: options.validateSmiles,
    forceIntent: semanticMode === 'chemical',
  });

  return {
    semanticMode,
    normalizedRuns,
    formula,
    metadata,
    intent: Boolean(metadata?.intent),
    conversionStatus: metadata
      ? metadata.chemistryAvailable
        ? 'resolved'
        : 'unresolved'
      : 'plain',
  };
}
