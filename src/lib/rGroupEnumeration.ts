import type {
  ChemDrawBond,
  ChemDrawDocument,
  ChemDrawFragment,
  ChemDrawNode,
  ChemDrawObject,
} from '../types/chemdraw';
import type { DocumentStyleSettings } from '../types/settings';

/** More combinations than this are not drawn; ChemDraw's own limit is not measured. */
export const MAX_ENUMERATED_STRUCTURES = 64;

/**
 * Structure > Expand Generic Structure (ChemDraw 17.1 guide, "R-Group Analysis"/"Expanding
 * generic structures"): every combination of an R-group structure's R atoms with their
 * definitions' members, each drawn as a new structure in a row to the right of the original.
 * A member takes its R's place at its attachment atom, turned so its attachment point faces the
 * atom the R was bonded to; that bond keeps its order. R-logic is not applied (gaps.md).
 */
export function expandGenericStructures(
  document: ChemDrawDocument,
  selectedIds: ReadonlySet<string>,
  settings: DocumentStyleSettings,
  newId: () => string,
): { document: ChemDrawDocument; count: number; truncated: boolean } {
  const page = document.pages[0];
  const definitions = new Map(
    (page?.rGroupDefinitions ?? []).map((definition) => [definition.name, definition]),
  );
  if (!page || definitions.size === 0) return { document, count: 0, truncated: false };
  const byId = new Map(page.objects.map((object) => [object.id, object]));
  const node = (id: string) => {
    const object = byId.get(id);
    return object?.type === 'node' ? object : undefined;
  };
  const bondsOf = (fragment: ChemDrawFragment) =>
    fragment.bondIds
      .map((id) => byId.get(id))
      .filter((object): object is ChemDrawBond => object?.type === 'bond');

  const added: ChemDrawObject[] = [];
  let count = 0;
  let truncated = false;
  for (const fragment of page.objects) {
    if (fragment.type !== 'fragment' || fragment.preservation?.ownedBy) continue;
    if (selectedIds.size && !fragment.nodeIds.some((id) => selectedIds.has(id))) continue;
    const bonds = bondsOf(fragment);
    // Each R: its definition, and the one atom it hangs on.
    const rs = fragment.nodeIds
      .map((id) => node(id))
      .filter((entry): entry is ChemDrawNode => Boolean(entry))
      .flatMap((r) => {
        const definition = definitions.get((r.alias ?? '').trim());
        const own = bonds.filter((bond) => bond.beginNodeId === r.id || bond.endNodeId === r.id);
        if (!definition || own.length !== 1) return [];
        const bond = own[0]!;
        const neighbourId = bond.beginNodeId === r.id ? bond.endNodeId : bond.beginNodeId;
        return [{ r, bond, neighbour: node(neighbourId)!, definition }];
      })
      .filter((entry) => entry.neighbour);
    if (rs.length === 0) continue;

    let combinations: number[][] = [[]];
    for (const { definition } of rs) {
      combinations = combinations.flatMap((prefix) =>
        definition.members.map((_, index) => [...prefix, index]),
      );
    }
    if (combinations.length > MAX_ENUMERATED_STRUCTURES) {
      combinations = combinations.slice(0, MAX_ENUMERATED_STRUCTURES);
      truncated = true;
    }
    const xs = fragment.nodeIds.map((id) => node(id)?.position.x ?? 0);
    const step = Math.max(...xs) - Math.min(...xs) + 2 * settings.bondLength;
    const rIds = new Set(rs.map(({ r }) => r.id));

    combinations.forEach((choice, index) => {
      const dx = step * (index + 1);
      const nodeIds: string[] = [];
      const bondIds: string[] = [];
      const copyNode = (source: ChemDrawNode, position: { x: number; y: number }) => {
        const copy: ChemDrawNode = { ...source, id: newId(), position };
        delete copy.preservation;
        delete copy.atomNumber;
        delete copy.showAtomNumber;
        added.push(copy);
        nodeIds.push(copy.id);
        return copy.id;
      };
      const addBond = (source: ChemDrawBond, begin: string, end: string) => {
        const copy: ChemDrawBond = { ...source, id: newId(), beginNodeId: begin, endNodeId: end };
        delete copy.preservation;
        added.push(copy);
        bondIds.push(copy.id);
      };
      const idMap = new Map<string, string>();
      for (const id of fragment.nodeIds) {
        const source = node(id);
        if (!source || rIds.has(id)) continue;
        idMap.set(id, copyNode(source, { x: source.position.x + dx, y: source.position.y }));
      }
      for (const bond of bonds) {
        if (rIds.has(bond.beginNodeId) || rIds.has(bond.endNodeId)) continue;
        const begin = idMap.get(bond.beginNodeId);
        const end = idMap.get(bond.endNodeId);
        if (begin && end) addBond(bond, begin, end);
      }
      rs.forEach(({ r, bond, neighbour, definition }, k) => {
        const member = definition.members[choice[k]!]!;
        const memberFragment = byId.get(member.fragmentId);
        const anchor = node(member.attachmentNodeId);
        if (memberFragment?.type !== 'fragment' || !anchor) return;
        const target = Math.atan2(
          neighbour.position.y - r.position.y,
          neighbour.position.x - r.position.x,
        );
        const source = Math.atan2(
          member.attachmentPoint.y - anchor.position.y,
          member.attachmentPoint.x - anchor.position.x,
        );
        const [cos, sin] = [Math.cos(target - source), Math.sin(target - source)];
        const place = (p: { x: number; y: number }) => {
          const ox = p.x - anchor.position.x;
          const oy = p.y - anchor.position.y;
          return {
            x: r.position.x + dx + ox * cos - oy * sin,
            y: r.position.y + ox * sin + oy * cos,
          };
        };
        const memberMap = new Map<string, string>();
        for (const id of memberFragment.nodeIds) {
          const source = node(id);
          if (source) memberMap.set(id, copyNode(source, place(source.position)));
        }
        for (const memberBond of bondsOf(memberFragment)) {
          const begin = memberMap.get(memberBond.beginNodeId);
          const end = memberMap.get(memberBond.endNodeId);
          if (begin && end) addBond(memberBond, begin, end);
        }
        const attached = memberMap.get(member.attachmentNodeId);
        const kept = idMap.get(neighbour.id);
        if (attached && kept) {
          addBond({ ...bond, display: undefined }, kept, attached);
        }
      });
      added.push({ id: newId(), type: 'fragment', nodeIds, bondIds });
      count += 1;
    });
  }
  if (count === 0) return { document, count, truncated };
  return {
    document: {
      ...document,
      pages: [{ ...page, objects: [...page.objects, ...added] }, ...document.pages.slice(1)],
    },
    count,
    truncated,
  };
}
