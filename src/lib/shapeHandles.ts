import type {
  ChemDrawArrow,
  ChemDrawGraphic,
  ChemDrawObject,
  ChemDrawPoint,
} from '../types/chemdraw';
import { createArcArrow } from './shapeGesture';
import { resolveArcArrow, arcPointAt } from './arrowArc';

/**
 * Reshape handles for drawn shapes (ChemDraw 17.1 guide, "Resizing and Rotating" and "Editing
 * Arcs"): rectangles and ovals stretch along each axis from the middle of a side, rectangle
 * corners scale both axes in proportion, a circle has one radius handle, and an arc moves by its
 * ends and changes curvature by its middle. Handles work in the shape's own axes, so a rotated
 * shape stretches along its sides.
 */

export type ShapeHandleId =
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw'
  | 'radius'
  | 'tail'
  | 'head'
  | 'mid';

export interface ShapeHandle {
  id: ShapeHandleId;
  x: number;
  y: number;
}

interface Frame {
  center: ChemDrawPoint;
  u: ChemDrawPoint;
  v: ChemDrawPoint;
  halfWidth: number;
  halfHeight: number;
}

function boxFrame(object: ChemDrawGraphic): Frame | null {
  if (object.center && object.majorAxisEnd && object.minorAxisEnd) {
    const a = {
      x: object.majorAxisEnd.x - object.center.x,
      y: object.majorAxisEnd.y - object.center.y,
    };
    const b = {
      x: object.minorAxisEnd.x - object.center.x,
      y: object.minorAxisEnd.y - object.center.y,
    };
    const halfWidth = Math.hypot(a.x, a.y);
    const halfHeight = Math.hypot(b.x, b.y);
    if (halfWidth < 1e-9 || halfHeight < 1e-9) return null;
    return {
      center: object.center,
      u: { x: a.x / halfWidth, y: a.y / halfWidth },
      v: { x: b.x / halfHeight, y: b.y / halfHeight },
      halfWidth,
      halfHeight,
    };
  }
  if (!object.bounds) return null;
  const b = object.bounds;
  return {
    center: { x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 },
    u: { x: 1, y: 0 },
    v: { x: 0, y: 1 },
    halfWidth: (b.right - b.left) / 2,
    halfHeight: (b.bottom - b.top) / 2,
  };
}

const at = (frame: Frame, s: number, t: number): ChemDrawPoint => ({
  x: frame.center.x + frame.u.x * s * frame.halfWidth + frame.v.x * t * frame.halfHeight,
  y: frame.center.y + frame.u.y * s * frame.halfWidth + frame.v.y * t * frame.halfHeight,
});

const isBox = (object: ChemDrawObject): object is ChemDrawGraphic =>
  object.type === 'graphic' &&
  (object.graphicType === 'rectangle' ||
    object.graphicType === 'rounded-rectangle' ||
    object.graphicType === 'ellipse');

const isCircle = (object: ChemDrawGraphic) =>
  object.graphicType === 'ellipse' && /\bcircle\b/i.test(object.ovalType ?? '');

const isArc = (object: ChemDrawObject): object is ChemDrawArrow =>
  object.type === 'arrow' && resolveArcArrow(object) !== null;

/** Whether `object` has reshape handles; render-only imported content never does. */
export function hasShapeHandles(object: ChemDrawObject): boolean {
  if (object.preservation?.capability === 'render-only') return false;
  return (isBox(object) && boxFrame(object) !== null) || isArc(object);
}

export function getShapeHandles(object: ChemDrawObject): ShapeHandle[] {
  if (!hasShapeHandles(object)) return [];
  if (isArc(object)) {
    const arc = resolveArcArrow(object)!;
    const mid = arcPointAt(arc, 0.5);
    return [
      { id: 'tail', ...object.tail },
      { id: 'head', ...object.head },
      { id: 'mid', ...mid },
    ];
  }
  const graphic = object as ChemDrawGraphic;
  const frame = boxFrame(graphic)!;
  if (isCircle(graphic)) return [{ id: 'radius', ...at(frame, 1, 0) }];
  const sides: ShapeHandle[] = [
    { id: 'e', ...at(frame, 1, 0) },
    { id: 'w', ...at(frame, -1, 0) },
    { id: 's', ...at(frame, 0, 1) },
    { id: 'n', ...at(frame, 0, -1) },
  ];
  if (graphic.graphicType === 'ellipse') return sides;
  return [
    ...sides,
    { id: 'se', ...at(frame, 1, 1) },
    { id: 'ne', ...at(frame, 1, -1) },
    { id: 'sw', ...at(frame, -1, 1) },
    { id: 'nw', ...at(frame, -1, -1) },
  ];
}

function withFrame(graphic: ChemDrawGraphic, frame: Frame): ChemDrawGraphic {
  const corners = [at(frame, 1, 1), at(frame, 1, -1), at(frame, -1, 1), at(frame, -1, -1)];
  return {
    ...graphic,
    center: { ...frame.center },
    majorAxisEnd: at(frame, 1, 0),
    minorAxisEnd: at(frame, 0, 1),
    bounds: {
      left: Math.min(...corners.map((p) => p.x)),
      top: Math.min(...corners.map((p) => p.y)),
      right: Math.max(...corners.map((p) => p.x)),
      bottom: Math.max(...corners.map((p) => p.y)),
    },
  };
}

