import type { Atom, Bond } from '../../types/chemistry';
import { getAtomAlias, getAtomLeadElement } from '../atomIdentity';
import { selectionToRootedSmiles } from '../nicknames';
import { smilesStructureKey } from '../smilesKey';
import { STEM_BY_LENGTH, SUBSTITUENTS } from './nameToSmiles';

/**
 * Structure > Name for the class `nameToSmiles` reads back: one chain, cycloalkane or benzene
 * parent with simple substituents and at most one kind of principal group. The parent and its
 * numbering follow IUPAC 2013 in the order that class needs: most principal groups, a ring over
 * a chain, the longest chain, the most multiple bonds, the most substituents, then lowest
 * locants for principal groups, multiple bonds and prefixes, then the first prefix in
 * alphabetical order. The caller checks every name by reading it back; anything outside the
 * class gives null, never a guess.
 */

type Group = 'acid' | 'nitrile' | 'aldehyde' | 'ketone' | 'alcohol' | 'amine';
const RANK: Record<Group, number> = {
  acid: 6,
  nitrile: 5,
  aldehyde: 4,
  ketone: 3,
  alcohol: 2,
  amine: 1,
};
const SUFFIX_TEXT: Record<Group, string> = {
  acid: 'oic acid',
  nitrile: 'nitrile',
  aldehyde: 'al',
  ketone: 'one',
  alcohol: 'ol',
  amine: 'amine',
};
const RING_SUFFIX: Partial<Record<Group, string>> = {
  acid: 'carboxylic acid',
  nitrile: 'carbonitrile',
  aldehyde: 'carbaldehyde',
};
const BENZENE_RETAINED: Partial<Record<Group, string>> = {
  alcohol: 'phenol',
  amine: 'aniline',
  acid: 'benzoic acid',
  aldehyde: 'benzaldehyde',
  nitrile: 'benzonitrile',
};
const MULTIPLY = ['', '', 'di', 'tri', 'tetra'];

interface Graph {
  ids: string[];
  element: Map<string, string>;
  charge: Map<string, number>;
  adjacency: Map<string, Array<{ id: string; order: number }>>;
}

/** Keys of the substituent prefixes, with the bond order each attaches by. */
let prefixKeys: Array<{ name: string; key: string; order: number }> | null = null;
function substituentKeys() {
  prefixKeys ??= Object.entries(SUBSTITUENTS)
    .filter(([name]) => !name.includes('-yl') || name === 'tert-butyl' || name === 'sec-butyl')
    .map(([name, smiles]) => ({
      name,
      key: smilesStructureKey(smiles.replace(/^=/, '')),
      order: smiles.startsWith('=') ? 2 : 1,
    }));
  return prefixKeys;
}

function order(graph: Graph, a: string, b: string): number {
  return graph.adjacency.get(a)?.find((entry) => entry.id === b)?.order ?? 0;
}

/** The atoms reached from `start` without entering `blocked`. */
function reach(graph: Graph, start: string, blocked: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || blocked.has(id)) continue;
    seen.add(id);
    for (const next of graph.adjacency.get(id) ?? []) stack.push(next.id);
  }
  return seen;
}

