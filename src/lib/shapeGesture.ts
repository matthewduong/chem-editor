import { createFreehandCurve } from './curveGesture';
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
export type BracketStyle = 'Square' | 'Round' | 'Curly';
/** A single bracket drawn end to end in any orientation. */
export type BracketShapeKind = 'bracket-square' | 'bracket-round' | 'bracket-curly';
/** A facing pair placed by dragging a box; drawn upright, as in ChemDraw. */
export type BracketPairShapeKind = 'pair-square' | 'pair-round' | 'pair-curly';
/** Placed with a click. */
export type SymbolShapeKind =
  | 'dagger'
  | 'double-dagger'
  /** Stereochemical flags (ChemDraw 17.1 guide, "Stereochemical Flags"). */
  | 'flag-absolute'
  | 'flag-relative'
  | 'flag-racemic';

const SYMBOL_TYPE: Record<SymbolShapeKind, string> = {
  dagger: 'Dagger',
  'double-dagger': 'DoubleDagger',
  'flag-absolute': 'Absolute',
  'flag-relative': 'Relative',
  'flag-racemic': 'Racemic',
};
/** The pen: a freehand drag fitted with Bezier curves (`curveGesture.ts`), and its editor. */
export type CurveShapeKind = 'curve' | 'edit-curve';
/** Orbitals: dragged out from the nucleus (or placed with a click), `orbitalGeometry.ts`. */
export type OrbitalShapeKind =
  | 'orbital-s'
  | 'orbital-p'
  | 'orbital-lobe'
  | 'orbital-hybrid'
  | 'orbital-dz2'
  | 'orbital-dxy'
  | 'orbital-oval';

/** The OrbitalType each orbital tool writes: shaded, the ChemDraw palette's usual look. */
export const ORBITAL_TYPE: Record<OrbitalShapeKind, string> = {
  'orbital-s': 'sShaded',
  'orbital-p': 'pShaded',
  'orbital-lobe': 'lobeShaded',
  'orbital-hybrid': 'hybridPlusShaded',
  'orbital-dz2': 'dz2PlusShaded',
  'orbital-dxy': 'dxyPlusShaded',
  'orbital-oval': 'ovalShaded',
};

export function isOrbitalShape(kind: ShapeKind): kind is OrbitalShapeKind {
  return kind.startsWith('orbital-');
}

/**
 * An orbital with its nucleus at `node` and the lobe it was dragged out to ending at `tip`, written
 * as ChemDraw writes one: an s orbital by Center3D and axes, the others by a nucleus-to-tip
 * BoundingBox.
 */
export function createOrbitalGraphic(
  id: string,
  kind: OrbitalShapeKind,
  node: ChemDrawPoint,
  tip: ChemDrawPoint,
): ChemDrawGraphic {
  const base = {
    id,
    type: 'graphic' as const,
    graphicType: 'orbital' as const,
    orbitalType: ORBITAL_TYPE[kind],
    preservation: { capability: 'editable' as const },
  };
  if (kind === 'orbital-s') {
    const radius = Math.hypot(tip.x - node.x, tip.y - node.y);
    return {
      ...base,
      ovalType: 'Circle Shaded',
      center: { ...node },
      majorAxisEnd: { x: node.x + radius, y: node.y },
      minorAxisEnd: { x: node.x, y: node.y + radius },
      bounds: {
        left: node.x - radius,
        top: node.y - radius,
        right: node.x + radius,
        bottom: node.y + radius,
      },
    };
  }
  return { ...base, points: [{ ...node }, { ...tip }] };
}

/** Every kind the shape tool draws. */
export type ShapeKind =
  | BoxShapeKind
  | LineShapeKind
  | ArcShapeKind
  | BracketShapeKind
  | BracketPairShapeKind
  | SymbolShapeKind
  | CurveShapeKind
  | OrbitalShapeKind;

const BRACKET_STYLE: Record<BracketShapeKind | BracketPairShapeKind, BracketStyle> = {
  'bracket-square': 'Square',
  'bracket-round': 'Round',
  'bracket-curly': 'Curly',
  'pair-square': 'Square',
  'pair-round': 'Round',
  'pair-curly': 'Curly',
};

