/**
 * Arc arrows: the circle or ellipse ChemDraw describes with Center3D, MajorAxisEnd3D and
 * MinorAxisEnd3D, swept through AngularSize degrees from the tail to the head.
 *
 * A quadratic curve cannot stand in for these. Its control point is the intersection of the end
 * tangents, which for a half circle lies at infinity (the two tangents are parallel) and for a
 * three-quarter arc is on the wrong side of the chord, so a -180 degree arc came out as a straight
 * line. Here the arc is sampled from its parametric form instead.
 */
export interface ArcPoint {
  x: number;
  y: number;
}

export interface ArcArrowSource {
  tail: ArcPoint;
  head: ArcPoint;
  arcCenter?: ArcPoint;
  majorAxisEnd?: ArcPoint;
  minorAxisEnd?: ArcPoint;
  angularSize?: number;
}

export interface ArcArrowGeometry {
  center: ArcPoint;
  /** Vector from the centre to the major axis end. */
  a: ArcPoint;
  /** Vector from the centre to the minor axis end. */
  b: ArcPoint;
  /** Parameter of the tail, radians. */
  start: number;
  /** Signed parameter sweep from tail to head, radians. */
  sweep: number;
}

/** Parameter angle of `point` on the ellipse with half axes `a` and `b` about `center`. */
function parameterOf(point: ArcPoint, center: ArcPoint, a: ArcPoint, b: ArcPoint): number {
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  // Solve dx = a.x cos + b.x sin, dy = a.y cos + b.y sin for (cos, sin).
  const det = a.x * b.y - a.y * b.x;
  if (Math.abs(det) < 1e-9) return 0;
  const cos = (dx * b.y - dy * b.x) / det;
  const sin = (a.x * dy - a.y * dx) / det;
  return Math.atan2(sin, cos);
}

export function resolveArcArrow(source: ArcArrowSource): ArcArrowGeometry | null {
  const { arcCenter: center, majorAxisEnd, minorAxisEnd, angularSize } = source;
  if (!center || !majorAxisEnd || !minorAxisEnd) return null;
  if (typeof angularSize !== 'number' || !Number.isFinite(angularSize) || angularSize === 0) {
    return null;
  }
  const a = { x: majorAxisEnd.x - center.x, y: majorAxisEnd.y - center.y };
  const b = { x: minorAxisEnd.x - center.x, y: minorAxisEnd.y - center.y };
  if (Math.hypot(a.x, a.y) < 1e-6 || Math.hypot(b.x, b.y) < 1e-6) return null;
  const start = parameterOf(source.tail, center, a, b);
  const end = parameterOf(source.head, center, a, b);
  // The direction comes from the sign of AngularSize and the handedness of the axes: a positive
  // angle runs counterclockwise on the page (y down), and the parameter runs clockwise when the
  // major axis turns into the minor one by a positive cross product. The size comes from the
  // endpoints, taken round in that direction. Read the other way a half circle is drawn through the
  // molecule instead of round the outside of it.
  const handedness = Math.sign(a.x * b.y - a.y * b.x) || 1;
  const direction = -Math.sign(angularSize) * handedness;
  const TWO_PI = Math.PI * 2;
  let delta = (end - start) % TWO_PI;
  if (direction > 0 && delta <= 0) delta += TWO_PI;
  if (direction < 0 && delta >= 0) delta -= TWO_PI;
  const best = delta;
  return { center, a, b, start, sweep: best };
}

/** The point at fraction `t` (0 at the tail, 1 at the head) along the arc. */
export function arcPointAt(arc: ArcArrowGeometry, t: number): ArcPoint {
  const theta = arc.start + arc.sweep * t;
  return {
    x: arc.center.x + arc.a.x * Math.cos(theta) + arc.b.x * Math.sin(theta),
    y: arc.center.y + arc.a.y * Math.cos(theta) + arc.b.y * Math.sin(theta),
  };
}

/** Direction of travel at fraction `t`. */
export function arcTangentAt(arc: ArcArrowGeometry, t: number): ArcPoint {
  const theta = arc.start + arc.sweep * t;
  const sign = arc.sweep < 0 ? -1 : 1;
  return {
    x: sign * (-arc.a.x * Math.sin(theta) + arc.b.x * Math.cos(theta)),
    y: sign * (-arc.a.y * Math.sin(theta) + arc.b.y * Math.cos(theta)),
  };
}

/** Samples the arc between fractions `from` and `to`, dense enough to look round at any size. */
export function sampleArc(arc: ArcArrowGeometry, from = 0, to = 1, perQuarter = 24): ArcPoint[] {
  const count = Math.max(
    2,
    Math.ceil((Math.abs(arc.sweep) * (to - from) * perQuarter) / (Math.PI / 2)),
  );
  return Array.from({ length: count + 1 }, (_, i) =>
    arcPointAt(arc, from + ((to - from) * i) / count),
  );
}

/**
 * The fraction along the arc at which the path has come `distance` in from the head (`fromHead`)
 * or the tail, measured along the arc. Used to stop a shaft where its arrowhead begins.
 */
export function arcFractionAtDistance(
  arc: ArcArrowGeometry,
  distance: number,
  fromHead: boolean,
): number {
  const samples = sampleArc(arc, 0, 1, 64);
  let walked = 0;
  const order = fromHead ? [...samples].reverse() : samples;
  for (let i = 1; i < order.length; i += 1) {
    const step = Math.hypot(order[i]!.x - order[i - 1]!.x, order[i]!.y - order[i - 1]!.y);
    if (walked + step >= distance) {
      const within = step > 0 ? (distance - walked) / step : 0;
      const index = (i - 1 + within) / (order.length - 1);
      return fromHead ? 1 - index : index;
    }
    walked += step;
  }
  return fromHead ? 0 : 1;
}
