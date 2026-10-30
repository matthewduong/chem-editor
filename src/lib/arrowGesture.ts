import type { Arrow } from '../types/chemistry';
import { SNAP_ANGLE } from './graph';
import { getDefaultArrowControlPoint } from './renderGeometry';

/** An arrow drag shorter than this (document units) is a click and creates nothing. */
export const MIN_ARROW_LENGTH = 10;

const isCurved = (type: Arrow['type']) => type === 'curved' || type === 'half-curved';

/**
 * Where a dragged arrow ends. Straight arrows snap their direction to 15 degrees; curved
 * arrows follow the pointer and derive a control point from it.
 */
export function arrowDragGeometry(
  type: Arrow['type'],
  start: { x: number; y: number },
  pointer: { x: number; y: number },
): Pick<Arrow, 'x2' | 'y2' | 'cpx' | 'cpy'> {
  const { x: x1, y: y1 } = start;
  const dist = Math.hypot(pointer.x - x1, pointer.y - y1);
  let x2 = pointer.x;
  let y2 = pointer.y;
  if (!isCurved(type)) {
    const snapped =
      Math.round(Math.atan2(pointer.y - y1, pointer.x - x1) / SNAP_ANGLE) * SNAP_ANGLE;
    x2 = x1 + Math.cos(snapped) * dist;
    y2 = y1 + Math.sin(snapped) * dist;
  }
  let cpx = (x1 + x2) / 2;
  let cpy = (y1 + y2) / 2;
  if (isCurved(type) && dist > 1) {
    const control = getDefaultArrowControlPoint(x1, y1, pointer.x, pointer.y);
    cpx = control.cpx;
    cpy = control.cpy;
  }
  return { x2, y2, cpx, cpy };
}

export function isArrowLongEnough(arrow: Pick<Arrow, 'x1' | 'y1' | 'x2' | 'y2'>): boolean {
  return Math.hypot(arrow.x2 - arrow.x1, arrow.y2 - arrow.y1) > MIN_ARROW_LENGTH;
}

/**
 * Connecting arrows (ChemDraw 17.1 guide, "Connecting Arrows"): with Shift held over an existing
 * arrow's tail, head or midpoint, a new arrow starts exactly there. The midpoint of a curved
 * arrow is its curve's, not its chord's.
 */
export function arrowConnectionPoint(
  point: { x: number; y: number },
  arrows: readonly Pick<Arrow, 'type' | 'x1' | 'y1' | 'x2' | 'y2' | 'cpx' | 'cpy'>[],
  tolerance: number,
): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestDistance = tolerance;
  for (const arrow of arrows) {
    // A straight arrow's control point is not meaningful; only a curve's is.
    const mid =
      isCurved(arrow.type) && arrow.cpx != null && arrow.cpy != null
        ? {
            x: 0.25 * arrow.x1 + 0.5 * arrow.cpx + 0.25 * arrow.x2,
            y: 0.25 * arrow.y1 + 0.5 * arrow.cpy + 0.25 * arrow.y2,
          }
        : { x: (arrow.x1 + arrow.x2) / 2, y: (arrow.y1 + arrow.y2) / 2 };
    for (const candidate of [{ x: arrow.x1, y: arrow.y1 }, { x: arrow.x2, y: arrow.y2 }, mid]) {
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance <= bestDistance) {
        best = candidate;
        bestDistance = distance;
      }
    }
  }
  return best;
}