export function structureToName(atoms: readonly Atom[], bonds: readonly Bond[]): string | null {
  const heavy = atoms.filter((atom) => getAtomLeadElement(atom) !== 'H');
  if (heavy.length === 0 || heavy.some((atom) => getAtomAlias(atom))) return null;
  const allowed = new Set(['C', 'N', 'O', 'F', 'Cl', 'Br', 'I']);
  if (heavy.some((atom) => !allowed.has(getAtomLeadElement(atom)))) return null;
  const graph: Graph = {
    ids: heavy.map((atom) => atom.id),
    element: new Map(heavy.map((atom) => [atom.id, getAtomLeadElement(atom)])),
    charge: new Map(heavy.map((atom) => [atom.id, atom.charge ?? 0])),
    adjacency: new Map(heavy.map((atom) => [atom.id, []])),
  };
  const heavyBonds = bonds.filter(
    (bond) => graph.adjacency.has(bond.from) && graph.adjacency.has(bond.to),
  );
  for (const bond of heavyBonds) {
    const value = bond.order === 1.5 ? 1.5 : Math.round(bond.order || 1);
    graph.adjacency.get(bond.from)!.push({ id: bond.to, order: value });
    graph.adjacency.get(bond.to)!.push({ id: bond.from, order: value });
  }
  if (reach(graph, graph.ids[0]!, new Set()).size !== graph.ids.length) return null;
  const cycles = heavyBonds.length - graph.ids.length + 1;
  if (cycles > 1) return null;
  const isC = (id: string) => graph.element.get(id) === 'C';
  const terminal = (id: string, element: string) =>
    graph.element.get(id) === element &&
    (graph.adjacency.get(id)?.length ?? 0) === 1 &&
    (graph.charge.get(id) ?? 0) === 0;

  // The ring, by stripping leaves until none are left.
  let ring: string[] = [];
  if (cycles === 1) {
    const degree = new Map(graph.ids.map((id) => [id, graph.adjacency.get(id)!.length]));
    const removed = new Set<string>();
    let changed = true;
    while (changed) {
      changed = false;
      for (const id of graph.ids) {
        if (removed.has(id) || degree.get(id)! > 1) continue;
        removed.add(id);
        for (const next of graph.adjacency.get(id)!) {
          degree.set(next.id, degree.get(next.id)! - 1);
        }
        changed = true;
      }
    }
    const members = graph.ids.filter((id) => !removed.has(id));
    if (members.length < 3 || members.length > 8 || !members.every(isC)) return null;
    // In cyclic order.
    ring = [members[0]!];
    while (ring.length < members.length) {
      const last = ring[ring.length - 1]!;
      const next = graph.adjacency
        .get(last)!
        .map((entry) => entry.id)
        .find((id) => members.includes(id) && !ring.includes(id));
      if (!next) return null;
      ring.push(next);
    }
  }
  const ringSet = new Set(ring);
  const ringOrders = ring.map((id, i) => order(graph, id, ring[(i + 1) % ring.length]!));
  const isBenzene =
    ring.length === 6 &&
    (ringOrders.every((o) => o === 1.5) ||
      (ringOrders.every((o, i) => o === (i % 2 === 0 ? ringOrders[0] : ringOrders[1])) &&
        new Set(ringOrders).size === 2 &&
        ringOrders.includes(2) &&
        ringOrders.includes(1)));

  // Principal characteristic groups, by the carbon that carries each.
  const groupAt = new Map<string, { group: Group; used: string[] }>();
  for (const id of graph.ids) {
    if (!isC(id)) continue;
    const near = graph.adjacency.get(id)!;
    const doubleO = near.filter((n) => n.order === 2 && terminal(n.id, 'O')).map((n) => n.id);
    const singleO = near.filter((n) => n.order === 1 && terminal(n.id, 'O')).map((n) => n.id);
    const tripleN = near.filter((n) => n.order === 3 && terminal(n.id, 'N')).map((n) => n.id);
    const singleN = near.filter((n) => n.order === 1 && terminal(n.id, 'N')).map((n) => n.id);
    const carbons = near.filter((n) => isC(n.id)).length;
    if (ringSet.has(id) && (doubleO.length || tripleN.length) && isBenzene) return null;
    if (doubleO.length === 1 && singleO.length === 1 && carbons <= 1) {
      groupAt.set(id, { group: 'acid', used: [doubleO[0]!, singleO[0]!] });
    } else if (tripleN.length === 1 && carbons <= 1) {
      groupAt.set(id, { group: 'nitrile', used: tripleN });
    } else if (doubleO.length === 1 && carbons <= 1 && near.length === 2) {
      groupAt.set(id, { group: 'aldehyde', used: doubleO });
    } else if (doubleO.length === 1 && carbons === 2 && near.length === 3) {
      groupAt.set(id, { group: 'ketone', used: doubleO });
    } else if (singleO.length >= 1 && doubleO.length === 0) {
      groupAt.set(id, { group: 'alcohol', used: singleO });
    } else if (singleN.length >= 1 && doubleO.length === 0) {
      groupAt.set(id, { group: 'amine', used: singleN });
    }
  }
  const top = [...groupAt.values()].reduce<Group | null>(
    (best, entry) => (!best || RANK[entry.group] > RANK[best] ? entry.group : best),
    null,
  );
  const anchors = [...groupAt.entries()].filter(([, entry]) => entry.group === top);

  const ringAnchorsOk = anchors.every(([id, entry]) => {
    if (ringSet.has(id))
      return entry.group !== 'acid' && entry.group !== 'nitrile' && entry.group !== 'aldehyde';
    // A carbon-based group hanging on the ring ("-carboxylic acid").
    return (
      Boolean(RING_SUFFIX[entry.group]) &&
      graph.adjacency.get(id)!.some((n) => ringSet.has(n.id)) &&
      graph.adjacency.get(id)!.length === entry.used.length + 1
    );
  });
  if (ring.length && (anchors.length === 0 || ringAnchorsOk)) {
    return nameRingParent(graph, ring, isBenzene, top, anchors);
  }
  const chainSet = graph.ids.filter((id) => isC(id) && !ringSet.has(id));
  if (anchors.some(([id]) => ringSet.has(id))) return null;
  return nameChainParent(graph, chainSet, ringSet, isBenzene, top, anchors);
}

