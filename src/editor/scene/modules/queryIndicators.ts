import { convertNativeToCanvas } from '../../../lib/chemdrawMetrics';
import { getFaceMetrics } from '../../../lib/textMetrics';
import { measureRunWidth } from '../../../lib/textRunPresentation';
import type {
  ChemDrawAtomQueryProperties,
  ChemDrawBondRxnParticipation,
  ChemDrawObjectTag,
  ChemDrawPoint,
} from '../../../types/chemdraw';
import type { DocumentSceneState } from '../types';
import { adaptColor, drawRunText } from '../drawPrimitives';

/**
 * Query indicators (ChemDraw draws them when ShowAtomQuery / ShowBondQuery is on, which is the
 * default): a short run of letters beside a query atom or bond. Measured on ChemDraw 26.1.0.6801
 * by setting each property alone and reading back the `<objecttag Name="query">` it wrote
 * (gaps.md): plain text at 0.75 x the atom label size, the properties of one atom joined into a
 * single run in a fixed order, the box 5pt clear of the atom on the side of its widest gap
 * (7pt when that is above), and a bond's tag 5-6pt clear of the bond on its upper side (the
 * right, for a vertical bond).
 */
export function hasQueryTag(tags: ChemDrawObjectTag[] | undefined): boolean {
  return Boolean(tags?.some((tag) => (tag.name ?? '').toLowerCase() === 'query'));
}

const SIZE_OF_LABEL = 0.75;
const CLEARANCE = 5;
const EXTRA_ABOVE = 1.97;
const CAP_HEIGHT_EM = 0.716;

/** The letters ChemDraw prints for an atom's query properties; '' when it prints none. */
export function atomQueryText(query: ChemDrawAtomQueryProperties | undefined): string {
  if (!query) return '';
  let text = '';
  // Free sites replaces the substituent count: both set, ChemDraw printed only the asterisk.
  if (query.freeSites != null) text += '*';
  else if (query.substituentsExactly != null) text += `X${query.substituentsExactly}`;
  else if (query.substituentsUpTo != null) text += `U${query.substituentsUpTo}`;
  if (query.implicitHydrogens) text += 'H';
  if (query.unsaturatedBonds) text += 'S';
  if (query.ringBondCount && query.ringBondCount !== 'AsDrawn') text += 'R';
  if (query.rxnChange) text += 'C';
  if (query.rxnStereo) text += 'T';
  return text;
}

/** A bond's query text: its ring/chain topology, else `Rxn` for a reaction participation. */
export function bondQueryText(
  ringState: 'ring' | 'chain' | 'either' | undefined,
  rxnParticipation: ChemDrawBondRxnParticipation | undefined,
): string {
  if (ringState === 'ring') return 'Rng';
  if (ringState === 'chain') return 'Chn';
  if (ringState === 'either') return 'R/C';
  return rxnParticipation ? 'Rxn' : '';
}

const angleGap = (a: number, b: number) =>
  Math.abs(((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);

function drawTag(
  ctx: CanvasRenderingContext2D,
  scene: DocumentSceneState,
  text: string,
  anchor: ChemDrawPoint,
  direction: ChemDrawPoint,
  color: string,
) {
  const style = scene.documentStyleSettings;
  const fontFamily = style.nativeMetrics.captionFontFamily;
  const fontSize = convertNativeToCanvas(style.nativeMetrics.labelSize * SIZE_OF_LABEL, style);
  const run = { text };
  const width = measureRunWidth(run, fontSize, fontFamily);
  const capHeight = fontSize * CAP_HEIGHT_EM;
  const clear = convertNativeToCanvas(CLEARANCE + EXTRA_ABOVE * Math.max(0, -direction.y), style);
  const extent =
    clear + Math.abs(direction.x) * (width / 2) + Math.abs(direction.y) * (capHeight / 2);
  const centre = { x: anchor.x + direction.x * extent, y: anchor.y + direction.y * extent };
  const ascent = getFaceMetrics({ family: fontFamily, sizePx: fontSize }).ascent;
  drawRunText(
    ctx,
    run,
    centre.x - width / 2,
    centre.y + capHeight / 2 - ascent,
    fontSize,
    fontFamily,
    adaptColor(color, scene.isDarkMode),
  );
}

/** The atom's query letters beside it, on the side of its widest gap between bonds. */
export function drawAtomQueryIndicator(
  ctx: CanvasRenderingContext2D,
  scene: DocumentSceneState,
  atomId: string,
  query: ChemDrawAtomQueryProperties | undefined,
  color: string,
) {
  const text = atomQueryText(query);
  const atom = scene.legacy.atomById.get(atomId);
  if (!text || !atom) return;
  const bondAngles = scene.legacy.bonds
    .filter((bond) => bond.from === atomId || bond.to === atomId)
    .map((bond) => scene.legacy.atomById.get(bond.from === atomId ? bond.to : bond.from))
    .filter((other) => other !== undefined)
    .map((other) => Math.atan2(other.y - atom.y, other.x - atom.x));
  let best = -Math.PI / 2;
  let bestGap = -1;
  for (let i = 0; i < 72; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 36;
    const gap = bondAngles.length
      ? Math.min(...bondAngles.map((b) => angleGap(angle, b)))
      : Math.PI;
    if (gap > bestGap + 1e-9) [best, bestGap] = [angle, gap];
  }
  drawTag(ctx, scene, text, atom, { x: Math.cos(best), y: Math.sin(best) }, color);
}

/** The bond's query text beside its middle, on its upper side (right of a vertical bond). */
export function drawBondQueryIndicator(
  ctx: CanvasRenderingContext2D,
  scene: DocumentSceneState,
  bondId: string,
  ringState: 'ring' | 'chain' | 'either' | undefined,
  rxnParticipation: ChemDrawBondRxnParticipation | undefined,
  color: string,
) {
  const text = bondQueryText(ringState, rxnParticipation);
  const bond = scene.legacy.bondById.get(bondId);
  if (!text || !bond) return;
  const a = scene.legacy.atomById.get(bond.from);
  const b = scene.legacy.atomById.get(bond.to);
  if (!a || !b) return;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1e-9) return;
  let normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  if (normal.y > 1e-6 || (Math.abs(normal.y) <= 1e-6 && normal.x < 0)) {
    normal = { x: -normal.x, y: -normal.y };
  }
  drawTag(ctx, scene, text, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, normal, color);
}
