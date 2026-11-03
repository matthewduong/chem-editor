import type { ChemDrawGraphic, ChemDrawPoint } from '../types/chemdraw';
import {
  ORBITAL_OUTLINES,
  ORBITAL_RECIPES,
  ORBITAL_SLICE_GRAYS,
  type Cubic,
} from './orbitalShapes';

/**
 * Outlines for ChemDraw's orbitals (17.1 guide, "Orbitals"). An orbital is drawn "so that the
 * node appears first": its two BoundingBox points are the nucleus and the tip of the lobe it was
 * dragged out to, and the other lobes follow from that axis. An s orbital ChemDraw writes with
 * Center3D and axis ends instead. The OrbitalType names the shape (s, oval, p, lobe, hybrid, dz2,
 * dxy), an optional phase (Plus / Minus) and a fill (Shaded / Filled).
 *
 * The proportions here are read from ChemDraw's drawings, not measured; gaps.md lists them.
 */
export type OrbitalFill = 'open' | 'shaded' | 'filled';

export interface OrbitalOutline {
  points: ChemDrawPoint[];
  closed: boolean;
  fill: OrbitalFill;
  /**
   * Set on the measured shapes (every OrbitalType in the DTD): the flat gray to fill with (0
   * black, 1 white), or null for no fill. Shaded orbitals come as 32 such outlines, outermost
   * first. `fill` is then unused.
   */
  gray?: number | null;
  /** Whether to stroke the outline (with the line width); the measured shapes set it. */
  stroke?: boolean;
}

export interface OrbitalKind {
  shape: 's' | 'oval' | 'p' | 'lobe' | 'hybrid' | 'dz2' | 'dxy' | 'unknown';
  phase: 'plus' | 'minus' | null;
  fill: OrbitalFill;
}

export function parseOrbitalType(orbitalType: string | undefined): OrbitalKind {
  const text = (orbitalType ?? '').trim();
  const match = /^(s|oval|p|lobe|hybrid|dz2|dxy|sigma|pi)(plus|minus)?(shaded|filled)?$/i.exec(
    text,
  );
  if (!match) return { shape: 'unknown', phase: null, fill: 'open' };
  const base = match[1]!.toLowerCase();
  const shape: OrbitalKind['shape'] =
    base === 'sigma' ? 'oval' : base === 'pi' ? 'p' : (base as OrbitalKind['shape']);
  const phase = match[2] ? (match[2].toLowerCase() as 'plus' | 'minus') : null;
  const fill = match[3] ? (match[3].toLowerCase() as OrbitalFill) : 'open';
  return { shape, phase, fill };
}

/** A teardrop from `node` to a tip `length` away along `angle`, `widthRatio` of it wide. */
function lobe(
  node: ChemDrawPoint,
  angle: number,
  length: number,
  widthRatio = 0.62,
): ChemDrawPoint[] {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const points: ChemDrawPoint[] = [];
  for (let i = 0; i <= 48; i += 1) {
    const t = (i / 48) * Math.PI * 2;
    const along = (length * (1 - Math.cos(t))) / 2;
    const across = ((widthRatio * length) / 2) * Math.sin(t) * ((1 - Math.cos(t)) / 2) * 1.3;
    points.push({ x: node.x + ux * along - uy * across, y: node.y + uy * along + ux * across });
  }
  return points;
}

function ellipse(center: ChemDrawPoint, a: ChemDrawPoint, b: ChemDrawPoint): ChemDrawPoint[] {
  const points: ChemDrawPoint[] = [];
  for (let i = 0; i <= 64; i += 1) {
    const t = (i / 64) * Math.PI * 2;
    points.push({
      x: center.x + a.x * Math.cos(t) + b.x * Math.sin(t),
      y: center.y + a.y * Math.cos(t) + b.y * Math.sin(t),
    });
  }
  return points;
}