/** A branch named as a prefix, or null. */
function prefixFor(
  graph: Graph,
  from: string,
  root: string,
  blocked: ReadonlySet<string>,
  ringSet: ReadonlySet<string>,
  isBenzene: boolean,
): string | null {
  const members = reach(graph, root, blocked);
  const atoms: Atom[] = [...members].map((id) => ({
    id,
    x: 0,
    y: 0,
    kind: 'element',
    element: graph.element.get(id)!,
    ...(graph.charge.get(id) ? { charge: graph.charge.get(id) } : {}),
  }));
  const inner: Bond[] = [];
  for (const id of members) {
    for (const next of graph.adjacency.get(id)!) {
      if (members.has(next.id) && id < next.id) {
        inner.push({
          id: `${id}-${next.id}`,
          from: id,
          to: next.id,
          order: next.order === 1.5 ? 1 : next.order,
        });
      }
    }
  }
  const key = smilesStructureKey(selectionToRootedSmiles(atoms, inner, members, root));
  const attach = order(graph, from, root);
  const match = substituentKeys().filter((entry) => entry.key === key && entry.order === attach);
  if (!match.length) return null;
  // The key cannot tell an aromatic ring from a saturated one.
  const ringInBranch = [...members].some((id) => ringSet.has(id));
  const name =
    match.find((entry) =>
      ringInBranch ? isBenzene === (entry.name === 'phenyl' || entry.name === 'benzyl') : true,
    )?.name ?? null;
  return name;
}

interface Candidate {
  score: Array<number | number[] | string>;
  name: string;
}

function better(a: Candidate['score'], b: Candidate['score']): boolean {
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    if (Array.isArray(x) && Array.isArray(y)) {
      for (let j = 0; j < Math.max(x.length, y.length); j += 1) {
        const p = x[j] ?? Infinity;
        const q = y[j] ?? Infinity;
        if (p !== q) return p < q;
      }
    } else if (x !== y) return x < y;
  }
  return false;
}

function prefixString(
  items: Array<{ name: string; locant: number }>,
  showLocants: boolean,
): string | null {
  const groups = new Map<string, number[]>();
  for (const item of items) groups.set(item.name, [...(groups.get(item.name) ?? []), item.locant]);
  const sortKey = (name: string) => name.replace(/^(tert|sec)-/, '');
  const parts: string[] = [];
  for (const name of [...groups.keys()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)))) {
    const locants = groups.get(name)!.sort((a, b) => a - b);
    if (locants.length > 4) return null;
    const multiplied = `${MULTIPLY[locants.length]}${name}`;
    parts.push(showLocants ? `${locants.join(',')}-${multiplied}` : multiplied);
  }
  return parts.join('-');
}

/** Lowest locants of prefixes in alphabetical order, for the last tie-break. */
function alphabeticalLocants(items: Array<{ name: string; locant: number }>): number[] {
  return [...items]
    .sort((a, b) =>
      a.name.replace(/^(tert|sec)-/, '').localeCompare(b.name.replace(/^(tert|sec)-/, '')),
    )
    .map((item) => item.locant);
}