export function isClickPlacedShape(kind: ShapeKind): kind is SymbolShapeKind {
  return kind in SYMBOL_TYPE;
}

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
  bulgeRight = false,
): ChemDrawArrow {
  const chord = Math.hypot(head.x - tail.x, head.y - tail.y);
  const theta = (degrees * Math.PI) / 180;
  const radius = chord / (2 * Math.sin(theta / 2));
  const ux = (head.x - tail.x) / chord;
  const uy = (head.y - tail.y) / chord;
  // Left of the direction of travel on a y-down page (or right, for the other bulge).
  const left = bulgeRight ? { x: -uy, y: ux } : { x: uy, y: -ux };
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
    angularSize: bulgeRight ? degrees : -degrees,
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
  options: { symbolSize?: number; orbitalSize?: number } = {},
): { object: ChemDrawObject; bigEnough: boolean; extra?: ChemDrawObject[] } {
  if (isOrbitalShape(kind)) {
    // A click places a default-sized orbital pointing up; a drag sets its axis and length.
    const dragged = Math.hypot(pointer.x - start.x, pointer.y - start.y) >= MIN_SHAPE_SIZE;
    const tip = dragged
      ? lineEnd(start, pointer, constrain)
      : { x: start.x, y: start.y - (options.orbitalSize ?? 10) };
    return { object: createOrbitalGraphic(id, kind, start, tip), bigEnough: true };
  }
  if (kind === 'curve' || kind === 'edit-curve') {
    // The pen fits the whole pointer path (`useShapeTool`); from two points it is a straight curve.
    const curve = createFreehandCurve(id, [start, pointer]);
    return curve
      ? { object: curve, bigEnough: true }
      : { object: createLineArrow(id, 'line', start, pointer), bigEnough: false };
  }
  if (isClickPlacedShape(kind)) {
    return {
      object: createSymbolGraphic(id, SYMBOL_TYPE[kind], start, options.symbolSize ?? 7.2),
      bigEnough: true,
    };
  }
  if (kind.startsWith('pair-')) {
    const geometry = boxShapeGeometry('rectangle', start, pointer, constrain);
    const [left, right] = createBracketPair(
      id,
      BRACKET_STYLE[kind as BracketPairShapeKind],
      boundsOf(geometry),
    );
    return { object: left, extra: [right], bigEnough: isShapeBigEnough(geometry) };
  }
  if (kind.startsWith('bracket-')) {
    const end = lineEnd(start, pointer, constrain);
    return {
      object: createBracketGraphic(id, BRACKET_STYLE[kind as BracketShapeKind], start, end),
      bigEnough: Math.hypot(end.x - start.x, end.y - start.y) >= MIN_SHAPE_SIZE,
    };
  }
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

function boundsOf(geometry: { center: ChemDrawPoint; halfWidth: number; halfHeight: number }) {
  return {
    left: geometry.center.x - geometry.halfWidth,
    top: geometry.center.y - geometry.halfHeight,
    right: geometry.center.x + geometry.halfWidth,
    bottom: geometry.center.y + geometry.halfHeight,
  };
}

/**
 * A single bracket from `start` to `end`, as ChemDraw writes one: a Bracket graphic whose
 * BoundingBox is its two ends, with the lips on the right of that direction (the pair in
 * ChemDraw's templates runs bottom-to-top on the left and top-to-bottom on the right, lips
 * inward). LipSize 60 is ChemDraw's default.
 */
export function createBracketGraphic(
  id: string,
  style: BracketStyle,
  start: ChemDrawPoint,
  end: ChemDrawPoint,
): ChemDrawGraphic {
  return {
    id,
    type: 'graphic',
    graphicType: 'bracket',
    points: [{ ...start }, { ...end }],
    bracketType: style,
    lipSize: 10,
    preservation: { capability: 'editable' },
  };
}

/** A facing pair enclosing `bounds`, lips inward: the left one first. */
export function createBracketPair(
  id: string,
  style: BracketStyle,
  bounds: { left: number; top: number; right: number; bottom: number },
): [ChemDrawGraphic, ChemDrawGraphic] {
  return [
    createBracketGraphic(
      id,
      style,
      { x: bounds.left, y: bounds.bottom },
      { x: bounds.left, y: bounds.top },
    ),
    createBracketGraphic(
      `${id}-r`,
      style,
      { x: bounds.right, y: bounds.top },
      { x: bounds.right, y: bounds.bottom },
    ),
  ];
}

/**
 * A symbol placed at `at`, written like ChemDraw's: a Symbol graphic whose BoundingBox is the
 * position and a second point `size` away (see the scene's symbol drawing).
 */
export function createSymbolGraphic(
  id: string,
  symbolType: string,
  at: ChemDrawPoint,
  size: number,
): ChemDrawGraphic {
  return {
    id,
    type: 'graphic',
    graphicType: 'symbol',
    symbolType,
    points: [{ ...at }, { x: at.x, y: at.y + size }],
    preservation: { capability: 'editable' },
  };
}

export type FrameKind = 'rectangle' | 'square' | 'round' | 'curly';

/**
 * Object > Add Frame: a rectangle or a facing pair of brackets around `bounds`, `margin` clear of
 * it on every side (ChemDraw 17.1 guide, "Framing Objects").
 */
export function createFrameObjects(
  idFor: (index: number) => string,
  kind: FrameKind,
  bounds: { left: number; top: number; right: number; bottom: number },
  margin: number,
): ChemDrawObject[] {
  const padded = {
    left: bounds.left - margin,
    top: bounds.top - margin,
    right: bounds.right + margin,
    bottom: bounds.bottom + margin,
  };
  if (kind === 'rectangle') {
    return [
      createBoxShapeGraphic(idFor(0), 'rectangle', {
        center: { x: (padded.left + padded.right) / 2, y: (padded.top + padded.bottom) / 2 },
        halfWidth: (padded.right - padded.left) / 2,
        halfHeight: (padded.bottom - padded.top) / 2,
      }),
    ];
  }
  const style: BracketStyle = kind === 'square' ? 'Square' : kind === 'round' ? 'Round' : 'Curly';
  const [left, right] = createBracketPair(idFor(0), style, padded);
  return [left, { ...right, id: idFor(1) }];
}
