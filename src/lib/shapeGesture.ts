import type { ChemDrawGraphic, ChemDrawPoint } from '../types/chemdraw';

/** The drawing-element shapes the Drawing palette offers (ChemDraw 17.1 guide, ch. 6). */
export type BoxShapeKind = 'rectangle' | 'rounded-rectangle' | 'oval' | 'circle';

/** Every kind the shape tool draws. */
export type ShapeKind = BoxShapeKind;

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
