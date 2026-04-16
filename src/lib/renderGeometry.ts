import type { Arrow, Atom, Bond, DoubleBondMode } from '../types/chemistry';
import type { ChemDrawArrow, ChemDrawBond } from '../types/chemdraw';
import type { DocumentStyleSettings } from '../types/settings';
import {
  findLeadElementDisplayRange,
  getAtomDisplayText,
  getAtomHydrogenCount,
  segmentAtomDisplayText,
} from './atomLabels';
import { getAtomAlias, getAtomLeadElement, isAliasAtom } from './atomIdentity';
import {
  DEFAULT_CHEMDRAW_STYLE_SHEET,
  DEFAULT_CHEMDRAW_LABEL_FONT_SIZE,
  getDefaultArrowLineWidth as getDefaultArrowLineWidthFromMetrics,
  resolveArrowGeometryMetrics,
  resolveBondSpacing,
  resolveDocumentRenderMetrics,
} from './chemdrawMetrics';
import { VALENCIES } from './elements';
import { SHORTHAND_DATA } from './shorthand';

export const DEFAULT_ATOM_LABEL_FONT_SIZE = DEFAULT_CHEMDRAW_LABEL_FONT_SIZE;
const MIN_LABEL_WIDTH_RATIO = 22 / 16;
const MIN_BOND_CLIP_RATIO = 5 / 16;
const DEFAULT_MARGIN_TO_BOND_SPACING_RATIO =
  DEFAULT_CHEMDRAW_STYLE_SHEET.marginWidth /
  ((DEFAULT_CHEMDRAW_STYLE_SHEET.bondLength * DEFAULT_CHEMDRAW_STYLE_SHEET.bondSpacingPct) / 100);

export function computeRingCentroids(
  atoms: Atom[],
  bonds: Bond[],
): Map<string, { cx: number; cy: number; n: number }> {
  const adj = new Map<string, { neighborId: string; bondId: string }[]>();
  for (const atom of atoms) adj.set(atom.id, []);
  for (const bond of bonds) {
    adj.get(bond.from)?.push({ neighborId: bond.to, bondId: bond.id });
    adj.get(bond.to)?.push({ neighborId: bond.from, bondId: bond.id });
  }

  const atomById = new Map(atoms.map((atom) => [atom.id, atom]));
  const result = new Map<string, { cx: number; cy: number; n: number }>();
  for (const bond of bonds) {
    const prev = new Map<string, string>();
    const queue = [bond.from];
    prev.set(bond.from, '');
    let found = false;

    while (queue.length && !found) {
      const current = queue.shift()!;
      for (const { neighborId, bondId } of adj.get(current) ?? []) {
        if (bondId === bond.id || prev.has(neighborId)) continue;
        prev.set(neighborId, current);
        if (neighborId === bond.to) {
          found = true;
          break;
        }
        queue.push(neighborId);
      }
    }

    if (!found) continue;
    const ring: string[] = [];
    let current = bond.to;
    while (current !== '') {
      ring.push(current);
      current = prev.get(current)!;
    }
    if (ring.length > 8) continue;

    const cx = ring.reduce((sum, id) => sum + (atomById.get(id)?.x ?? 0), 0) / ring.length;
    const cy = ring.reduce((sum, id) => sum + (atomById.get(id)?.y ?? 0), 0) / ring.length;
    result.set(bond.id, { cx, cy, n: ring.length });
  }
  return result;
}

export function isAtomLabelVisible(atom: Atom, connectedBondCount: number): boolean {
  return getAtomLeadElement(atom) !== 'C' || connectedBondCount === 0 || isAliasAtom(atom);
}

type ArrowGeometryLike = Pick<Arrow, 'x1' | 'y1' | 'x2' | 'y2'> &
  Partial<Pick<Arrow, 'cpx' | 'cpy' | 'type' | 'curveEnabled' | 'lineWidth' | 'lineStyle'>>;

export function arrowUsesControlPoint(
  arrow: Partial<Pick<Arrow, 'type' | 'curveEnabled'>>,
): boolean {
  return arrow.type === 'curved' || arrow.type === 'half-curved' || Boolean(arrow.curveEnabled);
}

export function getDefaultArrowLineWidth(
  type?: Arrow['type'],
  lineStyle?: Arrow['lineStyle'],
  documentStyleSettings?: DocumentStyleSettings | null,
): number {
  return getDefaultArrowLineWidthFromMetrics(type, lineStyle, documentStyleSettings);
}

export function getEffectiveArrowLineWidth(
  arrow: Partial<Pick<Arrow, 'type' | 'lineWidth' | 'lineStyle'>>,
  documentStyleSettings?: DocumentStyleSettings | null,
): number {
  return Math.max(
    1,
    arrow.lineWidth ?? getDefaultArrowLineWidth(arrow.type, arrow.lineStyle, documentStyleSettings),
  );
}

