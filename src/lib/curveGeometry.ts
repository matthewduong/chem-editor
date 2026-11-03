import type { ChemDrawPoint } from '../types/chemdraw';

/**
 * Geometry of a ChemDraw `<curve>`.
 *
 * `CurvePoints` lists one triple per anchor: the control point arriving at the anchor, the anchor
 * itself, and the control point leaving it. Measured on ChemDraw's own files: every curve in its
 * templates has 3n points (9, 12, 15, 18), the drawn ends are the middle points of the first and
 * last triples, and the closed Cp ellipse in `Ti-sandwich.cdxml` has its four anchors at the
 * middle of each triple (bottom, right, top, left of the ring). An open curve ignores the first
 * triple's incoming and the last triple's outgoing control point; a closed one joins the last
 * anchor back to the first through them.
 */
export interface CubicSegment {
  p0: ChemDrawPoint;
  c1: ChemDrawPoint;
  c2: ChemDrawPoint;
  p3: ChemDrawPoint;
}

/**
 * A curve's "Faded" fill is not a CurveType bit: ChemDraw writes `FadePercent` (300 from the
 * Curves > Faded menu item) and fills the closed curve with its colour tinted towards white. The
 * tint is not linear in FadePercent; this is the share of the colour kept, read from the flat
 * gray ChemDraw 26.1.0.6801 filled a black curve with (255 less the gray, over 255) at each
 * FadePercent from 0 (white) to 1000 (the colour itself).
 */
const FADE_KEPT: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [50, 0.0392],
  [100, 0.0784],
  [150, 0.1216],
  [200, 0.1608],
  [300, 0.247],
  [400, 0.3333],
  [500, 0.4235],
  [600, 0.5216],
  [700, 0.6235],
  [800, 0.7373],
  [900, 0.859],
  [950, 0.929],
  [1000, 1],
];

/** The share of a faded curve's colour that stays, for a `FadePercent`. */
export function fadeKept(fadePercent: number): number {
  const p = Math.min(1000, Math.max(0, fadePercent));
  for (let i = 1; i < FADE_KEPT.length; i += 1) {
    const [p1, k1] = FADE_KEPT[i]!;
    if (p <= p1) {
      const [p0, k0] = FADE_KEPT[i - 1]!;
      return k0 + ((k1 - k0) * (p - p0)) / (p1 - p0);
    }
  }
  return 1;
}

/** A `#rrggbb` or `rgb(...)` colour tinted towards white as a faded fill; other strings as is. */
export function fadedColor(color: string, fadePercent: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim());
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color.trim());
  const channels = hex
    ? [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16))
    : rgb
      ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
      : null;
  if (!channels) return color;
  const kept = fadeKept(fadePercent);
  const [r, g, b] = channels.map((c) => Math.round(255 - (255 - c!) * kept));
  return `rgb(${r}, ${g}, ${b})`;
}

/** CurveType bits from the CDX specification, confirmed against ArrowheadHead/Tail in ChemDraw's templates. */
export const CURVE_TYPE = {
  closed: 0x1,
  dashed: 0x2,
  bold: 0x4,
  arrowAtEnd: 0x8,
  arrowAtStart: 0x10,
  halfArrowAtEnd: 0x20,
  halfArrowAtStart: 0x40,
  filled: 0x80,
  shaded: 0x100,
  doubled: 0x200,
} as const;

/** Whether `points` follows the anchor-triple layout (3n points, n >= 2). */
export function isAnchorTripleCurve(points: readonly ChemDrawPoint[]): boolean {
  return points.length >= 6 && points.length % 3 === 0;
}

/** The anchors (middle point of each triple). */
export function curveAnchors(points: readonly ChemDrawPoint[]): ChemDrawPoint[] {
  const anchors: ChemDrawPoint[] = [];
  for (let index = 1; index < points.length; index += 3) anchors.push(points[index]!);
  return anchors;
}

