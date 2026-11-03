import { convertNativeToCanvas } from '../../../lib/chemdrawMetrics';
import { measureRunWidth } from '../../../lib/textRunPresentation';
import type { ChemDrawObjectTag, ChemDrawPoint } from '../../../types/chemdraw';
import type { DocumentSceneState } from '../types';
import { adaptColor, drawRunText } from '../drawPrimitives';

/**
 * Computed stereochemistry indicators (View > Show Stereochemistry): the CIP label beside a
 * stereocentre, on the side clearest of its bonds, and beside a stereo double bond's middle, on
 * the side clearest of its neighbours.
 *
 * Measured on ChemDraw 26.1.0.6801 (gaps.md): the tag is italic at 0.75 x the atom label size,
 * whatever the caption size or bond length, and its box stands about 4.9pt clear of the atom (or
 * the bond's middle), also whatever the bond length. Not modelled: the atom label's choice of the
 * gap nearest straight down (we take the widest) and its drift towards the vertical.
 */
const INDICATOR_SIZE_OF_LABEL = 0.75;
const INDICATOR_CLEARANCE = 4.9;
/** ChemDraw's box for `(R)` is 7.03pt tall at 7.5pt. */
const INDICATOR_BOX_HEIGHT_EM = 0.937;

export function hasStereoTag(tags: ChemDrawObjectTag[] | undefined): boolean {
  return Boolean(tags?.some((tag) => /stereo/i.test(tag.name ?? '')));
}

/** Draws `text` beyond `anchor` along the unit `direction`, its near edge `gap` away. */
function drawIndicator(
  ctx: CanvasRenderingContext2D,
  scene: DocumentSceneState,
  text: string,
  anchor: ChemDrawPoint,
  direction: ChemDrawPoint,
  gap: number,
  color: string,
) {
  const fontFamily = scene.documentStyleSettings.nativeMetrics.captionFontFamily;
  const fontSize = convertNativeToCanvas(
    scene.documentStyleSettings.nativeMetrics.labelSize * INDICATOR_SIZE_OF_LABEL,
    scene.documentStyleSettings,
  );
  const run = { text, italic: true };
  const width = measureRunWidth(run, fontSize, fontFamily);
  const extent =
    gap +
    Math.abs(direction.x) * (width / 2) +
    Math.abs(direction.y) * ((fontSize * INDICATOR_BOX_HEIGHT_EM) / 2);
  const center = { x: anchor.x + direction.x * extent, y: anchor.y + direction.y * extent };
  drawRunText(
    ctx,
    run,
    center.x - width / 2,
    center.y - fontSize * 0.45,
    fontSize,
    fontFamily,
    adaptColor(color, scene.isDarkMode),
  );
}

const angleGap = (a: number, b: number) => {
  const d = Math.abs(((((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
  return d;
};

/**
 * Text beside an atom (its number, its CIP label) on the side clearest of its bonds; `avoid`
 * directions already taken count as bonds. Returns the direction used.
 */
export function drawAtomIndicator(
  ctx: CanvasRenderingContext2D,
  scene: DocumentSceneState,
  atomId: string,
  label: string,
  color: string,
  avoid: readonly number[] = [],
): number | null {
  const atom = scene.legacy.atomById.get(atomId);
  if (!atom) return null;
  const bondAngles = scene.legacy.bonds
    .filter((bond) => bond.from === atomId || bond.to === atomId)
    .map((bond) => scene.legacy.atomById.get(bond.from === atomId ? bond.to : bond.from))
    .filter((other) => other !== undefined)
    .map((other) => Math.atan2(other.y - atom.y, other.x - atom.x))
    .concat(avoid);
  let best = -Math.PI / 2;
  let bestGap = -1;
  for (let i = 0; i < 24; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 12;
    const gap = bondAngles.length
      ? Math.min(...bondAngles.map((b) => angleGap(angle, b)))
      : Math.PI;
    if (gap > bestGap + 1e-9) [best, bestGap] = [angle, gap];
  }
  drawIndicator(
    ctx,
    scene,
    label,
    atom,
    { x: Math.cos(best), y: Math.sin(best) },
    convertNativeToCanvas(INDICATOR_CLEARANCE, scene.documentStyleSettings),
    color,
  );
  return best;
}

export function drawBondStereoIndicator(
  ctx: CanvasRenderingContext2D,
  scene: DocumentSceneState,
  bondId: string,
  color: string,
) {
  const label = scene.stereoLabels?.bonds.get(bondId);
  const bond = scene.legacy.bondById.get(bondId);
  if (!label || !bond) return;
  const a = scene.legacy.atomById.get(bond.from);
  const b = scene.legacy.atomById.get(bond.to);
  if (!a || !b) return;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 1e-9) return;
  const normal = { x: -(b.y - a.y) / length, y: (b.x - a.x) / length };
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  // The side with fewer substituents beside it.
  let lean = 0;
  for (const other of scene.legacy.bonds) {
    if (other.id === bondId) continue;
    for (const end of [bond.from, bond.to]) {
      if (other.from !== end && other.to !== end) continue;
      const far = scene.legacy.atomById.get(other.from === end ? other.to : other.from);
      if (far) lean += Math.sign((far.x - mid.x) * normal.x + (far.y - mid.y) * normal.y);
    }
  }
  // On a tie (an E bond, one substituent each side), ChemDraw uses the same side of the bond
  // whichever way the substituents are mirrored: the left-hand normal of begin-to-end on a y-up
  // page, so a bond drawn left to right puts it above and the reverse puts it below.
  const side = lean !== 0 ? -Math.sign(lean) : -1;
  drawIndicator(
    ctx,
    scene,
    label,
    mid,
    { x: normal.x * side, y: normal.y * side },
    convertNativeToCanvas(INDICATOR_CLEARANCE, scene.documentStyleSettings),
    color,
  );
}
