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