const LETTER_OUTLINE: Record<string, { name: string; mirror?: boolean }> = {
  A: { name: 'lobe' },
  B: { name: 'lobe', mirror: true },
  H: { name: 'small' },
  X: { name: 'dxyLobe' },
  Y: { name: 'dxyLobe', mirror: true },
  U: { name: 'dxyUp' },
  D: { name: 'dxyDown' },
  C: { name: 'circle' },
  O: { name: 'oval' },
  R: { name: 'ring' },
};

function sampleCubics(cubics: ReadonlyArray<Cubic>, mirror: boolean): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (const [p0, p1, p2, p3] of cubics) {
    for (let i = 0; i < 12; i += 1) {
      const t = i / 12;
      const a = (1 - t) ** 3;
      const b = 3 * (1 - t) ** 2 * t;
      const c = 3 * (1 - t) * t * t;
      const d = t ** 3;
      const x = a * p0![0] + b * p1![0] + c * p2![0] + d * p3![0];
      points.push([mirror ? 2 - x : x, a * p0![1] + b * p1![1] + c * p2![1] + d * p3![1]]);
    }
  }
  return points;
}

/**
 * The shaded fill: 32 copies of the outline shrinking towards a point up and to the left of its
 * middle (the light stays up and to the left of the page whatever the orbital's angle), each
 * lighter than the one before. The last copy was 0.112 of the outline's size (0.152 for the circle
 * and oval) and ChemDraw's focus sat 0.29 of the outline's width and height from its middle at 0
 * degrees, 0.26 at 90 and 0.18 at 45 (0.24 for the small hybrid lobe): the 45 and 90 degree values
 * are fitted to one orbital each, so the fall-off with angle is approximate.
 */
