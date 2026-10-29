import type { ChemDrawGraphic, ChemDrawPoint } from '../types/chemdraw';
import { CURVE_TYPE } from './curveGeometry';

/**
 * Freehand curves: the pointer path a pen drag leaves, fitted with a few cubic Beziers and
 * written as ChemDraw's anchor triples (see `curveGeometry.ts`).
 *
 * The fit is Schneider's ("An Algorithm for Automatically Fitting Digitized Curves", Graphics
 * Gems, 1990): fit one cubic by least squares with chord-length parameters, refine the parameters
 * by Newton steps, and split at the worst point when the error stays above tolerance. Adjacent
 * pieces share a tangent, so the joins are smooth.
 */

type Vec = ChemDrawPoint;
const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
const dot = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const len = (a: Vec) => Math.hypot(a.x, a.y);
const unit = (a: Vec): Vec => {
  const l = len(a);
  return l > 1e-12 ? scale(a, 1 / l) : { x: 0, y: 0 };
};

type Cubic = [Vec, Vec, Vec, Vec];

function bezier(c: Cubic, t: number): Vec {
  const u = 1 - t;
  return add(
    add(scale(c[0], u * u * u), scale(c[1], 3 * u * u * t)),
    add(scale(c[2], 3 * u * t * t), scale(c[3], t * t * t)),
  );
}

function bezierPrime(c: Cubic, t: number): Vec {
  const u = 1 - t;
  return add(
    add(scale(sub(c[1], c[0]), 3 * u * u), scale(sub(c[2], c[1]), 6 * u * t)),
    scale(sub(c[3], c[2]), 3 * t * t),
  );
}

function bezierSecond(c: Cubic, t: number): Vec {
  return add(
    scale(add(sub(c[2], scale(c[1], 2)), c[0]), 6 * (1 - t)),
    scale(add(sub(c[3], scale(c[2], 2)), c[1]), 6 * t),
  );
}

function chordParameters(points: readonly Vec[]): number[] {
  const u = [0];
  for (let i = 1; i < points.length; i += 1)
    u.push(u[i - 1]! + len(sub(points[i]!, points[i - 1]!)));
  const total = u[u.length - 1]! || 1;
  return u.map((value) => value / total);
}

function generateCubic(points: readonly Vec[], u: number[], tan1: Vec, tan2: Vec): Cubic {
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let c00 = 0;
  let c01 = 0;
  let c11 = 0;
  let x0 = 0;
  let x1 = 0;
  for (let i = 0; i < points.length; i += 1) {
    const t = u[i]!;
    const v = 1 - t;
    const a1 = scale(tan1, 3 * v * v * t);
    const a2 = scale(tan2, 3 * v * t * t);
    c00 += dot(a1, a1);
    c01 += dot(a1, a2);
    c11 += dot(a2, a2);
    const shortfall = sub(points[i]!, bezier([first, first, last, last], t));
    x0 += dot(a1, shortfall);
    x1 += dot(a2, shortfall);
  }
  const det = c00 * c11 - c01 * c01;
  let alpha1 = Math.abs(det) > 1e-12 ? (x0 * c11 - x1 * c01) / det : 0;
  let alpha2 = Math.abs(det) > 1e-12 ? (c00 * x1 - c01 * x0) / det : 0;
  const segmentLength = len(sub(last, first));
  const epsilon = 1e-6 * segmentLength;
  if (alpha1 < epsilon || alpha2 < epsilon) {
    // Wilson-Fowler fallback: a third of the chord along each tangent.
    alpha1 = alpha2 = segmentLength / 3;
  }
  return [first, add(first, scale(tan1, alpha1)), add(last, scale(tan2, alpha2)), last];
}

function maxError(
  points: readonly Vec[],
  cubic: Cubic,
  u: number[],
): { error: number; index: number } {
  let error = 0;
  let index = Math.floor(points.length / 2);
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = len(sub(bezier(cubic, u[i]!), points[i]!)) ** 2;
    if (d > error) {
      error = d;
      index = i;
    }
  }
  return { error, index };
}

function reparameterize(points: readonly Vec[], cubic: Cubic, u: number[]): number[] {
  return u.map((t, i) => {
    const diff = sub(bezier(cubic, t), points[i]!);
    const d1 = bezierPrime(cubic, t);
    const d2 = bezierSecond(cubic, t);
    const denominator = dot(d1, d1) + dot(diff, d2);
    if (Math.abs(denominator) < 1e-12) return t;
    return Math.min(1, Math.max(0, t - dot(diff, d1) / denominator));
  });
}

function fitRange(points: readonly Vec[], tan1: Vec, tan2: Vec, tolerance: number, out: Cubic[]) {
  if (points.length === 2) {
    const third = len(sub(points[1]!, points[0]!)) / 3;
    out.push([
      points[0]!,
      add(points[0]!, scale(tan1, third)),
      add(points[1]!, scale(tan2, third)),
      points[1]!,
    ]);
    return;
  }
  let u = chordParameters(points);
  let cubic = generateCubic(points, u, tan1, tan2);
  let { error, index } = maxError(points, cubic, u);
  const squared = tolerance * tolerance;
  if (error < squared) {
    out.push(cubic);
    return;
  }
  if (error < squared * 4) {
    for (let iteration = 0; iteration < 8; iteration += 1) {
      u = reparameterize(points, cubic, u);
      cubic = generateCubic(points, u, tan1, tan2);
      ({ error, index } = maxError(points, cubic, u));
      if (error < squared) {
        out.push(cubic);
        return;
      }
    }
  }
  const center = unit(sub(points[index - 1]!, points[index + 1]!));
  fitRange(points.slice(0, index + 1), tan1, center, tolerance, out);
  fitRange(points.slice(index), scale(center, -1), tan2, tolerance, out);
}

