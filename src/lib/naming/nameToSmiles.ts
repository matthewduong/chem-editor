/**
 * Name > Structure for systematic substitutive names (IUPAC 2013 style and the older forms
 * ChemDraw also reads): a chain, a cycloalkane or benzene; -ene/-yne locants; one principal
 * characteristic group as suffix (-oic acid, -al, -one, -ol, -amine, -nitrile,
 * -carboxylic acid, -carbaldehyde); and the common substituent prefixes, with di/tri/tetra.
 * Anything else is not recognised (null), never guessed. The result is SMILES; callers check it
 * with RDKit before drawing.
 */

export const STEMS: Record<string, number> = {
  meth: 1,
  eth: 2,
  prop: 3,
  but: 4,
  pent: 5,
  hex: 6,
  hept: 7,
  oct: 8,
  non: 9,
  dec: 10,
  undec: 11,
  dodec: 12,
};
export const STEM_BY_LENGTH = Object.fromEntries(
  Object.entries(STEMS).map(([stem, n]) => [n, stem]),
) as Record<number, string>;

/** Substituent prefixes as SMILES whose first atom bonds to the parent ("=O" bonds doubly). */
export const SUBSTITUENTS: Record<string, string> = {
  methyl: 'C',
  ethyl: 'CC',
  propyl: 'CCC',
  butyl: 'CCCC',
  pentyl: 'CCCCC',
  hexyl: 'CCCCCC',
  heptyl: 'CCCCCCC',
  octyl: 'CCCCCCCC',
  nonyl: 'CCCCCCCCC',
  decyl: 'CCCCCCCCCC',
  isopropyl: 'C(C)C',
  'propan-2-yl': 'C(C)C',
  'tert-butyl': 'C(C)(C)C',
  'sec-butyl': 'C(C)CC',
  isobutyl: 'CC(C)C',
  vinyl: 'C=C',
  ethenyl: 'C=C',
  ethynyl: 'C#C',
  phenyl: 'c1ccccc1',
  cyclopropyl: 'C1CC1',
  cyclobutyl: 'C1CCC1',
  cyclopentyl: 'C1CCCC1',
  cyclohexyl: 'C1CCCCC1',
  benzyl: 'Cc1ccccc1',
  fluoro: 'F',
  chloro: 'Cl',
  bromo: 'Br',
  iodo: 'I',
  hydroxy: 'O',
  amino: 'N',
  nitro: '[N+](=O)[O-]',
  oxo: '=O',
  methoxy: 'OC',
  ethoxy: 'OCC',
  cyano: 'C#N',
};

const MULTIPLIERS: Record<string, number> = { '': 1, di: 2, tri: 3, tetra: 4 };

/** Suffixes, longest first: the branch each puts on its carbon, and whether it ends a chain. */
const SUFFIXES: Array<{ text: string; branch: string[]; terminal: boolean; carbon?: boolean }> = [
  { text: 'carboxylic acid', branch: ['C(=O)O'], terminal: false, carbon: true },
  { text: 'carbaldehyde', branch: ['C=O'], terminal: false, carbon: true },
  { text: 'carbonitrile', branch: ['C#N'], terminal: false, carbon: true },
  { text: 'oic acid', branch: ['=O', 'O'], terminal: true },
  { text: 'nitrile', branch: ['#N'], terminal: true },
  { text: 'amine', branch: ['N'], terminal: false },
  { text: 'one', branch: ['=O'], terminal: false },
  { text: 'al', branch: ['=O'], terminal: true },
  { text: 'ol', branch: ['O'], terminal: false },
];

/** Names kept by IUPAC for substituted benzenes: the parent, and what sits at its position 1. */
const RETAINED: Record<string, string | null> = {
  benzene: null,
  phenol: 'O',
  aniline: 'N',
  toluene: 'C',
  'benzoic acid': 'C(=O)O',
  benzaldehyde: 'C=O',
  benzonitrile: 'C#N',
  anisole: 'OC',
};

const locantList = (text: string | undefined): number[] | null =>
  text ? text.split(',').map((part) => Number(part)) : null;

interface Parent {
  size: number;
  ring: 'none' | 'cyclo' | 'benzene';
  bonds: number[]; // bonds[i] joins atom i+1 and i+2 (and for rings the last joins n and 1)
  branches: string[][]; // per atom, 1-based index - 1
}

function addBranch(parent: Parent, locant: number, branch: string): boolean {
  if (!Number.isInteger(locant) || locant < 1 || locant > parent.size) return false;
  parent.branches[locant - 1]!.push(branch);
  return true;
}

function writeSmiles(parent: Parent): string {
  const atom = parent.ring === 'benzene' ? 'c' : 'C';
  const symbol = (order: number) => (order === 2 ? '=' : order === 3 ? '#' : '');
  let out = '';
  for (let i = 0; i < parent.size; i += 1) {
    if (i > 0) out += parent.ring === 'benzene' ? '' : symbol(parent.bonds[i - 1]!);
    out += atom;
    if (parent.ring !== 'none' && i === 0) out += '9';
    if (parent.ring !== 'none' && i === parent.size - 1) {
      out += `${parent.ring === 'benzene' ? '' : symbol(parent.bonds[parent.size - 1]!)}9`;
    }
    for (const branch of parent.branches[i]!) {
      out += `(${branch})`;
    }
  }
  return out;
}