export function getArrowGeometryMetrics(
  arrow: Partial<Pick<Arrow, 'type' | 'lineWidth' | 'lineStyle'>>,
  documentStyleSettings?: DocumentStyleSettings | null,
  nativeArrow?: Pick<
    ChemDrawArrow,
    'headSize' | 'headCenterSize' | 'headWidth' | 'shaftSpacing' | 'equilibriumRatio' | 'style'
  > | null,
) {
  return resolveArrowGeometryMetrics(
    {
      type: arrow.type,
      lineStyle: arrow.lineStyle,
      lineWidth: arrow.lineWidth,
    },
    documentStyleSettings,
    nativeArrow,
  );
}

export function getDefaultArrowControlPoint(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): { cpx: number; cpy: number } {
  const mx = (x1 + x2) / 2;
  const my = (y1 + y2) / 2;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1) return { cpx: mx, cpy: my };
  const perpX = dy / len;
  const perpY = -dx / len;
  const bend = Math.min(len * 0.35, 70);
  return { cpx: mx + perpX * bend, cpy: my + perpY * bend };
}

export function getArrowPointAt(arrow: ArrowGeometryLike, t: number) {
  if (
    arrowUsesControlPoint(arrow) &&
    typeof arrow.cpx === 'number' &&
    typeof arrow.cpy === 'number'
  ) {
    return {
      x: (1 - t) ** 2 * arrow.x1 + 2 * (1 - t) * t * arrow.cpx + t ** 2 * arrow.x2,
      y: (1 - t) ** 2 * arrow.y1 + 2 * (1 - t) * t * arrow.cpy + t ** 2 * arrow.y2,
    };
  }
  return {
    x: arrow.x1 + (arrow.x2 - arrow.x1) * t,
    y: arrow.y1 + (arrow.y2 - arrow.y1) * t,
  };
}

export function getArrowTangentAt(arrow: ArrowGeometryLike, t: number) {
  if (
    arrowUsesControlPoint(arrow) &&
    typeof arrow.cpx === 'number' &&
    typeof arrow.cpy === 'number'
  ) {
    const dx = 2 * (1 - t) * (arrow.cpx - arrow.x1) + 2 * t * (arrow.x2 - arrow.cpx);
    const dy = 2 * (1 - t) * (arrow.cpy - arrow.y1) + 2 * t * (arrow.y2 - arrow.cpy);
    if (Math.hypot(dx, dy) > 1e-6) return { dx, dy };
  }
  return { dx: arrow.x2 - arrow.x1, dy: arrow.y2 - arrow.y1 };
}

export function getArrowAxisNormal(arrow: Pick<Arrow, 'x1' | 'y1' | 'x2' | 'y2'>) {
  const dx = arrow.x2 - arrow.x1;
  const dy = arrow.y2 - arrow.y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { nx: 0, ny: -1 };
  return { nx: -dy / len, ny: dx / len };
}

export function getArrowOffsetCurve(arrow: ArrowGeometryLike, offset: number) {
  const { nx, ny } = getArrowAxisNormal(arrow);
  const cpx = typeof arrow.cpx === 'number' ? arrow.cpx : (arrow.x1 + arrow.x2) / 2;
  const cpy = typeof arrow.cpy === 'number' ? arrow.cpy : (arrow.y1 + arrow.y2) / 2;
  return {
    x1: arrow.x1 + nx * offset,
    y1: arrow.y1 + ny * offset,
    x2: arrow.x2 + nx * offset,
    y2: arrow.y2 + ny * offset,
    cpx: cpx + nx * offset,
    cpy: cpy + ny * offset,
  };
}

export function getArrowSelectionPoints(arrow: ArrowGeometryLike) {
  if (
    arrowUsesControlPoint(arrow) &&
    typeof arrow.cpx === 'number' &&
    typeof arrow.cpy === 'number'
  ) {
    return [
      { x: arrow.x1, y: arrow.y1 },
      { x: arrow.cpx, y: arrow.cpy },
      { x: arrow.x2, y: arrow.y2 },
    ];
  }
  return [
    { x: arrow.x1, y: arrow.y1 },
    { x: arrow.x2, y: arrow.y2 },
  ];
}

export function getArrowLabelAnchors(
  arrow: Pick<Arrow, 'x1' | 'y1' | 'x2' | 'y2'> &
    Partial<Pick<Arrow, 'cpx' | 'cpy' | 'type' | 'curveEnabled'>>,
  offset = 18,
) {
  const mid = getArrowPointAt(arrow, 0.5);
  const tangent = getArrowTangentAt(arrow, 0.5);
  const angle = Math.atan2(tangent.dy, tangent.dx);
  return {
    above: {
      x: mid.x + Math.sin(angle) * offset,
      y: mid.y - Math.cos(angle) * offset,
    },
    below: {
      x: mid.x - Math.sin(angle) * offset,
      y: mid.y + Math.cos(angle) * offset,
    },
  };
}

