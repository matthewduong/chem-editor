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

/**
 * A "Shaded" closed curve in ChemDraw 26.1.0.6801 is 32 flat-filled copies of the outline, the
 * first the outline itself and each smaller, shrinking linearly to 0.112 of its size towards a
 * point up and to the left of the middle (0.264 of the outline's width and height from it), then
 * the outline stroked on top (gaps.md). The colours are measured for black (grays 145 down to 0,
 * lighter outside), for white (0 up to 255) and for red (black up to 255, 38, 0); other colours
 * follow the colour times the white ramp and are approximate.
 */
const SHADED_BLACK_GRAYS = [
  145, 138, 131, 123, 116, 109, 103, 96, 89, 82, 77, 70, 64, 58, 53, 47, 41, 37, 32, 27, 21, 18, 13,
  10, 5, 4, 2, 1, 0, 0, 0, 0,
];
/** The white ramp (0 to 1) of the orbital shading, shared by any colour that is not black. */
const SHADED_LIGHT_RAMP = [
  0, 0.0706, 0.1569, 0.2314, 0.298, 0.3569, 0.4118, 0.4627, 0.5098, 0.5569, 0.5961, 0.6353, 0.6706,
  0.7059, 0.7373, 0.7686, 0.796, 0.8196, 0.8431, 0.8667, 0.8863, 0.902, 0.9216, 0.9373, 0.949,
  0.9608, 0.9725, 0.9804, 0.9882, 0.9922, 0.9961, 1,
];

export interface ShadedSlice {
  points: ChemDrawPoint[];
  /** `rgb(r, g, b)` for the slice. */
  color: string;
}

export function shadedCurveSlices(
  outline: readonly ChemDrawPoint[],
  rgb: readonly [number, number, number],
): ShadedSlice[] {
  if (outline.length < 3) return [];
  const xs = outline.map((point) => point.x);
  const ys = outline.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const focus = {
    x: (left + right) / 2 - 0.264 * (right - left),
    y: (top + bottom) / 2 - 0.264 * (bottom - top),
  };
  const black = Math.max(...rgb) <= 38;
  return SHADED_LIGHT_RAMP.map((light, k) => {
    const scale = 1 - (k * 0.888) / 31;
    let channels: number[];
    if (black) {
      channels = [SHADED_BLACK_GRAYS[k]!, SHADED_BLACK_GRAYS[k]!, SHADED_BLACK_GRAYS[k]!];
    } else {
      // Red went from black up to (255, 38, 0): its own colour times the ramp. The 38 of green
      // at the top (and none of blue) is not modelled.
      channels = rgb.map((c) => light * c);
    }
    return {
      color: `rgb(${channels.map((c) => Math.round(c)).join(', ')})`,
      points: outline.map((point) => ({
        x: focus.x + scale * (point.x - focus.x),
        y: focus.y + scale * (point.y - focus.y),
      })),
    };
  });
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
