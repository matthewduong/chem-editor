import { COMPOUND_DATA } from '../compounds';
import { nameToSmiles } from './nameToSmiles';

export { nameToSmiles } from './nameToSmiles';
export { structureToName } from './structureToName';

/**
 * Name > Structure: a compound's own name or acronym from the compound table ("N,N-
 * dimethylformamide", "DMF"), else a systematic name `nameToSmiles` reads. SMILES, or null.
 */
export function resolveNameToSmiles(name: string): string | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const compound = COMPOUND_DATA.find(
    (entry) =>
      entry.name.toLowerCase() === wanted ||
      entry.labels.some((label) => label.toLowerCase() === wanted),
  );
  return compound?.smiles ?? nameToSmiles(wanted);
}
