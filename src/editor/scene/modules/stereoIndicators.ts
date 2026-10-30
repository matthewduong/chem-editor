import { convertNativeToCanvas } from '../../../lib/chemdrawMetrics';
import { measureRunWidth } from '../../../lib/textRunPresentation';
import type { ChemDrawObjectTag, ChemDrawPoint } from '../../../types/chemdraw';
import type { DocumentSceneState } from '../types';
import { adaptColor, drawRunText } from '../drawPrimitives';

/**
 * Computed stereochemistry indicators (View > Show Stereochemistry): the CIP label beside a
 * stereocentre, on the side clearest of its bonds, and beside a stereo double bond's middle, on
 * the side clearest of its neighbours. Caption font, as ChemDraw's own indicator tags default
 * to; the exact offset ChemDraw uses is not measured (gaps.md).
 */
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
    scene.documentStyleSettings.nativeMetrics.captionSize,
    scene.documentStyleSettings,
  );
  const run = { text };
  const width = measureRunWidth(run, fontSize, fontFamily);
  const extent = gap + Math.abs(direction.x) * (width / 2) + Math.abs(direction.y) * (fontSize / 2);
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

export function drawAtomStereoIndicator(
  ctx: CanvasRenderingContext2D,
  scene: DocumentSceneState,
  atomId: string,
  color: string,
) {
  const label = scene.stereoLabels?.atoms.get(atomId);
  const atom = scene.legacy.atomById.get(atomId);
  if (!label || !atom) return;
  const bondAngles = scene.legacy.bonds
    .filter((bond) => bond.from === atomId || bond.to === atomId)
    .map((bond) => scene.legacy.atomById.get(bond.from === atomId ? bond.to : bond.from))
    .filter((other) => other !== undefined)
    .map((other) => Math.atan2(other.y - atom.y, other.x - atom.x));
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
    scene.documentStyleSettings.bondLength * 0.35,
    color,
  );
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
  // On a tie, above the bond (the page's upper side).
  const side = lean !== 0 ? -Math.sign(lean) : normal.y <= 0 ? 1 : -1;
  drawIndicator(
    ctx,
    scene,
    label,
    mid,
    { x: normal.x * side, y: normal.y * side },
    scene.documentStyleSettings.bondLength * 0.3,
    color,
  );
}