const MIN_HALF = 1;

/** The shape with handle `id` dragged to `point`. */
export function applyShapeHandle(
  object: ChemDrawObject,
  id: ShapeHandleId,
  point: ChemDrawPoint,
): ChemDrawObject {
  if (isArc(object)) return applyArcHandle(object, id, point);
  if (!isBox(object)) return object;
  const frame = boxFrame(object);
  if (!frame) return object;
  const local = {
    s: (point.x - frame.center.x) * frame.u.x + (point.y - frame.center.y) * frame.u.y,
    t: (point.x - frame.center.x) * frame.v.x + (point.y - frame.center.y) * frame.v.y,
  };
  if (id === 'radius') {
    const radius = Math.max(
      MIN_HALF,
      Math.hypot(point.x - frame.center.x, point.y - frame.center.y),
    );
    return withFrame(object, { ...frame, halfWidth: radius, halfHeight: radius });
  }
  // Each side handle moves its own side; the opposite side stays where it was.
  let left = -frame.halfWidth;
  let right = frame.halfWidth;
  let top = -frame.halfHeight;
  let bottom = frame.halfHeight;
  if (id.length === 2) {
    // Corners scale both axes together about the opposite corner.
    const sx = id.includes('e') ? 1 : -1;
    const sy = id.includes('s') ? 1 : -1;
    const opposite = { s: -sx * frame.halfWidth, t: -sy * frame.halfHeight };
    const diagonal = { s: 2 * sx * frame.halfWidth, t: 2 * sy * frame.halfHeight };
    const factor = Math.max(
      (2 * MIN_HALF) / Math.hypot(diagonal.s, diagonal.t),
      ((local.s - opposite.s) * diagonal.s + (local.t - opposite.t) * diagonal.t) /
        (diagonal.s ** 2 + diagonal.t ** 2),
    );
    const far = { s: opposite.s + diagonal.s * factor, t: opposite.t + diagonal.t * factor };
    [left, right] = [Math.min(opposite.s, far.s), Math.max(opposite.s, far.s)];
    [top, bottom] = [Math.min(opposite.t, far.t), Math.max(opposite.t, far.t)];
  } else if (id === 'e') right = Math.max(left + 2 * MIN_HALF, local.s);
  else if (id === 'w') left = Math.min(right - 2 * MIN_HALF, local.s);
  else if (id === 's') bottom = Math.max(top + 2 * MIN_HALF, local.t);
  else if (id === 'n') top = Math.min(bottom - 2 * MIN_HALF, local.t);
  const mid = { s: (left + right) / 2, t: (top + bottom) / 2 };
  return withFrame(object, {
    ...frame,
    center: {
      x: frame.center.x + frame.u.x * mid.s + frame.v.x * mid.t,
      y: frame.center.y + frame.u.y * mid.s + frame.v.y * mid.t,
    },
    halfWidth: (right - left) / 2,
    halfHeight: (bottom - top) / 2,
  });
}

function applyArcHandle(
  arrow: ChemDrawArrow,
  id: ShapeHandleId,
  point: ChemDrawPoint,
): ChemDrawArrow {
  const degrees = Math.abs(arrow.angularSize ?? 90);
  const bulgeRight = (arrow.angularSize ?? -1) > 0;
  const keep = (next: ChemDrawArrow): ChemDrawArrow => ({
    ...arrow,
    tail: next.tail,
    head: next.head,
    controlPoint: next.controlPoint,
    arcCenter: next.arcCenter,
    majorAxisEnd: next.majorAxisEnd,
    minorAxisEnd: next.minorAxisEnd,
    angularSize: next.angularSize,
  });
  if (id === 'tail' || id === 'head') {
    const tail = id === 'tail' ? point : arrow.tail;
    const head = id === 'head' ? point : arrow.head;
    if (Math.hypot(head.x - tail.x, head.y - tail.y) < 2) return arrow;
    return keep(createArcArrow(arrow.id, degrees, tail, head, bulgeRight));
  }
  if (id !== 'mid') return arrow;
  // The arc through both ends and the dragged middle: its sweep is twice the angle the chord
  // subtends from the middle's side, and it bulges on that side.
  const { tail, head } = arrow;
  const chord = { x: head.x - tail.x, y: head.y - tail.y };
  const length = Math.hypot(chord.x, chord.y);
  if (length < 2) return arrow;
  const leftNormal = { x: chord.y / length, y: -chord.x / length };
  const midChord = { x: (tail.x + head.x) / 2, y: (tail.y + head.y) / 2 };
  const sagitta = (point.x - midChord.x) * leftNormal.x + (point.y - midChord.y) * leftNormal.y;
  if (Math.abs(sagitta) < 0.5) return arrow;
  const sweep = 4 * Math.atan2(Math.abs(sagitta), length / 2);
  const sweepDegrees = Math.min(350, Math.max(5, (sweep * 180) / Math.PI));
  return keep(createArcArrow(arrow.id, sweepDegrees, tail, head, sagitta < 0));
}