function nameRingParent(
  graph: Graph,
  ring: string[],
  isBenzene: boolean,
  top: Group | null,
  anchors: Array<[string, { group: Group; used: string[] }]>,
): string | null {
  const ringSet = new Set(ring);
  const n = ring.length;
  // Where each principal group sits: its ring atom.
  const anchorRingAtom = new Map<string, string>();
  for (const [id] of anchors) {
    anchorRingAtom.set(
      ringSet.has(id) ? id : graph.adjacency.get(id)!.find((x) => ringSet.has(x.id))!.id,
      id,
    );
  }
  let best: Candidate | null = null;
  for (let start = 0; start < n; start += 1) {
    for (const direction of [1, -1]) {
      const at = (i: number) => ring[(((start + direction * i) % n) + n) % n]!;
      const locantOf = new Map(Array.from({ length: n }, (_, i) => [at(i), i + 1]));
      const principal: number[] = [];
      const prefixes: Array<{ name: string; locant: number }> = [];
      let failed = false;
      for (let i = 0; i < n && !failed; i += 1) {
        const id = at(i);
        const anchor = anchorRingAtom.get(id);
        if (anchor) principal.push(i + 1);
        for (const next of graph.adjacency.get(id)!) {
          if (ringSet.has(next.id)) continue;
          if (anchor && anchor !== id && next.id === anchor) continue;
          if (anchor === id && anchors.find(([a]) => a === id)![1].used.includes(next.id)) continue;
          const name = prefixFor(graph, id, next.id, ringSet, ringSet, isBenzene);
          if (!name) failed = true;
          else prefixes.push({ name, locant: i + 1 });
        }
      }
      if (failed) continue;
      // Multiple bonds in a cycloalkane ring, by the lower locant of each.
      const unsaturation: number[] = [];
      if (!isBenzene) {
        for (let i = 0; i < n; i += 1) {
          const o = order(graph, at(i), at((i + 1) % n));
          if (o === 2) unsaturation.push(i + 1);
          else if (o !== 1) return null;
        }
      }
      principal.sort((a, b) => a - b);
      unsaturation.sort((a, b) => a - b);
      const prefixLocants = prefixes.map((p) => p.locant).sort((a, b) => a - b);
      const score: Candidate['score'] = [
        principal,
        unsaturation,
        prefixLocants,
        alphabeticalLocants(prefixes),
      ];
      // Assemble.
      const retained = isBenzene && top ? BENZENE_RETAINED[top] : undefined;
      if (isBenzene && top && (!retained || principal.length !== 1 || principal[0] !== 1)) continue;
      const itemCount = prefixes.length + principal.length + unsaturation.length;
      const showLocants = itemCount > 1 || (prefixes.length > 0 && principal.length > 0);
      const prefixText = prefixString(prefixes, showLocants);
      if (prefixText === null) continue;
      let name: string;
      if (isBenzene) {
        const onlyMethyl = !top && prefixes.length === 1 && prefixes[0]!.name === 'methyl';
        name = onlyMethyl ? 'toluene' : `${prefixText}${retained ?? 'benzene'}`;
        void locantOf;
      } else {
        const stem = STEM_BY_LENGTH[n];
        if (!stem || unsaturation.length > 1) return null;
        const unsat =
          unsaturation.length === 0
            ? 'an'
            : `${showLocants && unsaturation[0] !== 1 ? `-${unsaturation[0]}-` : ''}en`;
        if (!top) name = `${prefixText}cyclo${stem}${unsat}e`;
        else {
          const ringSuffix = RING_SUFFIX[top];
          if (ringSuffix) name = `${prefixText}cyclo${stem}${unsat}e${ringSuffix}`;
          else {
            const suffix = SUFFIX_TEXT[top];
            const counted = `${MULTIPLY[principal.length]}${suffix}`;
            const locants = showLocants ? `-${principal.join(',')}-` : '';
            const elide = /^[aeiouy]/.test(counted) && !locants;
            name = `${prefixText}cyclo${stem}${unsat}${elide ? '' : locants ? '' : 'e'}${locants}${counted}`;
          }
        }
      }
      if (!best || better(score, best.score)) best = { score, name };
    }
  }
  return best?.name ?? null;
}

