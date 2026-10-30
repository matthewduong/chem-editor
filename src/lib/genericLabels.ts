/**
 * Generic labels (ChemDraw 17.1 guide, "Generic Labels"): the labels recognised as chemically
 * significant query atoms. A, M, Q, X and R are ChemDraw's own; the rest are the Reaxys set the
 * guide lists. R takes a number or primes (R1, R', R'') and stays the generic R, which is how
 * ChemDraw 23 writes it: `NodeType="GenericNickname" GenericNickname="R"` under an "R1" label.
 */
export const GENERIC_NICKNAMES: ReadonlySet<string> = new Set([
  'A',
  'M',
  'Q',
  'X',
  'R',
  // Reaxys.
  'AH',
  'MH',
  'QH',
  'XH',
  'G',
  'GH',
  'G*',
  'GH*',
  'ACY',
  'ACH',
  'ABC',
  'ABH',
  'AYL',
  'AYH',
  'ALK',
  'ALH',
  'AEL',
  'AEH',
  'AHC',
  'AHH',
  'AOX',
  'AOH',
  'CYC',
  'CYH',
  'CBC',
  'CBH',
  'ARY',
  'ARH',
  'CAL',
  'CAH',
  'CEL',
  'CEH',
  'CHC',
  'CHH',
  'HAR',
  'HAH',
  'CXX',
  'CXH',
]);

/** The generic a label stands for (`R` for R1 or R'), or null when it is not generic. */
export function genericNicknameBase(label: string | undefined): string | null {
  const text = label?.trim();
  if (!text) return null;
  if (GENERIC_NICKNAMES.has(text)) return text;
  return /^R(?:\d+|'+|′+|")$/.test(text) ? 'R' : null;
}