type LabelClipMetrics = {
  halfWidth: number;
  halfHeight: number;
  clipMode: 'rect' | 'circle';
  clipRadius?: number;
};

export type AtomLabelLayoutMetrics = {
  textWidth: number;
  boxWidth: number;
  boxHeight: number;
  boxPadX: number;
  boxPadY: number;
  cornerRadius: number;
  chargeFontSize: number;
  chargeOffsetX: number;
  chargeOffsetY: number;
  hoverRadius: number;
  hoverStrokeWidth: number;
  queryPadX: number;
  queryPadY: number;
  queryCornerRadius: number;
  electronDistance: number;
  electronPairSpacing: number;
  electronDotRadius: number;
};

export type BondVisualMetrics = {
  parallelOffset: number;
  boldWidth: number;
  dashPattern: [number, number];
  aromaticDashPattern: [number, number];
  crossHalfLength: number;
  dativeHeadSize: number;
  stereoHalfWidth: number;
  hashStartWidth: number;
  hashStepWidth: number;
  hashStepCount: number;
  waveAmplitude: number;
  ringInsetBase: number;
  tripleOffsetScale: number;
  tripleInlineInset: number;
};

export interface DoubleBondLineGeometry {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface BondNeighborVector {
  x: number;
  y: number;
}

export interface BondNeighborVectors {
  from: BondNeighborVector[];
  to: BondNeighborVector[];
}

export const DEFAULT_DOUBLE_BOND_MODE: DoubleBondMode = 'auto';
export const DOUBLE_BOND_MODE_SEQUENCE: DoubleBondMode[] = ['auto', 'flipped', 'symmetric'];

export function resolveDoubleBondMode(mode?: DoubleBondMode | null): DoubleBondMode {
  return mode ?? DEFAULT_DOUBLE_BOND_MODE;
}

export function cycleDoubleBondMode(mode: DoubleBondMode | undefined): DoubleBondMode {
  const current = resolveDoubleBondMode(mode);
  const index = DOUBLE_BOND_MODE_SEQUENCE.indexOf(current);
  return DOUBLE_BOND_MODE_SEQUENCE[
    (index + 1 + DOUBLE_BOND_MODE_SEQUENCE.length) % DOUBLE_BOND_MODE_SEQUENCE.length
  ];
}

export function getNextDoubleBondToolMode(
  bond?: Pick<Bond, 'order' | 'doubleBondMode'> | null,
): DoubleBondMode {
  return bond?.order === 2 ? cycleDoubleBondMode(bond.doubleBondMode) : DEFAULT_DOUBLE_BOND_MODE;
}

function estimateLabelSegmentWidth(text: string, fontSize: number): number {
  return Math.max(1, text.length * (fontSize * 0.75));
}

function getResolvedLabelMarginWidth(documentStyleSettings?: DocumentStyleSettings | null): number {
  return documentStyleSettings
    ? resolveDocumentRenderMetrics(documentStyleSettings).marginWidth
    : 0;
}

export function getDefaultAtomLabelFontSize(
  documentStyleSettings?: DocumentStyleSettings | null,
): number {
  return documentStyleSettings
    ? resolveDocumentRenderMetrics(documentStyleSettings).labelFontSize
    : DEFAULT_ATOM_LABEL_FONT_SIZE;
}

export function getAtomLabelBoxWidth(fontSize: number, textWidth: number): number {
  return Math.max(fontSize * MIN_LABEL_WIDTH_RATIO, textWidth);
}

export function getAtomLabelBoxHeight(fontSize: number): number {
  return Math.max(20, fontSize + 6);
}

function getAtomLabelCapHeight(fontSize: number): number {
  return Math.max(14, fontSize * 0.72);
}

export function getAtomMinimumBondClipOffset(
  fontSize: number,
  documentStyleSettings?: DocumentStyleSettings | null,
): number {
  return Math.max(
    fontSize * MIN_BOND_CLIP_RATIO,
    getResolvedLabelMarginWidth(documentStyleSettings),
  );
}

export function getAtomLabelLayoutMetrics(
  fontSize: number,
  textWidth: number,
  documentStyleSettings?: DocumentStyleSettings | null,
): AtomLabelLayoutMetrics {
  const boxWidth = getAtomLabelBoxWidth(fontSize, textWidth);
  const boxHeight = getAtomLabelBoxHeight(fontSize);
  const marginWidth = getResolvedLabelMarginWidth(documentStyleSettings);
  const boxPadX = Math.max(2, Math.max(fontSize * 0.1, marginWidth * 0.85));
  const boxPadY = Math.max(2, Math.max(boxHeight * 0.08, marginWidth * 0.7));
  return {
    textWidth,
    boxWidth,
    boxHeight,
    boxPadX,
    boxPadY,
    cornerRadius: Math.min(boxHeight * 0.5, fontSize * 0.625),
    chargeFontSize: Math.max(11, fontSize * 0.55),
    chargeOffsetX: Math.max(2, fontSize * 0.1),
    chargeOffsetY: Math.max(6, fontSize * 0.85),
    hoverRadius: Math.max(
      7,
      Math.min(boxWidth, boxHeight) * 0.45 + Math.max(1, marginWidth * 0.35),
    ),
    hoverStrokeWidth: Math.max(1, fontSize * 0.05),
    queryPadX: Math.max(4, Math.max(fontSize * 0.2, marginWidth * 1.6)),
    queryPadY: Math.max(3, Math.max(fontSize * 0.15, marginWidth * 1.15)),
    queryCornerRadius: Math.max(4, Math.max(fontSize * 0.2, marginWidth * 1.4)),
    electronDistance: Math.max(12, fontSize * 0.75),
    electronPairSpacing: Math.max(3, fontSize * 0.18),
    electronDotRadius: Math.max(1.8, fontSize * 0.11),
  };
}

export function getBondVisualMetrics(
  lineWidth: number,
  bondLength: number,
  options?: {
    documentStyleSettings?: DocumentStyleSettings | null;
    nativeBond?: Pick<ChemDrawBond, 'bondSpacingAbs' | 'bondSpacingPct'> | null;
  },
): BondVisualMetrics {
  const resolvedMetrics = options?.documentStyleSettings
    ? resolveDocumentRenderMetrics(options.documentStyleSettings)
    : null;
  const parallelOffset =
    options?.documentStyleSettings != null
      ? resolveBondSpacing(options.documentStyleSettings, options.nativeBond)
      : Math.min(Math.max(4.5, lineWidth * 2.25), bondLength * 0.18);
  const multiBondInsetBase = resolvedMetrics
    ? resolvedMetrics.marginWidth
    : Math.max(lineWidth, parallelOffset * DEFAULT_MARGIN_TO_BOND_SPACING_RATIO);
  const boldWidth = resolvedMetrics
    ? Math.max(lineWidth, resolvedMetrics.boldWidth)
    : Math.max(lineWidth + 2, 4);
  const stereoHalfWidth = Math.max(3, boldWidth * 0.95);
  const hashStepSpacing = resolvedMetrics?.hashSpacing ?? Math.max(5, bondLength / 7);
  const hashStepCount = Math.max(3, Math.round(bondLength / hashStepSpacing));
  const hashStartWidth = Math.max(lineWidth * 0.4, boldWidth * 0.12);
  return {
    parallelOffset,
    boldWidth,
    dashPattern: [Math.max(6, lineWidth * 3), Math.max(4, lineWidth * 2)],
    aromaticDashPattern: [Math.max(4, lineWidth * 2), Math.max(4, lineWidth * 2)],
    crossHalfLength: parallelOffset * 1.5,
    dativeHeadSize: Math.max(8, boldWidth * 1.6),
    stereoHalfWidth,
    hashStartWidth,
    hashStepWidth: (stereoHalfWidth - hashStartWidth) / hashStepCount,
    hashStepCount,
    waveAmplitude: Math.max(2.5, Math.max(lineWidth * 1.2, boldWidth * 0.5)),
    ringInsetBase: multiBondInsetBase,
    tripleOffsetScale: 1,
    tripleInlineInset: multiBondInsetBase,
  };
}

function normalizeNeighborVector(dx: number, dy: number): BondNeighborVector | null {
  const length = Math.hypot(dx, dy);
  if (length < 1e-6) return null;
  return { x: dx / length, y: dy / length };
}

export function collectBondNeighborVectors(options: {
  bond: Pick<Bond, 'id' | 'from' | 'to'>;
  fromAtom: Atom;
  toAtom: Atom;
  atomLookup: Map<string, Atom>;
  bonds: Bond[];
}): BondNeighborVectors {
  const { bond, fromAtom, toAtom, atomLookup, bonds } = options;
  const from: BondNeighborVector[] = [];
  const to: BondNeighborVector[] = [];
  for (const candidate of bonds) {
    if (candidate.id === bond.id) continue;
    if (candidate.from === bond.from || candidate.to === bond.from) {
      const otherAtom = atomLookup.get(candidate.from === bond.from ? candidate.to : candidate.from);
      if (otherAtom) {
        const vector = normalizeNeighborVector(otherAtom.x - fromAtom.x, otherAtom.y - fromAtom.y);
        if (vector) from.push(vector);
      }
    }
    if (candidate.from === bond.to || candidate.to === bond.to) {
      const otherAtom = atomLookup.get(candidate.from === bond.to ? candidate.to : candidate.from);
      if (otherAtom) {
        const vector = normalizeNeighborVector(otherAtom.x - toAtom.x, otherAtom.y - toAtom.y);
        if (vector) to.push(vector);
      }
    }
  }
  return { from, to };
}

function getBondEndpointClipDistance(
  atom: Atom,
  pointX: number,
  pointY: number,
  directionX: number,
  directionY: number,
): number {
  return Math.max(0, (pointX - atom.x) * directionX + (pointY - atom.y) * directionY);
}

function getOffsetBondEndpointTrim(options: {
  directionX: number;
  directionY: number;
  offsetX: number;
  offsetY: number;
  clipDistance: number;
  neighborVectors?: BondNeighborVector[];
}): number {
  const { directionX, directionY, offsetX, offsetY, clipDistance, neighborVectors = [] } = options;
  const offsetMagnitude = Math.hypot(offsetX, offsetY);
  if (offsetMagnitude < 1e-6) return 0;
  const offsetSide = directionX * offsetY - directionY * offsetX;
  if (Math.abs(offsetSide) < 1e-6) return 0;

  let trim = 0;
  for (const neighbor of neighborVectors) {
    const cross = directionX * neighbor.y - directionY * neighbor.x;
    if (Math.abs(cross) < 1e-6 || cross * offsetSide <= 1e-6) continue;
    const dot = directionX * neighbor.x + directionY * neighbor.y;
    if (dot <= 1e-6) continue;
    trim = Math.max(trim, offsetMagnitude * (dot / Math.abs(cross)) - clipDistance);
  }
  return Math.max(0, trim);
}

function clampOffsetBondInsets(
  startInset: number,
  endInset: number,
  lineLength: number,
): [number, number] {
  const maxPerEndpoint = Math.max(0, lineLength * 0.5 - 0.25);
  let clampedStart = Math.min(Math.max(0, startInset), maxPerEndpoint);
  let clampedEnd = Math.min(Math.max(0, endInset), maxPerEndpoint);
  const minimumVisibleLength = Math.min(1, lineLength);
  const maxTotalInset = Math.max(0, lineLength - minimumVisibleLength);
  if (clampedStart + clampedEnd > maxTotalInset && clampedStart + clampedEnd > 0) {
    const scale = maxTotalInset / (clampedStart + clampedEnd);
    clampedStart *= scale;
    clampedEnd *= scale;
  }
  return [clampedStart, clampedEnd];
}

export function getOffsetBondLineGeometry(options: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  unitX: number;
  unitY: number;
  offsetX: number;
  offsetY: number;
  fromAtom: Atom;
  toAtom: Atom;
  baseStartInset?: number;
  baseEndInset?: number;
  startNeighborVectors?: BondNeighborVector[];
  endNeighborVectors?: BondNeighborVector[];
}): DoubleBondLineGeometry {
  const {
    startX,
    startY,
    endX,
    endY,
    unitX,
    unitY,
    offsetX,
    offsetY,
    fromAtom,
    toAtom,
    baseStartInset = 0,
    baseEndInset = 0,
    startNeighborVectors,
    endNeighborVectors,
  } = options;
  const lineLength = Math.hypot(endX - startX, endY - startY);
  const startClipDistance = getBondEndpointClipDistance(fromAtom, startX, startY, unitX, unitY);
  const endClipDistance = getBondEndpointClipDistance(toAtom, endX, endY, -unitX, -unitY);
  const [startInset, endInset] = clampOffsetBondInsets(
    Math.max(
      baseStartInset,
      getOffsetBondEndpointTrim({
        directionX: unitX,
        directionY: unitY,
        offsetX,
        offsetY,
        clipDistance: startClipDistance,
        neighborVectors: startNeighborVectors,
      }),
    ),
    Math.max(
      baseEndInset,
      getOffsetBondEndpointTrim({
        directionX: -unitX,
        directionY: -unitY,
        offsetX,
        offsetY,
        clipDistance: endClipDistance,
        neighborVectors: endNeighborVectors,
      }),
    ),
    lineLength,
  );
  return {
    startX: startX + offsetX + unitX * startInset,
    startY: startY + offsetY + unitY * startInset,
    endX: endX + offsetX - unitX * endInset,
    endY: endY + offsetY - unitY * endInset,
  };
}