function nameChainParent(
  graph: Graph,
  chainCarbons: string[],
  ringSet: ReadonlySet<string>,
  isBenzene: boolean,
  top: Group | null,
  anchors: Array<[string, { group: Group; used: string[] }]>,
): string | null {
  const inChain = new Set(chainCarbons);
  const anchorIds = new Set(anchors.map(([id]) => id));
  const used = new Map(anchors.map(([id, entry]) => [id, new Set(entry.used)]));
  const terminalGroup = top === 'acid' || top === 'aldehyde' || top === 'nitrile';
  // Every path between two chain carbons (the carbon skeleton is a tree outside the ring).
  const paths: string[][] = [];
  for (const start of chainCarbons) {
    const previous = new Map<string, string | null>([[start, null]]);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      for (const next of graph.adjacency.get(id)!) {
        if (!inChain.has(next.id) || previous.has(next.id)) continue;
        previous.set(next.id, id);
        queue.push(next.id);
      }
    }
    for (const end of previous.keys()) {
      const path: string[] = [];
      for (let id: string | null = end; id; id = previous.get(id) ?? null) path.push(id);
      paths.push(path.reverse());
    }
  }
  let best: Candidate | null = null;
  for (const path of paths) {
    const n = path.length;
    if (n > 12) continue;
    if ([...anchorIds].some((id) => !path.includes(id))) continue;
    if (terminalGroup && anchors.some(([id]) => id !== path[0] && id !== path[n - 1])) continue;
    const pathSet = new Set(path);
    const principal: number[] = [];
    const prefixes: Array<{ name: string; locant: number }> = [];
    const doubles: number[] = [];
    const triples: number[] = [];
    let failed = false;
    for (let i = 0; i < n && !failed; i += 1) {
      const id = path[i]!;
      if (anchorIds.has(id)) principal.push(i + 1);
      if (i < n - 1) {
        const o = order(graph, id, path[i + 1]!);
        if (o === 2) doubles.push(i + 1);
        else if (o === 3) triples.push(i + 1);
        else if (o !== 1) failed = true;
      }
      for (const next of graph.adjacency.get(id)!) {
        if (pathSet.has(next.id) || used.get(id)?.has(next.id)) continue;
        const name = prefixFor(graph, id, next.id, pathSet, ringSet, isBenzene);
        if (!name) failed = true;
        else prefixes.push({ name, locant: i + 1 });
      }
    }
    if (failed) continue;
    if (doubles.length && triples.length) continue;
    const unsaturation = [...doubles, ...triples];
    const score: Candidate['score'] = [
      -principal.length,
      -n,
      -unsaturation.length,
      -doubles.length,
      -prefixes.length,
      principal,
      unsaturation,
      doubles,
      prefixes.map((p) => p.locant).sort((a, b) => a - b),
      alphabeticalLocants(prefixes),
    ];
    if (best && !better(score, best.score)) continue;
    const stem = STEM_BY_LENGTH[n];
    if (!stem) continue;
    const items = prefixes.length + (terminalGroup ? 0 : principal.length) + unsaturation.length;
    const showLocants = !(n <= 2 && items <= 1) && n > 1;
    const prefixText = prefixString(prefixes, showLocants && n > 1);
    if (prefixText === null) continue;
    const kind = triples.length ? 'yn' : doubles.length ? 'en' : 'an';
    const multiple = MULTIPLY[unsaturation.length] ?? null;
    if (multiple === null) continue;
    const unsat =
      kind === 'an'
        ? 'an'
        : `${multiple ? 'a' : ''}${showLocants ? `-${unsaturation.join(',')}-` : ''}${multiple}${kind}`;
    let name: string;
    if (!top) name = `${prefixText}${stem}${unsat}e`;
    else {
      const counted = `${MULTIPLY[principal.length]}${SUFFIX_TEXT[top]}`;
      const locants = !terminalGroup && showLocants ? `-${principal.join(',')}-` : '';
      const vowel = /^[aeiouy]/.test(counted);
      const joiner = locants ? (unsat === 'an' && !vowel ? 'e' : '') : vowel ? '' : 'e';
      name = `${prefixText}${stem}${unsat}${joiner}${locants}${counted}`;
    }
    best = { score, name };
  }
  return best?.name ?? null;
}
