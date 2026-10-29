import type { ChemDrawGraphic, ChemDrawPoint } from '../types/chemdraw';
import { isAnchorTripleCurve } from './curveGeometry';

/**
 * The Edit Curve tool (ChemDraw 17.1 guide, "Editing Curves"): drag an anchor to move it with its
 * direction lines, drag a direction-line end to reshape, click away to add a segment at the end.
 * Points are indices into the curve's anchor triples: index % 3 === 1 is an anchor, 0 and 2 are
 * its incoming and outgoing controls.
 */

export interface CurveHandle {
  curveId: string;
  index: number;
}

/** The handle of any curve within `tolerance` of `point`, anchors preferred over controls. */
export function findCurveHandle(
  curves: readonly ChemDrawGraphic[],
  point: ChemDrawPoint,
  tolerance: number,
): CurveHandle | null {
  let best: (CurveHandle & { distance: number; anchor: boolean }) | null = null;
  for (const curve of curves) {
    if (curve.graphicType !== 'curve' || !curve.points || !isAnchorTripleCurve(curve.points)) {
      continue;
    }
    curve.points.forEach((candidate, index) => {
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance > tolerance) return;
      const anchor = index % 3 === 1;
      if (
        !best ||
        (anchor && !best.anchor) ||
        (anchor === best.anchor && distance < best.distance)
      ) {
        best = { curveId: curve.id, index, distance, anchor };
      }
    });
  }
  if (!best) return null;
  const { curveId, index } = best;
  return { curveId, index };
}

/**
 * Moves one handle to `point`. An anchor carries its direction lines with it; a direction-line
 * end turns the opposite one to stay collinear (a smooth anchor), keeping that one's length.
 */
export function moveCurveHandle(
  curve: ChemDrawGraphic,
  index: number,
  point: ChemDrawPoint,
): ChemDrawGraphic {
  const points = curve.points ? curve.points.map((p) => ({ ...p })) : [];
  if (index < 0 || index >= points.length) return curve;
  const role = index % 3;
  const anchorIndex = index - role + 1;
  const anchor = points[anchorIndex]!;
  if (role === 1) {
    const dx = point.x - anchor.x;
    const dy = point.y - anchor.y;
    for (const i of [anchorIndex - 1, anchorIndex, anchorIndex + 1]) {
      points[i] = { x: points[i]!.x + dx, y: points[i]!.y + dy };
    }
    return { ...curve, points };
  }
  points[index] = { ...point };
  const oppositeIndex = role === 0 ? anchorIndex + 1 : anchorIndex - 1;
  const opposite = points[oppositeIndex]!;
  const oppositeLength = Math.hypot(opposite.x - anchor.x, opposite.y - anchor.y);
  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const length = Math.hypot(dx, dy);
  if (length > 1e-9 && oppositeLength > 1e-9) {
    points[oppositeIndex] = {
      x: anchor.x - (dx / length) * oppositeLength,
      y: anchor.y - (dy / length) * oppositeLength,
    };
  }
  return { ...curve, points };
}

/**
 * Adds a segment from the curve's last anchor to `point`, leaving the last anchor smooth: its
 * outgoing direction line points a third of the way toward the new anchor, and the new anchor's
 * lines lie along the new segment.
 */
export function appendCurveSegment(curve: ChemDrawGraphic, point: ChemDrawPoint): ChemDrawGraphic {
  const points = curve.points ? curve.points.map((p) => ({ ...p })) : [];
  if (!isAnchorTripleCurve(points)) return curve;
  const last = points[points.length - 2]!;
  const dx = (point.x - last.x) / 3;
  const dy = (point.y - last.y) / 3;
  const incoming = points[points.length - 3]!;
  const incomingLength = Math.hypot(incoming.x - last.x, incoming.y - last.y);
  const outgoingLength = Math.hypot(dx, dy);
  // Keep the old end smooth: its new outgoing line continues its incoming one when it has one.
  points[points.length - 1] =
    incomingLength > 1e-9
      ? {
          x: last.x - ((incoming.x - last.x) / incomingLength) * outgoingLength,
          y: last.y - ((incoming.y - last.y) / incomingLength) * outgoingLength,
        }
      : { x: last.x + dx, y: last.y + dy };
  points.push(
    { x: point.x - dx, y: point.y - dy },
    { ...point },
    { x: point.x + dx, y: point.y + dy },
  );
  return { ...curve, points };
}