export function getDoubleBondLineGeometry(options: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  unitX: number;
  unitY: number;
  normalX: number;
  normalY: number;
  mode?: DoubleBondMode;
  visual: BondVisualMetrics;
  fromAtom: Atom;
  toAtom: Atom;
  ringCentroid?: { cx: number; cy: number; n: number };
  startNeighborVectors?: BondNeighborVector[];
  endNeighborVectors?: BondNeighborVector[];
}): DoubleBondLineGeometry[] {
  const {
    startX,
    startY,
    endX,
    endY,
    unitX,
    unitY,
    normalX,
    normalY,
    mode = 'auto',
    visual,
    fromAtom,
    toAtom,
    ringCentroid,
    startNeighborVectors,
    endNeighborVectors,
  } = options;

  let autoSign = 1;
  let inset = 0;
  if (ringCentroid) {
    const midX = (fromAtom.x + toAtom.x) / 2;
    const midY = (fromAtom.y + toAtom.y) / 2;
    if ((ringCentroid.cx - midX) * normalX + (ringCentroid.cy - midY) * normalY < 0) autoSign = -1;
    const interiorAngle = ((ringCentroid.n - 2) * Math.PI) / ringCentroid.n;
    inset = visual.parallelOffset / Math.tan(interiorAngle / 2);
  }

  let effectiveMode = mode === 'auto' && !ringCentroid ? 'symmetric' : mode;

  // For acyclic auto bonds, detect the preferred side from chain neighbor vectors.
  // If neighbors define a clear net perpendicular preference (non-symmetric chain),
  // switch to asymmetric rendering so the primary line connects cleanly to the atom.
  if (effectiveMode === 'symmetric') {
    const normalMag = Math.hypot(normalX, normalY);
    if (normalMag > 1e-6) {
      let netPerp = 0;
      for (const v of (startNeighborVectors ?? [])) {
        netPerp += v.x * normalX + v.y * normalY;
      }
      for (const v of (endNeighborVectors ?? [])) {
        netPerp += v.x * normalX + v.y * normalY;
      }
      if (Math.abs(netPerp) > normalMag * 0.3) {
        autoSign = netPerp < 0 ? -1 : 1;
        effectiveMode = 'auto';
      }
    }
  }

  if (effectiveMode === 'symmetric') {
    const halfOffsetX = normalX * 0.5;
    const halfOffsetY = normalY * 0.5;
    return [
      getOffsetBondLineGeometry({
        startX,
        startY,
        endX,
        endY,
        unitX,
        unitY,
        offsetX: halfOffsetX,
        offsetY: halfOffsetY,
        fromAtom,
        toAtom,
        startNeighborVectors,
        endNeighborVectors,
      }),
      getOffsetBondLineGeometry({
        startX,
        startY,
        endX,
        endY,
        unitX,
        unitY,
        offsetX: -halfOffsetX,
        offsetY: -halfOffsetY,
        fromAtom,
        toAtom,
        startNeighborVectors,
        endNeighborVectors,
      }),
    ];
  }

  const sign = effectiveMode === 'flipped' ? -autoSign : autoSign;
  return [
    { startX, startY, endX, endY },
    getOffsetBondLineGeometry({
      startX,
      startY,
      endX,
      endY,
      unitX,
      unitY,
      offsetX: sign * normalX,
      offsetY: sign * normalY,
      fromAtom,
      toAtom,
      baseStartInset: inset,
      baseEndInset: inset,
      startNeighborVectors,
      endNeighborVectors,
    }),
  ];
}

