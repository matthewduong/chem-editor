import type { Atom, AtomLabelOrientation, Bond } from '../types/chemistry';
import { getAtomAlias, getAtomLeadElement, getAtomNodeText } from './atomIdentity';
import { resolveAliasChemistry } from './aliasChemistry';
import { isElementSymbol } from './elements';
import { SHORTHAND_DATA } from './shorthand';

const SUBSCRIPT_DIGITS = ['₀', '₁', '₂', '₃', '₄', '₅', '₆', '₇', '₈', '₉'];
const SUBSCRIPT_TO_DIGIT: Record<string, string> = {
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
};

function formatSubscriptNumber(value: number): string {
  return String(value)
    .split('')
    .map((char) => SUBSCRIPT_DIGITS[parseInt(char, 10)] ?? char)
    .join('');
}

function formatHydrogenLabel(count: number): string {
  if (count <= 0) return '';
  return count === 1 ? 'H' : `H${formatSubscriptNumber(count)}`;
}

function resolveAutoOrientation(
  atom: Atom,
  atoms: Atom[],
  bonds: Bond[],
): 'label-first' | 'hydrogen-first' {
  const connections = bonds.filter((bond) => bond.from === atom.id || bond.to === atom.id);
  if (connections.length === 0) return 'label-first';

  let horizontalBias = 0;
  for (const bond of connections) {
    const neighborId = bond.from === atom.id ? bond.to : bond.from;
    const neighbor = atoms.find((candidate) => candidate.id === neighborId);
    if (!neighbor) continue;
    const dx = neighbor.x - atom.x;
    const dy = neighbor.y - atom.y;
    const length = Math.hypot(dx, dy) || 1;
    const weight = bond.order || 1;
    horizontalBias -= (dx / length) * weight;
  }

  if (horizontalBias > 0.18) return 'label-first';
  if (horizontalBias < -0.18) return 'hydrogen-first';

  const neighbors = connections
    .map((bond) =>
      atoms.find((candidate) => candidate.id === (bond.from === atom.id ? bond.to : bond.from)),
    )
    .filter((neighbor): neighbor is Atom => Boolean(neighbor));
  if (neighbors.length === 0) return 'label-first';

  const centroidX = neighbors.reduce((sum, neighbor) => sum + neighbor.x, 0) / neighbors.length;

  return centroidX > atom.x ? 'hydrogen-first' : 'label-first';
}

export function resolveAtomLabelOrientation(
  atom: Atom,
  atoms: Atom[],
  bonds: Bond[],
): 'label-first' | 'hydrogen-first' {
  if (atom.labelOrientation && atom.labelOrientation !== 'auto') return atom.labelOrientation;
  return resolveAutoOrientation(atom, atoms, bonds);
}

export function getAtomHydrogenCount(
  atom: Atom,
  bonds: Bond[],
  knownValence: number | null,
): number {
  if (knownValence === null) return 0;

  const alias = getAtomAlias(atom);
  const shorthandEntry = alias ? SHORTHAND_DATA[alias] : null;

  const bondCount = bonds
    .filter((bond) => bond.from === atom.id || bond.to === atom.id)
    .reduce((sum, bond) => sum + bond.order, 0);

  // For shorthand groups, use the group's external valency
  // (internal bonds are already accounted for in the shorthand definition)
  if (shorthandEntry) {
    return Math.max(0, shorthandEntry.valency - bondCount);
  }

  const charge = atom.charge || 0;
  const leadElement = getAtomLeadElement(atom);
  let effectiveValence = knownValence;
  if (leadElement === 'C') effectiveValence = knownValence - Math.abs(charge);
  else if (leadElement === 'N' || leadElement === 'O') effectiveValence = knownValence + charge;
  else if (leadElement === 'B') effectiveValence = knownValence + Math.abs(charge);

  return Math.max(0, effectiveValence - bondCount);
}

