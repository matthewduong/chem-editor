import { SNAP_ANGLE } from './graph';
import type {
  ChemDrawArrow,
  ChemDrawGraphic,
  ChemDrawObject,
  ChemDrawPoint,
} from '../types/chemdraw';

/** The drawing-element shapes the Drawing palette offers (ChemDraw 17.1 guide, ch. 6). */
export type BoxShapeKind = 'rectangle' | 'rounded-rectangle' | 'oval' | 'circle';

export type LineShapeKind = 'line' | 'dashed-line' | 'bold-line';
export type ArcShapeKind = 'arc-90' | 'arc-120' | 'arc-180' | 'arc-270';

/** Every kind the shape tool draws. */
export type ShapeKind = BoxShapeKind | LineShapeKind | ArcShapeKind;

export const ARC_DEGREES: Record<ArcShapeKind, number> = {
  'arc-90': 90,
  'arc-120': 120,
  'arc-180': 180,
  'arc-270': 270,
};

function isBoxKind(kind: ShapeKind): kind is BoxShapeKind {
  return (
    kind === 'rectangle' || kind === 'rounded-rectangle' || kind === 'oval' || kind === 'circle'
  );
}

/** Below this many canvas px in both directions a press is a click, not a shape. */
export const MIN_SHAPE_SIZE = 4;

/**
 * Geometry of a box shape dragged from `start` to `pointer`.
 *
 * Rectangles span the drag corner to corner; ovals and circles grow outward from where the drag
 * began, as the guide describes ("point where you want the center ... drag outward"). With
 * `constrain` (Shift) a rectangle becomes a square and an oval a circle.
 */
export function boxShapeGeometry(
  kind: BoxShapeKind,
  start: ChemDrawPoint,
  pointer: ChemDrawPoint,
  constrain = false,
): { center: ChemDrawPoint; halfWidth: number; halfHeight: number } {
  let dx = pointer.x - start.x;
  let dy = pointer.y - start.y;
  if (kind === 'circle') {
    const radius = Math.hypot(dx, dy);
    return { center: start, halfWidth: radius, halfHeight: radius };
  }
  if (constrain) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  if (kind === 'oval') {
    return { center: start, halfWidth: Math.abs(dx), halfHeight: Math.abs(dy) };
  }
  return {
    center: { x: start.x + dx / 2, y: start.y + dy / 2 },
    halfWidth: Math.abs(dx) / 2,
    halfHeight: Math.abs(dy) / 2,
  };
}

export function isShapeBigEnough(geometry: { halfWidth: number; halfHeight: number }): boolean {
  return Math.max(geometry.halfWidth, geometry.halfHeight) * 2 >= MIN_SHAPE_SIZE;
}

/**
 * A rectangle or oval graphic in the form ChemDraw writes: BoundingBox plus Center3D and axis
 * ends (major along x, minor along y), and the RectangleType / OvalType word for the variant.
 * Created objects are editable, unlike imported ones whose unknown attributes must survive.
 */
export function createBoxShapeGraphic(
  id: string,
  kind: BoxShapeKind,
  geometry: { center: ChemDrawPoint; halfWidth: number; halfHeight: number },
): ChemDrawGraphic {
  const { center, halfWidth, halfHeight } = geometry;
  const isOval = kind === 'oval' || kind === 'circle';
  return {
    id,
    type: 'graphic',
    graphicType: isOval
      ? 'ellipse'
      : kind === 'rounded-rectangle'
        ? 'rounded-rectangle'
        : 'rectangle',
    bounds: {
      left: center.x - halfWidth,
      top: center.y - halfHeight,
      right: center.x + halfWidth,
      bottom: center.y + halfHeight,
    },
    center: { ...center },
    majorAxisEnd: { x: center.x + halfWidth, y: center.y },
    minorAxisEnd: { x: center.x, y: center.y + halfHeight },
    ...(kind === 'rounded-rectangle' ? { rectangleType: 'RoundEdge' } : {}),
    ...(kind === 'circle' ? { ovalType: 'Circle' } : {}),
    preservation: { capability: 'editable' },
  };
}

/** A line's end, snapped to 15 degree steps like a bond or arrow unless `free`. */
export function lineEnd(start: ChemDrawPoint, pointer: ChemDrawPoint, free = false): ChemDrawPoint {
  const length = Math.hypot(pointer.x - start.x, pointer.y - start.y);
  if (free || length === 0) return { ...pointer };
  const angle =
    Math.round(Math.atan2(pointer.y - start.y, pointer.x - start.x) / SNAP_ANGLE) * SNAP_ANGLE;
  return { x: start.x + Math.cos(angle) * length, y: start.y + Math.sin(angle) * length };
}