export function getTripleBondLineGeometry(options: {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  unitX: number;
  unitY: number;
  normalX: number;
  normalY: number;
  visual: BondVisualMetrics;
  fromAtom: Atom;
  toAtom: Atom;
  startNeighborVectors?: BondNeighborVector[];
  endNeighborVectors?: BondNeighborVector[];
}): [DoubleBondLineGeometry, DoubleBondLineGeometry] {
  const {
    startX,
    startY,
    endX,
    endY,
    unitX,
    unitY,
    normalX,
    normalY,
    visual,
    fromAtom,
    toAtom,
    startNeighborVectors,
    endNeighborVectors,
  } = options;
  const offsetX = normalX * visual.tripleOffsetScale;
  const offsetY = normalY * visual.tripleOffsetScale;
  return [
    getOffsetBondLineGeometry({
      startX,
      startY,
      endX,
      endY,
      unitX,
      unitY,
      offsetX,
      offsetY,
      fromAtom,
      toAtom,
      baseStartInset: visual.tripleInlineInset,
      baseEndInset: visual.tripleInlineInset,
      startNeighborVectors,
      endNeighborVectors,
    }),
    getOffsetBondLineGeometry({
      startX,
      startY,
      endX,
      endY,
      unitX,
      unitY,
      offsetX: -offsetX,
      offsetY: -offsetY,
      fromAtom,
      toAtom,
      baseStartInset: visual.tripleInlineInset,
      baseEndInset: visual.tripleInlineInset,
      startNeighborVectors,
      endNeighborVectors,
    }),
  ];
}

