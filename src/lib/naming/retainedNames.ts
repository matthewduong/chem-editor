import { smilesUnrootedKey } from '../smilesKey';

/**
 * Names ChemDraw gives a whole molecule that are not the systematic name `structureToName` would
 * build: retained and trivial names (acetaldehyde, formic acid, o-xylene, methyl acetate,
 * chloroform, pyridine, THF ...), measured with Structure > Convert Structure to Name on
 * ChemDraw 26.1.0.6801 over 150 structures (gaps.md). Matched on the whole structure, so
 * "propan-2-one" (what ChemDraw says for acetone) and "butan-2-one" still come from the
 * systematic path.
 *
 * Each row is [SMILES, name, unsaturation]: the unsaturation (the sum of bond orders less one, in
 * a Kekule form) tells a ring from its saturated twin, which the structure key alone cannot
 * (pyridine and piperidine share one).
 */
export const RETAINED_MOLECULE_NAMES: ReadonlyArray<readonly [string, string, number]> = [
  ['O=C(O)CCCCC(=O)O', 'adipic acid', 2],
  ['C=CC=O', 'acrylaldehyde', 2],
  ['C=CC(=O)O', 'acrylic acid', 2],
  ['CCCC#N', 'butyronitrile', 2],
  ['CCC(N)=O', 'propionamide', 1],
  ['CC(N)C(=O)O', 'alanine', 1],
  ['O=C(O)CO', '2-hydroxyacetic acid', 1],
  ['O=C(O)CC(O)C(=O)O', '2-hydroxysuccinic acid', 2],
  ['Cc1ccc(O)cc1', 'p-cresol', 3],
  ['Cc1ccc(N)cc1', 'p-toluidine', 3],
  ['Oc1ccccc1O', 'pyrocatechol', 3],
  ['Nc1ccccc1N', 'benzene-1,2-diamine', 3],
  ['FC(F)(F)c1ccccc1', '(trifluoromethyl)benzene', 3],
  ['CC(=O)O', 'acetic acid', 1],
  ['CC=O', 'acetaldehyde', 1],
  ['CC(N)=O', 'acetamide', 1],
  ['CC#N', 'acetonitrile', 2],
  ['CC(=O)c1ccccc1', 'acetophenone', 4],
  ['N', 'ammonia', 0],
  ['COc1ccccc1', 'anisole', 3],
  ['CCCC=O', 'butyraldehyde', 1],
  ['CCCC(=O)O', 'butyric acid', 1],
  ['ClC(Cl)Cl', 'chloroform', 0],
  ['CC(C)c1ccccc1', 'cumene', 3],
  ['N#CC#N', 'cyanogen', 4],
  ['CCNCC', 'diethylamine', 0],
  ['CNC', 'dimethylamine', 0],
  ['CCOC(C)=O', 'ethyl acetate', 1],
  ['C=O', 'formaldehyde', 1],
  ['NC=O', 'formamide', 1],
  ['O=CO', 'formic acid', 1],
  ['c1ccoc1', 'furan', 2],
  ['CC(C)C', 'isobutane', 0],
  ['CC(C)C(=O)O', 'isobutyric acid', 1],
  ['CCC(C)C', 'isopentane', 0],
  ['Cc1cccc(C)c1', 'm-xylene', 3],
  ['COC(C)=O', 'methyl acetate', 1],
  ['c1ccc2ccccc2c1', 'naphthalene', 5],
  ['CC(C)(C)C', 'neopentane', 0],
  ['Cc1ccccc1C', 'o-xylene', 3],
  ['O=CC=O', 'oxalaldehyde', 2],
  ['O=C(O)C(=O)O', 'oxalic acid', 2],
  ['Cc1ccc(C)cc1', 'p-xylene', 3],
  ['C1CCNCC1', 'piperidine', 0],
  ['CCC=O', 'propionaldehyde', 1],
  ['CCC(=O)O', 'propionic acid', 1],
  ['CCC#N', 'propiononitrile', 2],
  ['c1ccncc1', 'pyridine', 3],
  ['C1CCOC1', 'tetrahydrofuran', 0],
  ['c1ccsc1', 'thiophene', 2],
  ['CN(C)C', 'trimethylamine', 0],
  ['NC(N)=O', 'urea', 1],
];

/** The retained name for a whole molecule's lookup key (structure key plus unsaturation). */
export function retainedNameFor(key: string, unsaturation: number): string | null {
  return RETAINED_BY_KEY.get(`${key}|${unsaturation}`) ?? null;
}

/** The SMILES of a retained name, so a caller can read a name back. */
export function retainedNameToSmiles(name: string): string | null {
  return RETAINED_BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

const RETAINED_BY_KEY = new Map(
  RETAINED_MOLECULE_NAMES.map(([smiles, name, unsaturation]) => [
    `${smilesUnrootedKey(smiles)}|${unsaturation}`,
    name,
  ]),
);
const RETAINED_BY_NAME = new Map(
  RETAINED_MOLECULE_NAMES.map(([smiles, name]) => [name.toLowerCase(), smiles]),
);
