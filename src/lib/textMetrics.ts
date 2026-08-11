import type { MetricFace, MetricFamily } from './generated/fontMetrics';
import { FONT_METRICS } from './generated/fontMetrics';

export interface FontSpec {
  family: string;
  sizePx: number;
  bold?: boolean;
  italic?: boolean;
}

export interface GlyphRunMetrics {
  /** Total pen advance for the string, in px. */
  advance: number;
  /** Distance above the baseline to the face's ascender, in px. Positive. */
  ascent: number;
  /** Distance below the baseline to the face's descender, in px. Positive. */
  descent: number;
  /** Height of a flat capital, in px. This is what ChemDraw centres atom labels on. */
  capHeight: number;
  /** Height of a lowercase x, in px. */
  xHeight: number;
}

/**
 * Maps a CSS family (or family stack) onto one of the vendored metric-compatible faces.
 *
 * The vendored Liberation faces are metrically identical to the families they stand in for:
 * Sans≡Arial (and Helvetica, which shares Arial's advance widths), Serif≡Times New Roman,
 * Mono≡Courier New. Families with no metric-compatible free equivalent (Georgia, Verdana) fall
 * back to the nearest class, so their advances are approximate.
 */
export function resolveMetricFamily(family: string | null | undefined): MetricFamily {
  const first = (family ?? '')
    .split(',')[0]
    .trim()
    .replace(/^["']|["']$/g, '')
    .toLowerCase();

  switch (first) {
    case 'times':
    case 'times new roman':
    case 'georgia':
    case 'garamond':
    case 'palatino':
    case 'book antiqua':
    case 'serif':
      return 'serif';
    case 'courier':
    case 'courier new':
    case 'consolas':
    case 'monaco':
    case 'menlo':
    case 'ui-monospace':
    case 'monospace':
      return 'mono';
    default:
      return 'sans';
  }
}

function resolveFace(bold: boolean, italic: boolean): MetricFace {
  if (bold && italic) return 'boldItalic';
  if (bold) return 'bold';
  if (italic) return 'italic';
  return 'regular';
}

/**
 * Measures a string against the vendored metrics.
 *
 * Deliberately kerning-free. The draw path sets `fontKerning = 'none'`, so what is painted
 * matches what is measured by construction rather than by hoping a table reproduces whatever
 * kerning the host's text stack applies.
 */
export function measureText(text: string, font: FontSpec): GlyphRunMetrics {
  const family = resolveMetricFamily(font.family);
  const face = FONT_METRICS[family][resolveFace(Boolean(font.bold), Boolean(font.italic))];
  const scale = font.sizePx / face.unitsPerEm;

  let units = 0;
  // Iterate by code point so astral characters consume one advance, not two.
  for (const character of text) {
    const codePoint = character.codePointAt(0);
    units += (codePoint != null ? face.advances[codePoint] : undefined) ?? face.defaultAdvance;
  }

  return {
    advance: units * scale,
    ascent: face.ascender * scale,
    // descender is negative in the font tables; report a positive distance.
    descent: -face.descender * scale,
    capHeight: face.capHeight * scale,
    xHeight: face.xHeight * scale,
  };
}

/** Convenience wrapper for callers that only need width. */
export function measureAdvance(text: string, font: FontSpec): number {
  return measureText(text, font).advance;
}

/**
 * Vertical metrics for a face, independent of any particular string.
 *
 * Use this in place of the absolute pixel floors that geometry code has historically used
 * (`Math.max(14, fontSize * 0.72)` and friends), which do not scale with bond length.
 */
export function getFaceMetrics(font: FontSpec): Omit<GlyphRunMetrics, 'advance'> {
  const metrics = measureText('', font);
  return {
    ascent: metrics.ascent,
    descent: metrics.descent,
    capHeight: metrics.capHeight,
    xHeight: metrics.xHeight,
  };
}

/**
 * The CSS font-family stack to paint with, so rendering uses the same face that was measured.
 * Falls back to the generic class if the vendored face somehow failed to load.
 */
export function getPaintFontFamily(family: string | null | undefined): string {
  switch (resolveMetricFamily(family)) {
    case 'serif':
      return "'Liberation Serif', serif";
    case 'mono':
      return "'Liberation Mono', monospace";
    default:
      return "'Liberation Sans', sans-serif";
  }
}