function getFullLabelMetrics(
  labelText: string,
  fontSize: number,
  documentStyleSettings?: DocumentStyleSettings | null,
): LabelClipMetrics {
  const width = getAtomLabelBoxWidth(fontSize, estimateLabelSegmentWidth(labelText, fontSize));
  const height = getAtomLabelBoxHeight(fontSize);
  const marginWidth = getResolvedLabelMarginWidth(documentStyleSettings);
  return {
    halfWidth: width / 2 + 1 + marginWidth * 0.5,
    halfHeight: height / 2 + 1 + marginWidth * 0.25,
    clipMode: 'rect',
  };
}

function getLeadElementClipRadius(
  fontSize: number,
  halfWidth: number,
  halfHeight: number,
  documentStyleSettings?: DocumentStyleSettings | null,
): number {
  return Math.max(
    getAtomMinimumBondClipOffset(fontSize, documentStyleSettings),
    Math.sqrt(halfWidth * halfHeight),
  );
}

function getLeadElementLabelMetrics(
  atom: Atom,
  labelText: string,
  fontSize: number,
  documentStyleSettings?: DocumentStyleSettings | null,
): LabelClipMetrics | null {
  const leadElement = getAtomLeadElement(atom);
  const leadRange = findLeadElementDisplayRange(labelText, leadElement);
  if (!leadRange && labelText === leadElement && leadElement.length === 1) {
    const width = estimateLabelSegmentWidth(labelText, fontSize);
    const halfHeight = getAtomLabelCapHeight(fontSize) / 2 + 1;
    const halfWidth = width / 2 + 1;
    return {
      halfWidth,
      halfHeight,
      clipMode: 'circle',
      clipRadius: getLeadElementClipRadius(fontSize, halfWidth, halfHeight, documentStyleSettings),
    };
  }
  if (!leadRange) return null;

  const segments = segmentAtomDisplayText(labelText);
  const halfHeight = getAtomLabelCapHeight(fontSize) / 2 + 1;
  let textCursor = 0;

  for (let i = 0; i < segments.length; i += 1) {
    const width = estimateLabelSegmentWidth(segments[i].text, fontSize);
    const segmentStart = textCursor;
    const segmentEnd = textCursor + segments[i].text.length;
    if (segmentStart === leadRange.start && segmentEnd === leadRange.end) {
      const halfWidth = width / 2 + 1;
      return {
        halfWidth,
        halfHeight,
        clipMode: 'circle',
        clipRadius: getLeadElementClipRadius(
          fontSize,
          halfWidth,
          halfHeight,
          documentStyleSettings,
        ),
      };
    }
    textCursor = segmentEnd;
  }

  return null;
}

