import { useStore } from '../store';
import type { Arrow, Atom, Bond, TextBox } from '../types/chemistry';
import type { PageSetup } from '../types/settings';
import { generateCanvasSVGWithContext } from './svgExport';

/**
 * Store-bound entry point for SVG export. `svgExport.ts` itself is store-free so it can run
 * headless; anything that wants "the live document's settings" goes through here instead.
 */
export function generateCanvasSVG(
  atoms: Atom[],
  bonds: Bond[],
  arrows: Arrow[],
  isDarkMode: boolean,
  transparent = false,
  textBoxes: TextBox[] = [],
  pageSetup?: PageSetup,
): string {
  const { documentStyleSettings, documentViewSettings, chemDrawDocument } = useStore.getState();
  return generateCanvasSVGWithContext(atoms, bonds, arrows, {
    chemDrawDocument,
    documentStyleSettings,
    documentViewSettings,
    isDarkMode,
    transparent,
    textBoxes,
    pageSetup,
  });
}