/** Drops points closer than `minimum` to the last kept one (the pointer reports many). */
export function thinPath(path: readonly Vec[], minimum = 2): Vec[] {
  const kept: Vec[] = [];
  for (const point of path) {
    const last = kept[kept.length - 1];
    if (!last || len(sub(point, last)) >= minimum) kept.push({ ...point });
  }
  const end = path[path.length - 1];
  if (end && kept.length > 1 && kept[kept.length - 1] !== end) {
    const last = kept[kept.length - 1]!;
    if (last.x !== end.x || last.y !== end.y) kept.push({ ...end });
  }
  return kept;
}

/** Cubic pieces through `path`, within `tolerance` px of every sample. */
export function fitCurve(path: readonly Vec[], tolerance = 1.5): Cubic[] {
  const points = thinPath(path);
  if (points.length < 2) return [];
  const tan1 = unit(sub(points[1]!, points[0]!));
  const tan2 = unit(sub(points[points.length - 2]!, points[points.length - 1]!));
  const out: Cubic[] = [];
  fitRange(points, tan1, tan2, tolerance, out);
  return out;
}

/**
 * Cubic pieces as ChemDraw's anchor triples: (incoming control, anchor, outgoing control) per
 * anchor. The first anchor's incoming and the last one's outgoing control are mirrored from the
 * other side, so the curve can later be closed without a kink being invented.
 */
export function cubicsToCurvePoints(cubics: readonly Cubic[]): Vec[] {
  if (cubics.length === 0) return [];
  const triples: Vec[] = [];
  const first = cubics[0]!;
  triples.push(sub(scale(first[0], 2), first[1]), first[0], first[1]);
  cubics.forEach((cubic, index) => {
    const next = cubics[index + 1];
    triples.push(cubic[2], cubic[3], next ? next[1] : sub(scale(cubic[3], 2), cubic[2]));
  });
  return triples;
}

/** The curve a pen drag along `path` draws, or null when the drag was too short. */
export function createFreehandCurve(id: string, path: readonly Vec[]): ChemDrawGraphic | null {
  const cubics = fitCurve(path);
  if (cubics.length === 0) return null;
  const span = Math.hypot(
    Math.max(...path.map((p) => p.x)) - Math.min(...path.map((p) => p.x)),
    Math.max(...path.map((p) => p.y)) - Math.min(...path.map((p) => p.y)),
  );
  if (span < 4) return null;
  return {
    id,
    type: 'graphic',
    graphicType: 'curve',
    points: cubicsToCurvePoints(cubics),
    curveType: 0,
    preservation: { capability: 'editable' },
  };
}

export type CurveProperty = 'closed' | 'filled' | 'shaded' | 'arrow-end' | 'arrow-start';

/**
 * Curve menu toggles, written as ChemDraw writes them: CurveType bits (Closed 1, Filled 128,
 * Shaded 256; ChemDraw's own closed Cp ellipse carries only CurveType 1) plus ArrowheadHead /
 * ArrowheadTail beside bits 8 and 16, as every arrowed curve in ChemDraw's templates does.
 * ChemDraw's "Faded" fill has no CurveType bit we know of, so it is not offered (gaps.md).
 */
export function toggleCurveProperty(
  curve: ChemDrawGraphic,
  property: CurveProperty,
): ChemDrawGraphic {
  const bits = curve.curveType ?? 0;
  const flip = (bit: number) => (bits & bit ? bits & ~bit : bits | bit);
  switch (property) {
    case 'closed': {
      const closing = (bits & CURVE_TYPE.closed) === 0 && curve.closed !== true;
      return {
        ...curve,
        curveType: closing
          ? (bits | CURVE_TYPE.closed) & ~(CURVE_TYPE.arrowAtEnd | CURVE_TYPE.arrowAtStart)
          : bits & ~CURVE_TYPE.closed & ~CURVE_TYPE.filled & ~CURVE_TYPE.shaded,
        closed: undefined,
        ...(closing ? { headEnd: undefined, tailEnd: undefined, headType: undefined } : {}),
      };
    }
    case 'filled':
      return {
        ...curve,
        curveType: (flip(CURVE_TYPE.filled) | CURVE_TYPE.closed) & ~CURVE_TYPE.shaded,
      };
    case 'shaded':
      return {
        ...curve,
        curveType: (flip(CURVE_TYPE.shaded) | CURVE_TYPE.closed) & ~CURVE_TYPE.filled,
      };
    case 'arrow-end': {
      const on = (curve.headEnd ?? 'none') === 'none';
      return {
        ...curve,
        curveType: on
          ? (bits | CURVE_TYPE.arrowAtEnd) & ~CURVE_TYPE.closed
          : bits & ~CURVE_TYPE.arrowAtEnd,
        headEnd: on ? 'full' : 'none',
        headType: curve.headType ?? 'solid',
      };
    }
    case 'arrow-start': {
      const on = (curve.tailEnd ?? 'none') === 'none';
      return {
        ...curve,
        curveType: on
          ? (bits | CURVE_TYPE.arrowAtStart) & ~CURVE_TYPE.closed
          : bits & ~CURVE_TYPE.arrowAtStart,
        tailEnd: on ? 'full' : 'none',
        headType: curve.headType ?? 'solid',
      };
    }
  }
}