function getAtomLabelMetrics(
  atom: Atom,
  atoms: Atom[],
  bonds: Bond[],
  documentStyleSettings?: DocumentStyleSettings | null,
) {
  const connectedBonds = bonds.filter((bond) => bond.from === atom.id || bond.to === atom.id);
  const labelVisible = isAtomLabelVisible(atom, connectedBonds.length);
  if (!labelVisible) return null;

  const leadElement = getAtomLeadElement(atom);
  const knownValence: number | null = VALENCIES[leadElement] ?? null;
  const alias = getAtomAlias(atom);
  const canShowImplicitHydrogens = !alias || Boolean(SHORTHAND_DATA[alias]);
  const hydrogenCount =
    knownValence !== null && canShowImplicitHydrogens
      ? getAtomHydrogenCount(atom, bonds, knownValence)
      : 0;
  const labelText = getAtomDisplayText(atom, atoms, bonds, hydrogenCount).text;
  const fontSize = atom.labelFontSize ?? getDefaultAtomLabelFontSize(documentStyleSettings);
  return (
    getLeadElementLabelMetrics(atom, labelText, fontSize, documentStyleSettings) ??
    getFullLabelMetrics(labelText, fontSize, documentStyleSettings)
  );
}

function intersectRayWithRect(ux: number, uy: number, rect: LabelClipMetrics): number | null {
  const minX = -rect.halfWidth;
  const maxX = rect.halfWidth;
  const minY = -rect.halfHeight;
  const maxY = rect.halfHeight;

  let tMin = -Infinity;
  let tMax = Infinity;

  if (Math.abs(ux) < 1e-6) {
    if (minX > 0 || maxX < 0) return null;
  } else {
    const tx1 = minX / ux;
    const tx2 = maxX / ux;
    tMin = Math.max(tMin, Math.min(tx1, tx2));
    tMax = Math.min(tMax, Math.max(tx1, tx2));
  }

  if (Math.abs(uy) < 1e-6) {
    if (minY > 0 || maxY < 0) return null;
  } else {
    const ty1 = minY / uy;
    const ty2 = maxY / uy;
    tMin = Math.max(tMin, Math.min(ty1, ty2));
    tMax = Math.min(tMax, Math.max(ty1, ty2));
  }

  if (tMax < 0 || tMin > tMax) return null;
  if (tMin >= 0) return tMin;
  if (tMax >= 0) return tMax;
  return null;
}

