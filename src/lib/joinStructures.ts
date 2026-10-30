import type {
  ChemDrawBond,
  ChemDrawDocument,
  ChemDrawFragment,
  ChemDrawNode,
  ChemDrawObject,
} from '../types/chemdraw';

/**
 * Object > Join (ChemDraw 17.1 guide, "Joining Structures"): fuse two atoms into one, or two
 * bonds into one shared bond. "When you join two atoms that are labeled, the front atom label
 * becomes the atom label" -- and its colour -- so the atom drawn later survives, in its own
 * position. Bonds to the other atom move to it; a bond that would join the atom to itself goes,
 * and of two bonds that now join the same pair of atoms the front one stays. The two structures
 * become one fragment.
 */
export function joinNodes(
  document: ChemDrawDocument,
  pairs: ReadonlyArray<readonly [string, string]>,
): ChemDrawDocument {
  const page = document.pages[0];
  if (!page) return document;
  let objects = [...page.objects];
  let changed = false;
  for (const [a, b] of pairs) {
    const next = joinPair(objects, a, b);
    if (next) {
      objects = next;
      changed = true;
    }
  }
  return changed
    ? { ...document, pages: [{ ...page, objects }, ...document.pages.slice(1)] }
    : document;
}

function joinPair(objects: ChemDrawObject[], a: string, b: string): ChemDrawObject[] | null {
  if (a === b) return null;
  const indexOf = new Map(objects.map((object, index) => [object.id, index]));
  const nodeA = objects[indexOf.get(a) ?? -1];
  const nodeB = objects[indexOf.get(b) ?? -1];
  if (nodeA?.type !== 'node' || nodeB?.type !== 'node') return null;
  if (isLocked(nodeA) || isLocked(nodeB)) return null;
  const [front, back] =
    (indexOf.get(a) ?? 0) > (indexOf.get(b) ?? 0) ? [nodeA, nodeB] : [nodeB, nodeA];
  const keep = front.id;
  const drop = back.id;

  // Re-point bonds; then drop self-bonds and keep only the front-most bond per atom pair.
  let bonds = objects.map((object) =>
    object.type === 'bond' && (object.beginNodeId === drop || object.endNodeId === drop)
      ? ({
          ...object,
          beginNodeId: object.beginNodeId === drop ? keep : object.beginNodeId,
          endNodeId: object.endNodeId === drop ? keep : object.endNodeId,
        } as ChemDrawBond)
      : object,
  );
  const pairKey = (bond: ChemDrawBond) => [bond.beginNodeId, bond.endNodeId].sort().join('\u0000');
  const lastIndexForPair = new Map<string, number>();
  bonds.forEach((object, index) => {
    if (object.type === 'bond') lastIndexForPair.set(pairKey(object), index);
  });
  const removed = new Set<string>([drop]);
  bonds = bonds.filter((object, index) => {
    if (object.type !== 'bond') return true;
    if (
      object.beginNodeId === object.endNodeId ||
      lastIndexForPair.get(pairKey(object)) !== index
    ) {
      removed.add(object.id);
      return false;
    }
    return true;
  });

  // One fragment for the joined structure: the front atom's absorbs the other's members.
  const fragmentOf = (id: string) =>
    bonds.find(
      (object): object is ChemDrawFragment =>
        object.type === 'fragment' && object.nodeIds.includes(id),
    );
  const keepFragment = fragmentOf(keep);
  const dropFragment = fragmentOf(drop);
  const absorbed =
    keepFragment && dropFragment && keepFragment.id !== dropFragment.id ? dropFragment : null;
  if (absorbed) removed.add(absorbed.id);
  return bonds
    .filter((object) => !removed.has(object.id))
    .map((object) => {
      if (object.type === 'fragment') {
        const nodeIds =
          object.id === keepFragment?.id && absorbed
            ? [...object.nodeIds, ...absorbed.nodeIds]
            : object.nodeIds;
        const bondIds =
          object.id === keepFragment?.id && absorbed
            ? [...object.bondIds, ...absorbed.bondIds]
            : object.bondIds;
        return {
          ...object,
          nodeIds: [...new Set(nodeIds.filter((id) => !removed.has(id)))],
          bondIds: [...new Set(bondIds.filter((id) => !removed.has(id)))],
        };
      }
      if (object.type === 'group' && absorbed) {
        const childIds = object.childIds.map((id) => (id === absorbed.id ? keepFragment!.id : id));
        return { ...object, childIds: [...new Set(childIds)] };
      }
      return object;
    });
}

/** Render-only content cannot be edited at all; everything else may be joined. */
function isLocked(node: ChemDrawNode): boolean {
  return node.preservation?.capability === 'render-only';
}

/**
 * The atom pairs that joining two bonds fuses: each end of the back bond with the nearer end of
 * the front one (pairing that keeps the two ends crossed is never the nearer one).
 */
export function bondJoinPairs(
  document: ChemDrawDocument,
  bondA: string,
  bondB: string,
): Array<[string, string]> {
  const objects = document.pages[0]?.objects ?? [];
  const byId = new Map(objects.map((object) => [object.id, object]));
  const a = byId.get(bondA);
  const b = byId.get(bondB);
  if (a?.type !== 'bond' || b?.type !== 'bond') return [];
  const position = (id: string) => {
    const node = byId.get(id);
    return node?.type === 'node' ? node.position : null;
  };
  const [a1, a2, b1, b2] = [a.beginNodeId, a.endNodeId, b.beginNodeId, b.endNodeId].map(position);
  if (!a1 || !a2 || !b1 || !b2) return [];
  const d = (p: { x: number; y: number }, q: { x: number; y: number }) =>
    Math.hypot(p.x - q.x, p.y - q.y);
  return d(a1, b1) + d(a2, b2) <= d(a1, b2) + d(a2, b1)
    ? [
        [a.beginNodeId, b.beginNodeId],
        [a.endNodeId, b.endNodeId],
      ]
    : [
        [a.beginNodeId, b.endNodeId],
        [a.endNodeId, b.beginNodeId],
      ];
}

/** Atoms of `moved` that landed within `tolerance` of an atom not moved: the pairs to join. */
export function overlappingNodePairs(
  document: ChemDrawDocument,
  movedNodeIds: ReadonlySet<string>,
  tolerance: number,
): Array<[string, string]> {
  const nodes = (document.pages[0]?.objects ?? []).filter(
    (object): object is ChemDrawNode => object.type === 'node',
  );
  const still = nodes.filter((node) => !movedNodeIds.has(node.id));
  const pairs: Array<[string, string]> = [];
  const taken = new Set<string>();
  for (const node of nodes) {
    if (!movedNodeIds.has(node.id)) continue;
    let best: ChemDrawNode | null = null;
    let bestDistance = tolerance;
    for (const other of still) {
      if (taken.has(other.id)) continue;
      const distance = Math.hypot(
        node.position.x - other.position.x,
        node.position.y - other.position.y,
      );
      if (distance <= bestDistance) {
        best = other;
        bestDistance = distance;
      }
    }
    if (best) {
      pairs.push([best.id, node.id]);
      taken.add(best.id);
    }
  }
  return pairs;
}