/**
 * A line as ChemDraw stores one: an arrow with no heads (ChemDraw rewrites the old GraphicType
 * "Line" this way on every save). Dashed and bold lines carry LineType.
 */
export function createLineArrow(
  id: string,
  kind: LineShapeKind,
  tail: ChemDrawPoint,
  head: ChemDrawPoint,
): ChemDrawArrow {
  return {
    id,
    type: 'arrow',
    arrowType: 'reaction',
    tail: { ...tail },
    head: { ...head },
    controlPoint: { x: (tail.x + head.x) / 2, y: (tail.y + head.y) / 2 },
    headEnd: 'none',
    tailEnd: 'none',
    style:
      kind === 'dashed-line'
        ? { lineType: 'dashed' }
        : kind === 'bold-line'
          ? { lineType: 'bold' }
          : {},
    preservation: { capability: 'editable' },
  };
}

/**
 * A circular arc through `tail` and `head` sweeping `degrees`, as ChemDraw's arc tool writes it:
 * a headless arrow with Center3D, perpendicular radius vectors for the axis ends, and a signed
 * AngularSize. It bulges to the left of the drag direction, so dragging left to right gives a
 * convex arc and right to left a concave one (ChemDraw 17.1 guide, "Arcs"); a ChemDraw arc
 * bulging that way carries a negative AngularSize (arrow 80166 in its templates).
 */
export function createArcArrow(
  id: string,
  degrees: number,
  tail: ChemDrawPoint,
  head: ChemDrawPoint,
): ChemDrawArrow {
  const chord = Math.hypot(head.x - tail.x, head.y - tail.y);
  const theta = (degrees * Math.PI) / 180;
  const radius = chord / (2 * Math.sin(theta / 2));
  const ux = (head.x - tail.x) / chord;
  const uy = (head.y - tail.y) / chord;
  // Left of the direction of travel on a y-down page.
  const left = { x: uy, y: -ux };
  const offset = radius * Math.cos(theta / 2);
  const mid = { x: (tail.x + head.x) / 2, y: (tail.y + head.y) / 2 };
  const center = { x: mid.x - left.x * offset, y: mid.y - left.y * offset };
  const bulge = { x: center.x + left.x * radius, y: center.y + left.y * radius };
  return {
    id,
    type: 'arrow',
    arrowType: 'curved',
    tail: { ...tail },
    head: { ...head },
    controlPoint: { x: 2 * bulge.x - mid.x, y: 2 * bulge.y - mid.y },
    arcCenter: center,
    majorAxisEnd: { x: center.x + radius, y: center.y },
    minorAxisEnd: { x: center.x, y: center.y + radius },
    angularSize: -degrees,
    headEnd: 'none',
    tailEnd: 'none',
    preservation: { capability: 'editable' },
  };
}

/**
 * The object a shape-tool drag from `start` to `pointer` draws, and whether the drag was long
 * enough to count. `constrain` is Shift: square/round for boxes, free angle for lines.
 */
export function shapeForDrag(
  kind: ShapeKind,
  id: string,
  start: ChemDrawPoint,
  pointer: ChemDrawPoint,
  constrain = false,
): { object: ChemDrawObject; bigEnough: boolean } {
  if (isBoxKind(kind)) {
    const geometry = boxShapeGeometry(kind, start, pointer, constrain);
    return {
      object: createBoxShapeGraphic(id, kind, geometry),
      bigEnough: isShapeBigEnough(geometry),
    };
  }
  const end = lineEnd(start, pointer, constrain);
  const length = Math.hypot(end.x - start.x, end.y - start.y);
  const bigEnough = length >= MIN_SHAPE_SIZE;
  if (kind in ARC_DEGREES) {
    const degrees = ARC_DEGREES[kind as ArcShapeKind];
    // A degenerate chord has no circle; draw the arc only once the drag is real.
    return {
      object: bigEnough
        ? createArcArrow(id, degrees, start, end)
        : createLineArrow(id, 'line', start, end),
      bigEnough,
    };
  }
  return { object: createLineArrow(id, kind as LineShapeKind, start, end), bigEnough };
}