/** Prefixes like "3-ethyl-2,4-dimethyl": each with its locants. */
function parsePrefixes(text: string): Array<{ name: string; locants: number[] | null }> | null {
  const out: Array<{ name: string; locants: number[] | null }> = [];
  let rest = text.replace(/-$/, '');
  const names = Object.keys(SUBSTITUENTS).sort((a, b) => b.length - a.length);
  while (rest.length) {
    const match = /^(?:([\d,]+)-)?(di|tri|tetra)?/.exec(rest)!;
    let after = rest.slice(match[0].length);
    const multiplier = MULTIPLIERS[match[2] ?? '']!;
    let name = names.find((candidate) => after.startsWith(candidate));
    // "di" may itself begin a name ("dimethyl" vs nothing) — try without the multiplier too.
    if (!name && match[2]) {
      after = rest.slice(match[1] ? match[1].length + 1 : 0);
      name = names.find((candidate) => after.startsWith(candidate));
      if (!name) return null;
      const locants = locantList(match[1]);
      out.push({ name, locants });
      rest = after.slice(name.length).replace(/^-/, '');
      continue;
    }
    if (!name) return null;
    const locants = locantList(match[1]);
    if (locants && locants.length !== multiplier) return null;
    for (let k = 0; k < multiplier; k += 1) {
      out.push({ name, locants: locants ? [locants[k]!] : null });
    }
    rest = after.slice(name.length).replace(/^-/, '');
  }
  return out;
}

export function nameToSmiles(input: string): string | null {
  let s = input.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return null;

  // Retained benzene parents, with prefixes before them ("4-nitrophenol").
  for (const [retained, first] of Object.entries(RETAINED).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    if (!s.endsWith(retained)) continue;
    const prefixes = parsePrefixes(s.slice(0, -retained.length));
    if (!prefixes) continue;
    const parent: Parent = {
      size: 6,
      ring: 'benzene',
      bonds: [],
      branches: [[], [], [], [], [], []],
    };
    if (first) parent.branches[0]!.push(first);
    if (!placePrefixes(parent, prefixes, first ? 2 : 1)) return null;
    return writeSmiles(parent);
  }

  // Suffix.
  let suffix: (typeof SUFFIXES)[number] | null = null;
  let suffixLocants: number[] | null = null;
  let suffixCount = 1;
  for (const candidate of SUFFIXES) {
    const re = new RegExp(`(?:-([\\d,]+)-)?(di|tri)?${candidate.text.replace(' ', ' ')}$`);
    const match = re.exec(s);
    if (!match) continue;
    // "-ol" must follow the parent's "an/en/yn"; "al" likewise.
    const before = s.slice(0, match.index);
    if (!/(an|en|yn|e|ane|ene|yne)$/.test(before) && !candidate.carbon) continue;
    suffix = candidate;
    suffixLocants = locantList(match[1]);
    suffixCount = MULTIPLIERS[match[2] ?? '']!;
    s = before;
    break;
  }
  if (suffix?.carbon) s = s.replace(/e$/, ''); // "cyclohexanecarboxylic acid"

  // Unsaturation and the parent stem.
  const parentMatch =
    /(cyclo)?(meth|eth|prop|but|pent|hex|hept|oct|non|undec|dodec|dec)(a)?(?:-([\d,]+)-)?(di|tri)?(an|en|yn)e?$/.exec(
      s,
    );
  if (!parentMatch) {
    if (s.endsWith('benzene') || s === 'benz') return null;
    return null;
  }
  const size = STEMS[parentMatch[2]!]!;
  const ring = parentMatch[1] ? 'cyclo' : 'none';
  if (ring === 'cyclo' && size < 3) return null;
  const parent: Parent = {
    size,
    ring,
    bonds: Array.from({ length: size }, () => 1),
    branches: Array.from({ length: size }, () => []),
  };
  let prefixText = s.slice(0, parentMatch.index);
  // Old style: a leading bare locant belongs to the suffix or the multiple bond ("2-propanol").
  let leading: number[] | null = null;
  const bare = /^([\d,]+)-$/.exec(prefixText);
  if (bare) {
    leading = locantList(bare[1]);
    prefixText = '';
  }
  const unsaturation = parentMatch[6]!;
  if (unsaturation !== 'an') {
    const count = MULTIPLIERS[parentMatch[5] ?? '']!;
    const locants =
      locantList(parentMatch[4]) ??
      (!suffix && leading ? leading : null) ??
      (count === 1 ? [1] : null);
    if (!locants || locants.length !== count) return null;
    for (const locant of locants) {
      const limit = ring === 'none' ? size - 1 : size;
      if (locant < 1 || locant > limit) return null;
      parent.bonds[locant - 1] = unsaturation === 'en' ? 2 : 3;
    }
    if (!suffix) leading = null;
  }

  if (suffix) {
    let locants = suffixLocants ?? leading;
    if (!locants) {
      if (suffix.terminal) locants = suffixCount === 2 ? [1, size] : [1];
      else if (suffix.text === 'one') locants = size >= 3 && ring === 'none' ? [2] : [1];
      else locants = [1];
    }
    if (locants.length !== suffixCount) return null;
    for (const locant of locants) {
      if (suffix.terminal && ring === 'none' && locant !== 1 && locant !== size) return null;
      for (const branch of suffix.branch) if (!addBranch(parent, locant, branch)) return null;
    }
  }

  const prefixes = parsePrefixes(prefixText);
  if (!prefixes) return null;
  if (!placePrefixes(parent, prefixes, 1)) return null;
  return writeSmiles(parent);
}

function placePrefixes(
  parent: Parent,
  prefixes: Array<{ name: string; locants: number[] | null }>,
  firstFree: number,
): boolean {
  let next = firstFree;
  for (const { name, locants } of prefixes) {
    const locant = locants?.[0] ?? next++;
    if (!addBranch(parent, locant, SUBSTITUENTS[name]!)) return false;
  }
  return true;
}
