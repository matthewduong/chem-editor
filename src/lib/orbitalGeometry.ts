import type { ChemDrawGraphic, ChemDrawPoint } from '../types/chemdraw';

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

/** The outlines an orbital graphic draws, or none when its geometry is missing. */
export function orbitalOutlines(object: ChemDrawGraphic): OrbitalOutline[] {
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