function shadedSlices(page: ChemDrawPoint[], round: boolean, small: boolean, angle: number) {
  const xs = page.map((point) => point.x);
  const ys = page.map((point) => point.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const width = right - left;
  const height = bottom - top;
  const centre = { x: (left + right) / 2, y: (top + bottom) / 2 };
  const half = Math.abs(Math.cos(2 * angle));
  const g0 = round ? 0.2855 : small ? 0.2425 : 0.293;
  const g = (g0 * (0.176 + 0.117 * half)) / 0.293;
  const focus = { x: centre.x - g * width, y: centre.y - g * height };
  const last = round ? 0.848 : 0.888;
  return ORBITAL_SLICE_GRAYS.map((gray, k) => {
    const scale = 1 - (k * last) / (ORBITAL_SLICE_GRAYS.length - 1);
    return {
      gray,
      points: page.map((point) => ({
        x: focus.x + scale * (point.x - focus.x),
        y: focus.y + scale * (point.y - focus.y),
      })),
    };
  });
}

/** An OrbitalType from the DTD, drawn as ChemDraw 26.1.0.6801 draws it (`orbitalShapes.ts`). */
function measuredOrbital(object: ChemDrawGraphic, recipe: string): OrbitalOutline[] {
  const [first, second] = object.points ?? [];
  if (!first || !second) return [];
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  if (Math.hypot(dx, dy) < 0.5) return [];
  const angle = Math.atan2(-dy, dx);
  const toPage = ([x, y]: [number, number]): ChemDrawPoint => ({
    x: first.x + dx * x - dy * y,
    y: first.y + dy * x + dx * y,
  });
  const result: OrbitalOutline[] = [];
  for (const part of recipe.split(' ')) {
    const [letter, style] = part.split(':') as [string, string];
    const spec = LETTER_OUTLINE[letter!]!;
    const page = sampleCubics(ORBITAL_OUTLINES[spec.name]!, spec.mirror === true).map(toPage);
    const round = spec.name === 'circle' || spec.name === 'oval';
    if (style === 'S' || style === 'SO') {
      for (const slice of shadedSlices(page, round, spec.name === 'small', angle)) {
        result.push({
          points: slice.points,
          closed: true,
          fill: 'shaded',
          gray: slice.gray,
          stroke: false,
        });
      }
      if (style === 'SO')
        result.push({ points: page, closed: true, fill: 'open', gray: null, stroke: true });
    } else {
      result.push({
        points: page,
        closed: true,
        fill: style === 'W' ? 'open' : 'filled',
        gray: style === 'W' ? 1 : 0,
        stroke: style === 'W' || style === 'KO',
      });
    }
  }
  return result;
}

/** The outlines an orbital graphic draws, or none when its geometry is missing. */
export function orbitalOutlines(object: ChemDrawGraphic): OrbitalOutline[] {
  const recipe = ORBITAL_RECIPES[object.orbitalType ?? ''];
  if (recipe && (object.points?.length ?? 0) >= 2) return measuredOrbital(object, recipe);
  const kind = parseOrbitalType(object.orbitalType);
  const shaded: OrbitalFill = kind.fill === 'open' ? 'shaded' : kind.fill;
  // A Plus phase colours the lobe it was dragged out to, Minus the one opposite.
  const front: OrbitalFill = kind.phase === 'minus' ? 'open' : kind.fill;
  const back: OrbitalFill = kind.phase === 'minus' ? shaded : 'open';

  if (object.center && object.majorAxisEnd && object.minorAxisEnd) {
    const a = {
      x: object.majorAxisEnd.x - object.center.x,
      y: object.majorAxisEnd.y - object.center.y,
    };
    const b = {
      x: object.minorAxisEnd.x - object.center.x,
      y: object.minorAxisEnd.y - object.center.y,
    };
    if (kind.shape === 's' || kind.shape === 'oval' || kind.shape === 'unknown') {
      const fill =
        kind.fill !== 'open'
          ? kind.fill
          : /shaded/i.test(object.ovalType ?? '')
            ? 'shaded'
            : /filled/i.test(object.ovalType ?? '')
              ? 'filled'
              : 'open';
      return [{ points: ellipse(object.center, a, b), closed: true, fill }];
    }
  }
  const [node, tip] = object.points ?? [];
  if (!node || !tip) return [];
  const length = Math.hypot(tip.x - node.x, tip.y - node.y);
  if (length < 0.5) return [];
  const angle = Math.atan2(tip.y - node.y, tip.x - node.x);
  const u = { x: Math.cos(angle) * length, y: Math.sin(angle) * length };
  const v = { x: -Math.sin(angle) * length, y: Math.cos(angle) * length };
  switch (kind.shape) {
    case 's':
      return [{ points: ellipse(node, u, v), closed: true, fill: kind.fill }];
    case 'oval':
      // A sigma orbital: an ellipse along the axis, half as wide as it is long.
      return [
        {
          points: ellipse(
            { x: (node.x + tip.x) / 2, y: (node.y + tip.y) / 2 },
            { x: u.x / 2, y: u.y / 2 },
            { x: v.x / 4, y: v.y / 4 },
          ),
          closed: true,
          fill: kind.fill,
        },
      ];
    case 'lobe':
      return [{ points: lobe(node, angle, length), closed: true, fill: kind.fill }];
    case 'p':
      return [
        { points: lobe(node, angle, length), closed: true, fill: front },
        { points: lobe(node, angle + Math.PI, length), closed: true, fill: back },
      ];
    case 'hybrid':
      return [
        { points: lobe(node, angle, length), closed: true, fill: front },
        { points: lobe(node, angle + Math.PI, length * 0.35, 0.8), closed: true, fill: back },
      ];
    case 'dz2':
      return [
        { points: lobe(node, angle, length), closed: true, fill: front },
        { points: lobe(node, angle + Math.PI, length), closed: true, fill: front },
        {
          points: ellipse(node, { x: v.x * 0.42, y: v.y * 0.42 }, { x: u.x * 0.16, y: u.y * 0.16 }),
          closed: true,
          fill: back,
        },
      ];
    case 'dxy':
      return [0, 1, 2, 3].map((quarter) => ({
        points: lobe(node, angle + Math.PI / 4 + (quarter * Math.PI) / 2, length * 0.85, 0.55),
        closed: true,
        fill: quarter % 2 === 0 ? front : back,
      }));
    default:
      return [];
  }
}