export function getAtomDisplayText(
  atom: Atom,
  atoms: Atom[],
  bonds: Bond[],
  hydrogenCount: number,
): { text: string; orientation: 'label-first' | 'hydrogen-first' } {
  const key = getAtomNodeText(atom);
  const entry = SHORTHAND_DATA[key];
  const orientation = resolveAtomLabelOrientation(atom, atoms, bonds);
  const connections = bonds.filter((bond) => bond.from === atom.id || bond.to === atom.id);

  let baseText = key;

  if (entry) {
    const totalBondOrder = connections.reduce((sum, bond) => sum + (bond.order || 1), 0);
    const useBuiltInHydrogenLabel = Boolean(
      entry.withH && connections.length > 0 && totalBondOrder < 2,
    );
    if (useBuiltInHydrogenLabel) {
      baseText =
        orientation === 'hydrogen-first' ? (entry.reverseWithH ?? entry.withH!) : entry.withH!;
    } else if (orientation === 'hydrogen-first' && entry.reverse) {
      baseText = entry.reverse;
    }
  }

  const hydrogenText = formatHydrogenLabel(hydrogenCount);
  if (!hydrogenText) return { text: baseText, orientation };

  return {
    text:
      orientation === 'hydrogen-first'
        ? `${hydrogenText}${baseText}`
        : `${baseText}${hydrogenText}`,
    orientation,
  };
}

export interface AtomDisplaySegment {
  text: string;
  element?: string;
}

export type AtomLabelColorMode = 'segmented' | 'monochrome' | 'attached-element';

export interface AtomDisplaySegmentRange extends AtomDisplaySegment {
  start: number;
  end: number;
}

function isSubscriptDigit(char: string): boolean {
  return Object.prototype.hasOwnProperty.call(SUBSCRIPT_TO_DIGIT, char);
}

export function segmentAtomDisplayText(text: string): AtomDisplaySegment[] {
  return segmentAtomDisplayTextWithRanges(text).map(({ text: value, element }) => ({
    text: value,
    ...(element ? { element } : {}),
  }));
}

export function segmentAtomDisplayTextWithRanges(text: string): AtomDisplaySegmentRange[] {
  const segments: AtomDisplaySegmentRange[] = [];
  let cursor = 0;

  const appendToPrevious = (value: string) => {
    const previous = segments[segments.length - 1];
    if (previous) {
      previous.text += value;
      previous.end += value.length;
    } else {
      segments.push({ text: value, start: cursor, end: cursor + value.length });
    }
  };

  while (cursor < text.length) {
    const two = text.slice(cursor, cursor + 2);
    const one = text.slice(cursor, cursor + 1);
    const element = isElementSymbol(two) ? two : isElementSymbol(one) ? one : undefined;

    if (element) {
      segments.push({
        text: element,
        element: element === 'D' ? 'H' : element,
        start: cursor,
        end: cursor + element.length,
      });
      cursor += element.length;
      continue;
    }

    const char = text[cursor];
    if (/[0-9]/.test(char) || isSubscriptDigit(char)) {
      appendToPrevious(char);
      cursor += 1;
      continue;
    }

    if ((char === '+' || char === '−' || char === '-') && segments.length > 0) {
      appendToPrevious(char);
      cursor += 1;
      continue;
    }

    segments.push({ text: char, start: cursor, end: cursor + 1 });
    cursor += 1;
  }

  return segments;
}

export function findLeadElementDisplayRange(
  text: string,
  leadElement: string,
): { start: number; end: number } | null {
  const segments = segmentAtomDisplayTextWithRanges(text);
  if (segments.length === 0) return null;
  if (segments.length === 1 && segments[0].element === leadElement) return null;

  const textCenter = text.length / 2;
  let bestRange: { start: number; end: number } | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const segment of segments) {
    if (segment.element !== leadElement) continue;
    const center = (segment.start + segment.end) / 2;
    const distance = Math.abs(center - textCenter);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestRange = { start: segment.start, end: segment.end };
    }
  }

  return bestRange;
}

function parseSmilesAtom(smiles: string, index: number): { element: string; end: number } | null {
  const char = smiles[index];
  if (!char) return null;

  if (char === '[') {
    const close = smiles.indexOf(']', index + 1);
    if (close < 0) return null;
    const body = smiles.slice(index + 1, close);
    const match = body.match(/[A-Z][a-z]?|[cnospb]/);
    if (!match) return null;
    const raw = match[0];
    const element = raw.length === 1 ? raw.toUpperCase() : raw;
    return { element, end: close + 1 };
  }

  if (/[A-Z]/.test(char)) {
    const next = smiles[index + 1];
    const token = next && /[a-z]/.test(next) ? `${char}${next}` : char;
    return { element: token, end: index + token.length };
  }

  if (/[cnospb]/.test(char)) {
    return { element: char.toUpperCase(), end: index + 1 };
  }

  return null;
}

