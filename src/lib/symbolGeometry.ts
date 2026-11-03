/**
 * Chemical symbols (CDXML `<graphic GraphicType="Symbol" SymbolType=...>`) as ChemDraw draws them.
 *
 * A symbol's BoundingBox is two points: `at` and `toward`, `L` apart. Measured on ChemDraw
 * 26.1.0.6801 by rendering each type at L = 7.5, 10 and 15 and reading the PDF's vector paths
 * (gaps.md): every primitive scales with L, plus a constant that is the half-width of a line.
 * Lengths below are in points of the document; callers pass `scale` for canvas units.
 *
 * - Electron: a dot of radius L/9 at `at`.
 * - LonePair: dots of radius 2L/9 at `at` and `toward`. LonePairBar: a bar between them, past
 *   each end by that radius.
 * - RadicalCation / RadicalAnion: a lone dot of radius 2L/9 at `at` and, centred on `toward`, a
 *   plus (minus) whose arm is 2L/9 + 0.3 either side.
 * - Plus / Minus: that plus (minus), centred on `at`. CirclePlus / CircleMinus: the same inside a
 *   circle of radius 0.44L + 0.29 on `at`.
 * - Dagger: a vertical bar 0.4L + 0.3 either side of `at` with a crossbar 0.2L above it, 0.2L + 0.3
 *   either side; DoubleDagger adds one the same distance below.
 * - Racemic / Absolute / Relative: the words Rac, Abs, Rel at the caption size, centred on `at`.
 *
 * LonePair, LonePairBar and the radicals follow the direction of the second point; the rest stay
 * axis-aligned whatever it is. Line thickness was 0.5 at LineWidth 0.6 and 0.953 at 1.2; the
 * arms, and so these constants, were measured at 0.6 only.
 */
export interface SymbolPoint {
  x: number;
  y: number;
}

export type SymbolPrimitive =
  | { kind: 'dot'; x: number; y: number; r: number }
  | { kind: 'bar'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'circle'; x: number; y: number; r: number }
  | { kind: 'text'; x: number; y: number; text: string };

export interface SymbolShape {
  primitives: SymbolPrimitive[];
  /** Thickness of the bars and the circle's line, in the same units. */
  thickness: number;
}

/** ChemDraw's symbol line thickness: 0.5 at the default LineWidth of 0.6, 0.953 at 1.2. */
export function symbolThickness(lineWidth: number): number {
  return 0.755 * lineWidth + 0.047;
}

export const SYMBOL_FLAG_TEXT: Record<string, string> = {
  Racemic: 'Rac',
  Absolute: 'Abs',
  Relative: 'Rel',
};

export function symbolShape(
  symbolType: string,
  at: SymbolPoint,
  toward: SymbolPoint,
  lineWidth: number,
  scale = 1,
): SymbolShape | null {
  const dx = toward.x - at.x;
  const dy = toward.y - at.y;
  const length = Math.hypot(dx, dy);
  const l = length / scale;
  const ux = length > 1e-9 ? dx / length : 1;
  const uy = length > 1e-9 ? dy / length : 0;
  const s = scale;
  const dotR = (2 * l * s) / 9;
  const plusHalf = ((2 * l) / 9 + 0.3) * s;
  const primitives: SymbolPrimitive[] = [];
  const plus = (c: SymbolPoint, half: number, vertical: boolean) => {
    primitives.push({ kind: 'bar', x1: c.x - half, y1: c.y, x2: c.x + half, y2: c.y });
    if (vertical)
      primitives.push({ kind: 'bar', x1: c.x, y1: c.y - half, x2: c.x, y2: c.y + half });
  };
  switch (symbolType) {
    case 'Electron':
      primitives.push({ kind: 'dot', x: at.x, y: at.y, r: (l * s) / 9 });
      break;
    case 'LonePair':
      primitives.push({ kind: 'dot', x: at.x, y: at.y, r: dotR });
      primitives.push({ kind: 'dot', x: toward.x, y: toward.y, r: dotR });
      break;
    case 'LonePairBar':
      primitives.push({
        kind: 'bar',
        x1: at.x - ux * dotR,
        y1: at.y - uy * dotR,
        x2: toward.x + ux * dotR,
        y2: toward.y + uy * dotR,
      });
      break;
    case 'RadicalCation':
    case 'RadicalAnion':
      primitives.push({ kind: 'dot', x: at.x, y: at.y, r: dotR });
      plus(toward, plusHalf, symbolType === 'RadicalCation');
      break;
    case 'Plus':
    case 'Minus':
      plus(at, plusHalf, symbolType === 'Plus');
      break;
    case 'CirclePlus':
    case 'CircleMinus':
      primitives.push({ kind: 'circle', x: at.x, y: at.y, r: (0.44 * l + 0.29) * s });
      plus(at, plusHalf, symbolType === 'CirclePlus');
      break;
    case 'Dagger':
    case 'DoubleDagger': {
      const spine = (0.4 * l + 0.3) * s;
      const cross = (0.2 * l + 0.3) * s;
      const drop = 0.2 * l * s;
      primitives.push({ kind: 'bar', x1: at.x, y1: at.y - spine, x2: at.x, y2: at.y + spine });
      primitives.push({
        kind: 'bar',
        x1: at.x - cross,
        y1: at.y - drop,
        x2: at.x + cross,
        y2: at.y - drop,
      });
      if (symbolType === 'DoubleDagger') {
        primitives.push({
          kind: 'bar',
          x1: at.x - cross,
          y1: at.y + drop,
          x2: at.x + cross,
          y2: at.y + drop,
        });
      }
      break;
    }
    case 'Racemic':
    case 'Absolute':
    case 'Relative':
      primitives.push({ kind: 'text', x: at.x, y: at.y, text: SYMBOL_FLAG_TEXT[symbolType]! });
      break;
    default:
      return null;
  }
  return { primitives, thickness: symbolThickness(lineWidth) * s };
}