/** The cubic segments a curve draws. A list not in triples draws as a polyline of its points. */
export function curveSegments(points: readonly ChemDrawPoint[], closed: boolean): CubicSegment[] {
  if (!isAnchorTripleCurve(points)) {
    const segments: CubicSegment[] = [];
    const count = closed ? points.length : points.length - 1;
    for (let index = 0; index < count; index += 1) {
      const p0 = points[index]!;
      const p3 = points[(index + 1) % points.length]!;
      segments.push({ p0, c1: p0, c2: p3, p3 });
    }
    return segments;
  }
  const n = points.length / 3;
  const segments: CubicSegment[] = [];
  const count = closed ? n : n - 1;
  for (let index = 0; index < count; index += 1) {
    const next = (index + 1) % n;
    segments.push({
      p0: points[3 * index + 1]!,
      c1: points[3 * index + 2]!,
      c2: points[3 * next]!,
      p3: points[3 * next + 1]!,
    });
  }
  return segments;
}

export function cubicPointAt(segment: CubicSegment, t: number): ChemDrawPoint {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * segment.p0.x + b * segment.c1.x + c * segment.c2.x + d * segment.p3.x,
    y: a * segment.p0.y + b * segment.c1.y + c * segment.c2.y + d * segment.p3.y,
  };
}

/**
 * Direction of travel at `t`. Where a control point coincides with its anchor the derivative
 * vanishes, so this falls back to the next distinct point along the segment.
 */
export function cubicTangentAt(segment: CubicSegment, t: number): ChemDrawPoint {
  const u = 1 - t;
  const dx =
    3 * u * u * (segment.c1.x - segment.p0.x) +
    6 * u * t * (segment.c2.x - segment.c1.x) +
    3 * t * t * (segment.p3.x - segment.c2.x);
  const dy =
    3 * u * u * (segment.c1.y - segment.p0.y) +
    6 * u * t * (segment.c2.y - segment.c1.y) +
    3 * t * t * (segment.p3.y - segment.c2.y);
  if (Math.hypot(dx, dy) > 1e-9) return { x: dx, y: dy };
  const ahead = cubicPointAt(segment, Math.min(1, t + 1e-3));
  const behind = cubicPointAt(segment, Math.max(0, t - 1e-3));
  return { x: ahead.x - behind.x, y: ahead.y - behind.y };
}

/** De Casteljau split at `t`. */
export function splitCubic(segment: CubicSegment, t: number): [CubicSegment, CubicSegment] {
  const lerp = (a: ChemDrawPoint, b: ChemDrawPoint) => ({
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  });
  const ab = lerp(segment.p0, segment.c1);
  const bc = lerp(segment.c1, segment.c2);
  const cd = lerp(segment.c2, segment.p3);
  const abc = lerp(ab, bc);
  const bcd = lerp(bc, cd);
  const mid = lerp(abc, bcd);
  return [
    { p0: segment.p0, c1: ab, c2: abc, p3: mid },
    { p0: mid, c1: bcd, c2: cd, p3: segment.p3 },
  ];
}

/**
 * Shortens a segment by `distance` (straight-line, from the chosen end), so a shaft can stop
 * where an arrowhead begins. Returns the segment unchanged if it is shorter than that.
 */
export function trimCubic(segment: CubicSegment, atEnd: boolean, distance: number): CubicSegment {
  if (distance <= 0) return segment;
  const anchor = atEnd ? segment.p3 : segment.p0;
  const far = atEnd ? segment.p0 : segment.p3;
  if (Math.hypot(far.x - anchor.x, far.y - anchor.y) <= distance) return segment;
  let lo = 0;
  let hi = 1;
  for (let step = 0; step < 40; step += 1) {
    const mid = (lo + hi) / 2;
    const point = cubicPointAt(segment, atEnd ? 1 - mid : mid);
    if (Math.hypot(point.x - anchor.x, point.y - anchor.y) < distance) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return atEnd ? splitCubic(segment, 1 - t)[0] : splitCubic(segment, t)[1];
}

/** Points along the curve, for hit-testing and bounds. */
export function sampleCurve(
  segments: readonly CubicSegment[],
  stepsPerSegment = 16,
): ChemDrawPoint[] {
  const samples: ChemDrawPoint[] = [];
  segments.forEach((segment, index) => {
    for (let step = index === 0 ? 0 : 1; step <= stepsPerSegment; step += 1) {
      samples.push(cubicPointAt(segment, step / stepsPerSegment));
    }
  });
  return samples;
}
