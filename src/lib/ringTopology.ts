import type { Atom, Bond } from '../types/chemistry';
import { LruCache } from './lruCache';
type Edge = { neighborId: string; bondId: string };
interface Topology {
  adj: Map<string, Edge[]>;
  component: Map<string, number>;
}
const cache = new LruCache<Topology>(8);
/** Iterative Tarjan edge blocks: linear work, no recursion on long chains. Coordinates are absent. */
export function ringTopology(atoms: Atom[], bonds: Bond[]): Topology {
  const key = JSON.stringify([atoms.map((a) => a.id), bonds.map((b) => [b.id, b.from, b.to])]);
  const cached = cache.get(key);
  if (cached) return cached;
  const adj = new Map<string, Edge[]>(atoms.map((a) => [a.id, []]));
  for (const b of bonds) {
    if (!adj.has(b.from) || !adj.has(b.to)) continue;
    adj.get(b.from)!.push({ neighborId: b.to, bondId: b.id });
    adj.get(b.to)!.push({ neighborId: b.from, bondId: b.id });
  }
  const discovered = new Map<string, number>();
  const low = new Map<string, number>();
  const edges: string[] = [];
  const component = new Map<string, number>();
  let clock = 0;
  let block = 0;
  type Frame = { id: string; parent?: string; edge?: string; cursor: number };
  for (const root of adj.keys()) {
    if (discovered.has(root)) continue;
    discovered.set(root, ++clock);
    low.set(root, clock);
    const stack: Frame[] = [{ id: root, cursor: 0 }];
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const neighbors = adj.get(frame.id)!;
      if (frame.cursor < neighbors.length) {
        const edge = neighbors[frame.cursor++];
        if (edge.bondId === frame.edge) continue;
        if (!discovered.has(edge.neighborId)) {
          edges.push(edge.bondId);
          discovered.set(edge.neighborId, ++clock);
          low.set(edge.neighborId, clock);
          stack.push({ id: edge.neighborId, parent: frame.id, edge: edge.bondId, cursor: 0 });
        } else if (discovered.get(edge.neighborId)! < discovered.get(frame.id)!) {
          edges.push(edge.bondId);
          low.set(frame.id, Math.min(low.get(frame.id)!, discovered.get(edge.neighborId)!));
        }
      } else {
        stack.pop();
        if (frame.parent !== undefined) {
          low.set(frame.parent, Math.min(low.get(frame.parent)!, low.get(frame.id)!));
          if (low.get(frame.id)! >= discovered.get(frame.parent)!) {
            const members: string[] = [];
            let edge: string | undefined;
            do {
              edge = edges.pop();
              if (edge !== undefined) members.push(edge);
            } while (edge !== undefined && edge !== frame.edge);
            // A one-edge block is a bridge and cannot belong to a ring.
            if (members.length > 1) {
              for (const id of members) component.set(id, block);
              block += 1;
            }
          }
        }
      }
    }
  }
  const topology = { adj, component };
  cache.set(key, topology);
  return topology;
}
