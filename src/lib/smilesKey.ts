/**
 * A structure key for the small, rooted SMILES strings used for shorthand groups.
 *
 * Two spellings of the same substituent (`N(CC)` and `NCC`, or the same branches in another
 * order) must compare equal, or alias resolution reports them as an ambiguity
 * between two different structures. The key is a Weisfeiler-Lehman refinement over element,
 * charge, bond order and the root atom, so it ignores branch order and ring-closure numbering. It
 * is not a canonical SMILES and two different molecules can in principle collide; it is only used
 * to decide that two spellings from the same label are the same.
 */
const TOKEN = /\[[^\]]+\]|Cl|Br|Si|Sn|Se|Li|Na|[BCNOPSFIHbcnops]|=|#|\(|\)|%\d\d|[0-9]|-|\.|\/|\\/g;

interface Graph {
  atoms: string[];
  bonds: Array<[number, number, number]>;
}

function parse(smiles: string): Graph {
  const atoms: string[] = [];
  const bonds: Array<[number, number, number]> = [];
  const stack: Array<number | null> = [];
  const rings = new Map<string, { atom: number; order: number }>();
  let last: number | null = null;
  let order = 1;
  for (const token of smiles.match(TOKEN) ?? []) {
    if (token === '=') order = 2;
    else if (token === '#') order = 3;
    else if (token === '(') stack.push(last);
    else if (token === ')') last = stack.pop() ?? null;
    else if (token === '-' || token === '/' || token === '\\') continue;
    else if (token === '.') last = null;
    else if (/^[0-9]$/.test(token) || token.startsWith('%')) {
      const open = rings.get(token);
      if (open && last !== null) {
        bonds.push([open.atom, last, Math.max(open.order, order)]);
        rings.delete(token);
      } else if (last !== null) rings.set(token, { atom: last, order });
      order = 1;
    } else {
      // Explicit hydrogens carry no structure for a substituent key.
      if (token === '[H]') continue;
      // Aromatic lower case and bracket H counts are normalised away; charge and isotope stay.
      const label = token.startsWith('[')
        ? token.replace(/@+/g, '').replace(/H\d*/g, '').toLowerCase() === token.toLowerCase()
          ? token
          : token.replace(/@+/g, '').replace(/(?<![A-Za-z])H\d*/g, '')
        : token;
      atoms.push(label.toUpperCase());
      const index = atoms.length - 1;
      if (last !== null) bonds.push([last, index, order]);
      order = 1;
      last = index;
    }
  }
  return { atoms, bonds };
}

export function smilesStructureKey(smiles: string): string {
  const { atoms, bonds } = parse(smiles);
  const neighbours: Array<Array<{ to: number; order: number }>> = atoms.map(() => []);
  // Orders inside rings are dropped, so an aromatic ring and its Kekule spelling share a key;
  // orders on bonds outside rings are kept, which is what tells allyl from propenyl.
  const inRing = bonds.map(([a, b], skip) => {
    const seen = new Set<number>([a]);
    const stack = [a];
    while (stack.length) {
      const at = stack.pop()!;
      bonds.forEach(([x, y], i) => {
        if (i === skip) return;
        const next = x === at ? y : y === at ? x : -1;
        if (next >= 0 && !seen.has(next)) {
          seen.add(next);
          stack.push(next);
        }
      });
    }
    return seen.has(b);
  });
  bonds.forEach(([a, b, order], i) => {
    const o = inRing[i] ? 0 : order;
    neighbours[a]!.push({ to: b, order: o });
    neighbours[b]!.push({ to: a, order: o });
  });
  let colours = atoms.map((atom, i) => (i === 0 ? `*${atom}` : atom));
  for (let round = 0; round < 5; round += 1) {
    colours = colours.map((colour, i) => {
      const around = neighbours[i]!.map((n) => `${n.order}${colours[n.to]}`).sort();
      return `${colour}(${around.join(',')})`;
    });
    // keep strings short with a stable hash, so keys compare across molecules
    colours = colours.map(hash);
  }
  return `${atoms.length}:${bonds.length}:${[...colours].sort().join('|')}:${colours[0] ?? ''}`;
}

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
