import { ELEMENTS } from './elements';

/**
 * The Analysis window's derived values (ChemDraw 17.1 guide, "Structure Analysis"): elemental
 * analysis as percent by weight of each element, and m/z as the masses of the most common isotope
 * combinations with their abundance. Both are computed from the molecular formula.
 */

export interface ParsedFormula {
  counts: Record<string, number>;
  charge: number;
}

/** Reads a Hill formula as RDKit's CalcMolFormula writes it, e.g. `C6H5O-` or `C2H8N+2`. */
export function parseFormula(formula: string): ParsedFormula | null {
  const match = /^((?:[A-Z][a-z]?\d*)+)([+-]\d*)?$/.exec(formula.trim());
  if (!match) return null;
  const counts: Record<string, number> = {};
  for (const [, symbol, digits] of match[1]!.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    if (!ELEMENTS[symbol!]) return null;
    counts[symbol!] = (counts[symbol!] ?? 0) + (digits ? Number(digits) : 1);
  }
  const sign = match[2];
  const charge = sign
    ? (sign[0] === '-' ? -1 : 1) * (sign.length > 1 ? Number(sign.slice(1)) : 1)
    : 0;
  return { counts, charge };
}

/** Hill order: carbon, then hydrogen, then the rest alphabetically (no carbon: all alphabetical). */
function hillOrder(symbols: string[]): string[] {
  const hasCarbon = symbols.includes('C');
  return [...symbols].sort((a, b) => {
    const rank = (s: string) => (hasCarbon ? (s === 'C' ? 0 : s === 'H' ? 1 : 2) : 2);
    return rank(a) - rank(b) || a.localeCompare(b);
  });
}

/** Percent by weight of each element, in Hill order. */
export function elementalAnalysis(
  counts: Record<string, number>,
): Array<{ element: string; percent: number }> {
  const symbols = Object.keys(counts).filter((symbol) => counts[symbol]! > 0);
  const total = symbols.reduce((sum, s) => sum + ELEMENTS[s]!.weight * counts[s]!, 0);
  if (total <= 0) return [];
  return hillOrder(symbols).map((element) => ({
    element,
    percent: (100 * ELEMENTS[element]!.weight * counts[element]!) / total,
  }));
}

/** ChemDraw's elemental analysis line: `C, 40.00; H, 6.71; O, 53.29`. */
export function formatElementalAnalysis(counts: Record<string, number>, decimals = 2): string {
  return elementalAnalysis(counts)
    .map(({ element, percent }) => `${element}, ${percent.toFixed(decimals)}`)
    .join('; ');
}

/**
 * Isotope masses and natural abundances (NIST, "Atomic Weights and Isotopic Compositions") for
 * the elements whose minor isotopes show in a mass spectrum. Any other element counts as its
 * most abundant isotope only.
 */
const ISOTOPES: Record<string, Array<[mass: number, abundance: number]>> = {
  H: [
    [1.00782503207, 0.999885],
    [2.0141017778, 0.000115],
  ],
  B: [
    [10.012937, 0.199],
    [11.0093054, 0.801],
  ],
  C: [
    [12, 0.9893],
    [13.0033548378, 0.0107],
  ],
  N: [
    [14.0030740048, 0.99636],
    [15.0001088982, 0.00364],
  ],
  O: [
    [15.99491461956, 0.99757],
    [16.9991317, 0.00038],
    [17.999161, 0.00205],
  ],
  Si: [
    [27.9769265325, 0.92223],
    [28.9764947, 0.04685],
    [29.97377017, 0.03092],
  ],
  S: [
    [31.972071, 0.9499],
    [32.97145876, 0.0075],
    [33.9678669, 0.0425],
    [35.96708076, 0.0001],
  ],
  Cl: [
    [34.96885268, 0.7576],
    [36.96590259, 0.2424],
  ],
  K: [
    [38.96370668, 0.932581],
    [40.96182576, 0.067302],
  ],
  Br: [
    [78.9183371, 0.5069],
    [80.9162906, 0.4931],
  ],
};

/** The electron's mass in Da (CODATA 2018). */
const ELECTRON_MASS = 0.000548579909;

export interface MassPeak {
  mz: number;
  /** Abundance relative to the largest peak, in percent. */
  relative: number;
}

/**
 * The isotope peaks of a formula, one per nominal mass, each at its abundance-weighted mass and
 * divided by the charge (less the electrons a cation lost), down to `threshold` percent of the
 * largest. A neutral formula is reported as its mass.
 */
export function isotopePeaks(parsed: ParsedFormula, threshold = 1): MassPeak[] {
  // Distribution by nominal-mass offset: [probability, probability-weighted mass].
  let distribution = new Map<number, [number, number]>([[0, [1, 0]]]);
  for (const [element, count] of Object.entries(parsed.counts)) {
    const isotopes = ISOTOPES[element] ?? [[ELEMENTS[element]!.exact, 1] as [number, number]];
    const base = isotopes.reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0];
    for (let i = 0; i < count; i += 1) {
      const next = new Map<number, [number, number]>();
      for (const [offset, [p, weighted]] of distribution) {
        const mean = weighted / p;
        for (const [mass, abundance] of isotopes) {
          const key = offset + Math.round(mass - base);
          const probability = p * abundance;
          if (probability < 1e-12) continue;
          const entry = next.get(key) ?? [0, 0];
          entry[0] += probability;
          entry[1] += probability * (mean + mass);
          next.set(key, entry);
        }
      }
      distribution = next;
    }
  }
  const largest = Math.max(...[...distribution.values()].map(([p]) => p));
  const z = Math.abs(parsed.charge) || 1;
  return [...distribution.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, [p, weighted]]) => ({
      mz: (weighted / p - parsed.charge * ELECTRON_MASS) / z,
      relative: (100 * p) / largest,
    }))
    .filter((peak) => peak.relative >= threshold);
}

/** ChemDraw's m/z line: `180.06 (100.0%), 181.07 (6.5%), 182.07 (1.2%)`. */
export function formatMassPeaks(peaks: readonly MassPeak[], decimals = 2): string {
  return peaks
    .map((peak) => `${peak.mz.toFixed(decimals)} (${peak.relative.toFixed(1)}%)`)
    .join(', ');
}