export function getAtomBondClipOffset(
  atom: Atom,
  atoms: Atom[],
  bonds: Bond[],
  ux: number,
  uy: number,
  documentStyleSettings?: DocumentStyleSettings | null,
): number {
  const metrics = getAtomLabelMetrics(atom, atoms, bonds, documentStyleSettings);
  if (!metrics) return 0;

  const fontSize = atom.labelFontSize ?? getDefaultAtomLabelFontSize(documentStyleSettings);
  if (metrics.clipMode === 'circle') {
    return Math.max(
      getAtomMinimumBondClipOffset(fontSize, documentStyleSettings),
      metrics.clipRadius ?? 0,
    );
  }

  const rectDistance = intersectRayWithRect(ux, uy, metrics) ?? 0;
  return Math.max(getAtomMinimumBondClipOffset(fontSize, documentStyleSettings), rectDistance);
}

type BondSegment = {
  sX: number;
  sY: number;
  eX: number;
  eY: number;
  length: number;
};

function getBondSegment(
  bond: Bond,
  atoms: Atom[],
  bonds: Bond[],
  documentStyleSettings?: DocumentStyleSettings | null,
): BondSegment | null {
  const fromAtom = atoms.find((atom) => atom.id === bond.from);
  const toAtom = atoms.find((atom) => atom.id === bond.to);
  if (!fromAtom || !toAtom) return null;

  const dx = toAtom.x - fromAtom.x;
  const dy = toAtom.y - fromAtom.y;
  const length = Math.sqrt(dx * dx + dy * dy);
  if (length === 0) return null;

  const ux = dx / length;
  const uy = dy / length;
  const startClip = getAtomBondClipOffset(fromAtom, atoms, bonds, ux, uy, documentStyleSettings);
  const endClip = getAtomBondClipOffset(toAtom, atoms, bonds, -ux, -uy, documentStyleSettings);
  return {
    sX: fromAtom.x + ux * startClip,
    sY: fromAtom.y + uy * startClip,
    eX: toAtom.x - ux * endClip,
    eY: toAtom.y - uy * endClip,
    length: Math.max(1e-6, length - startClip - endClip),
  };
}

function mergeIntervals(intervals: Array<[number, number]>): Array<[number, number]> {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: Array<[number, number]> = [sorted[0]];
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i];
    const previous = merged[merged.length - 1];
    if (current[0] <= previous[1]) previous[1] = Math.max(previous[1], current[1]);
    else merged.push([...current] as [number, number]);
  }
  return merged;
}

export function computeBondVisibleIntervals(
  bond: Bond,
  atoms: Atom[],
  bonds: Bond[],
  resolveLineWidth: (bond: Bond) => number,
  documentStyleSettings?: DocumentStyleSettings | null,
): Array<[number, number]> {
  const bondIndex = bonds.findIndex((entry) => entry.id === bond.id);
  if (bondIndex < 0) return [[0, 1]];

  const targetSegment = getBondSegment(bond, atoms, bonds, documentStyleSettings);
  if (!targetSegment) return [[0, 1]];

  const occlusions: Array<[number, number]> = [];
  const targetDx = targetSegment.eX - targetSegment.sX;
  const targetDy = targetSegment.eY - targetSegment.sY;
  const lowerWidth = resolveLineWidth(bond);

  for (let i = bondIndex + 1; i < bonds.length; i += 1) {
    const upperBond = bonds[i];
    const upperSegment = getBondSegment(upperBond, atoms, bonds, documentStyleSettings);
    if (!upperSegment) continue;

    const upperDx = upperSegment.eX - upperSegment.sX;
    const upperDy = upperSegment.eY - upperSegment.sY;
    const denominator = targetDx * upperDy - targetDy * upperDx;
    if (Math.abs(denominator) < 1e-6) continue;

    const deltaX = upperSegment.sX - targetSegment.sX;
    const deltaY = upperSegment.sY - targetSegment.sY;
    const targetT = (deltaX * upperDy - deltaY * upperDx) / denominator;
    const upperT = (deltaX * targetDy - deltaY * targetDx) / denominator;
    if (targetT <= 0 || targetT >= 1 || upperT <= 0 || upperT >= 1) continue;

    const halfGap = (lowerWidth + resolveLineWidth(upperBond)) * 0.5 + 2.5;
    const targetEdgeDistance = Math.min(targetT, 1 - targetT) * targetSegment.length;
    const upperEdgeDistance = Math.min(upperT, 1 - upperT) * upperSegment.length;
    if (targetEdgeDistance <= halfGap * 1.1 || upperEdgeDistance <= halfGap * 1.1) continue;

    const gapT = Math.min(0.18, halfGap / targetSegment.length);
    occlusions.push([Math.max(0, targetT - gapT), Math.min(1, targetT + gapT)]);
  }

  const mergedOcclusions = mergeIntervals(occlusions);
  if (mergedOcclusions.length === 0) return [[0, 1]];

  const visible: Array<[number, number]> = [];
  let cursor = 0;
  for (const [start, end] of mergedOcclusions) {
    if (start - cursor >= 0.02) visible.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (1 - cursor >= 0.02) visible.push([cursor, 1]);
  return visible.length > 0 ? visible : [];
}
