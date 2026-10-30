import type { ChemDrawObject, ChemDrawPoint } from '../types/chemdraw';
import type { Arrow, Atom, Bond, TextBox } from '../types/chemistry';
import { CURVE_TYPE, curveSegments, sampleCurve } from './curveGeometry';

/** Even-odd test: is `point` inside the closed polygon `polygon`? */
export function pointInPolygon(point: ChemDrawPoint, polygon: readonly ChemDrawPoint[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

export interface RegionSelection {
  atomIds: string[];
  bondIds: string[];
  arrowIds: string[];
  textBoxIds: string[];
  /** Graphics and brackets. */
  objectIds: string[];
}

/** The points that must all lie inside a region for a native object to count as enclosed. */
function outlinePoints(object: ChemDrawObject): ChemDrawPoint[] {
  if (object.type === 'bracket') {
    const b = object.bounds;
    return [
      { x: b.left, y: b.top },
      { x: b.right, y: b.top },
      { x: b.left, y: b.bottom },
      { x: b.right, y: b.bottom },
    ];
  }
  if (object.type !== 'graphic') return [];
  if (object.graphicType === 'curve' && object.points?.length) {
    const closed = object.closed === true || ((object.curveType ?? 0) & CURVE_TYPE.closed) !== 0;
    return sampleCurve(curveSegments(object.points, closed), 4);
  }
  if (object.bounds) {
    const b = object.bounds;
    return [
      { x: b.left, y: b.top },
      { x: b.right, y: b.top },
      { x: b.left, y: b.bottom },
      { x: b.right, y: b.bottom },
    ];
  }
  return object.points ?? [];
}

/**
 * What a lasso encloses: ChemDraw selects only objects "entirely within" it (17.1 guide, "The
 * Lasso Tool"). An atom by its position, a bond by both ends, an arrow by its tail, head and
 * control point, text by its anchor, a shape or bracket by its whole outline.
 */
export function selectEnclosed(
  contains: (point: ChemDrawPoint) => boolean,
  content: {
    atoms: readonly Atom[];
    bonds: readonly Bond[];
    arrows: readonly Arrow[];
    textBoxes: readonly TextBox[];
    objects: readonly ChemDrawObject[];
  },
): RegionSelection {
  const atomById = new Map(content.atoms.map((atom) => [atom.id, atom]));
  const atomIds = content.atoms.filter((atom) => contains(atom)).map((atom) => atom.id);
  const enclosedAtoms = new Set(atomIds);
  const bondIds = content.bonds
    .filter(
      (bond) =>
        atomById.has(bond.from) &&
        atomById.has(bond.to) &&
        enclosedAtoms.has(bond.from) &&
        enclosedAtoms.has(bond.to),
    )
    .map((bond) => bond.id);
  const arrowIds = content.arrows
    .filter(
      (arrow) =>
        contains({ x: arrow.x1, y: arrow.y1 }) &&
        contains({ x: arrow.x2, y: arrow.y2 }) &&
        contains({ x: arrow.cpx, y: arrow.cpy }),
    )
    .map((arrow) => arrow.id);
  const textBoxIds = content.textBoxes
    .filter((textBox) => contains({ x: textBox.x, y: textBox.y }))
    .map((textBox) => textBox.id);
  const objectIds = content.objects
    .filter((object) => {
      const outline = outlinePoints(object);
      return outline.length > 0 && outline.every(contains);
    })
    .map((object) => object.id);
  return { atomIds, bondIds, arrowIds, textBoxIds, objectIds };
}