export function inferAttachedElementFromSubsSmiles(
  subsSmiles: string | undefined,
): string | undefined {
  if (!subsSmiles) return undefined;
  const root = parseSmilesAtom(subsSmiles, 0);
  if (!root) return undefined;

  let cursor = root.end;
  while (cursor < subsSmiles.length) {
    const parsed = parseSmilesAtom(subsSmiles, cursor);
    if (parsed) return parsed.element;
    cursor += 1;
  }

  return undefined;
}

export function segmentAliasDisplayText(
  text: string,
  leadElement: string,
  attachedElement: string | undefined,
): AtomDisplaySegment[] | null {
  const leadRange = findLeadElementDisplayRange(text, leadElement);
  if (!leadRange || !attachedElement || attachedElement === leadElement) return null;

  const segmentAffix = (chunk: string): AtomDisplaySegment[] => {
    if (!chunk) return [];
    const nestedLead = resolveAliasChemistry(chunk).selected?.entry.lead;
    if (nestedLead === attachedElement) {
      return [{ text: chunk, element: attachedElement }];
    }
    return segmentAtomDisplayText(chunk);
  };

  const segments: AtomDisplaySegment[] = [];
  if (leadRange.start > 0) {
    segments.push(...segmentAffix(text.slice(0, leadRange.start)));
  }
  segments.push({
    text: text.slice(leadRange.start, leadRange.end),
    element: leadElement,
  });
  if (leadRange.end < text.length) {
    segments.push(...segmentAffix(text.slice(leadRange.end)));
  }
  return segments;
}

export function getColoredAtomDisplaySegments(
  atom: Atom,
  displayText: string,
): AtomDisplaySegment[] {
  const alias = getAtomAlias(atom);
  if (alias) {
    const entry = resolveAliasChemistry(alias, {
      preferredCandidateId: atom.aliasResolution?.selectedCandidateId,
    }).selected?.entry;
    const leadElement = entry?.lead ?? getAtomLeadElement(atom);
    const attachedElement = inferAttachedElementFromSubsSmiles(entry?.subsSmiles);
    const aliasSegments = segmentAliasDisplayText(displayText, leadElement, attachedElement);
    if (aliasSegments) return aliasSegments;
  }
  return segmentAtomDisplayText(displayText);
}

export function getAtomLabelColorMode(atom: Atom): AtomLabelColorMode {
  const alias = getAtomAlias(atom);
  if (!alias) return 'segmented';

  const entry = resolveAliasChemistry(alias, {
    preferredCandidateId: atom.aliasResolution?.selectedCandidateId,
  }).selected?.entry;

  return entry?.colorMode ?? 'segmented';
}

export function justificationToAtomLabelOrientation(
  justification: 'left' | 'center' | 'right' | undefined,
): AtomLabelOrientation | undefined {
  if (justification === 'left') return 'label-first';
  if (justification === 'right') return 'hydrogen-first';
  return undefined;
}

export function atomLabelOrientationToJustification(
  orientation: AtomLabelOrientation | undefined,
): 'left' | 'center' | 'right' | undefined {
  if (orientation === 'label-first') return 'left';
  if (orientation === 'hydrogen-first') return 'right';
  if (orientation === 'auto') return 'center';
  return undefined;
}

export function normalizeAtomDisplayText(text: string): string {
  return text
    .split('')
    .map((char) => SUBSCRIPT_TO_DIGIT[char] ?? char)
    .join('');
}

export function inferAtomLabelFromDisplayedText(
  text: string,
  element: string,
): { alias?: string; labelOrientation?: AtomLabelOrientation } {
  const normalized = normalizeAtomDisplayText(text.trim());
  if (!normalized) return {};
  if (normalized === element) return {};

  for (const [key, entry] of Object.entries(SHORTHAND_DATA)) {
    if (normalized === key) return { alias: key, labelOrientation: 'label-first' };
    if (entry.withH && normalized === entry.withH)
      return { alias: key, labelOrientation: 'label-first' };
    if (entry.reverse && normalized === entry.reverse)
      return { alias: key, labelOrientation: 'hydrogen-first' };
    if (entry.reverseWithH && normalized === entry.reverseWithH)
      return { alias: key, labelOrientation: 'hydrogen-first' };
  }

  return { alias: normalized };
}
