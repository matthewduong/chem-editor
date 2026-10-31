/**
 * A saved colour palette (ChemDraw 17.1 guide, "Working with Color"): colours the user keeps,
 * offered by every drawing colour picker alongside ChemDraw's eight defaults. Hex, lower case,
 * no repeats, at most `MAX_PALETTE_COLORS`.
 */
export const MAX_PALETTE_COLORS = 24;

/** ChemDraw's default colour table (black, white, red, yellow, green, cyan, blue, magenta). */
export const CHEMDRAW_DEFAULT_COLORS = [
  '#000000',
  '#ffffff',
  '#ff0000',
  '#ffff00',
  '#00ff00',
  '#00ffff',
  '#0000ff',
  '#ff00ff',
];

/** The id of the one `<datalist>` every drawing colour picker suggests from. */
export const PALETTE_DATALIST_ID = 'chem-color-palette';

export function normalizeColorPalette(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !/^#[0-9a-f]{6}$/i.test(entry)) continue;
    const color = entry.toLowerCase();
    if (!out.includes(color)) out.push(color);
    if (out.length === MAX_PALETTE_COLORS) break;
  }
  return out;
}

/** The palette with `color` added at the front (moved there if already present). */
export function addPaletteColor(palette: readonly string[], color: string): string[] {
  return normalizeColorPalette([color, ...palette]);
}
