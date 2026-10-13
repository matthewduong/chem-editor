import type { Atom, Bond } from '../types/chemistry';
import { SNAP_ANGLE } from './graph';

/** Pure zigzag geometry. Projection onto its snapped axis determines the count. */
export function chainGeometry(
  start: { x: number; y: number },
  pointer: { x: number; y: number },
  bondLength: number,
) {
  const dx = pointer.x - start.x,
    dy = pointer.y - start.y;
  const direction = Math.round(Math.atan2(dy, dx) / SNAP_ANGLE) * SNAP_ANGLE;
  const advance = bondLength * Math.cos(Math.PI / 6);
  const projection = dx * Math.cos(direction) + dy * Math.sin(direction);
  const count = Math.max(0, Math.min(200, Math.floor(projection / advance)));
  const points = [{ ...start }];
  for (let i = 0; i < count; i++) {
    const previous = points.at(-1)!;
    const angle = direction + ((i % 2 ? -1 : 1) * Math.PI) / 6;
    points.push({
      x: previous.x + bondLength * Math.cos(angle),
      y: previous.y + bondLength * Math.sin(angle),
    });
  }
  return points;
}

export function materializeChain(
  points: Array<{ x: number; y: number }>,
  atoms: Atom[],
  bonds: Bond[],
  startId?: string,
  endId?: string,
  id: () => string = () => crypto.randomUUID(),
) {
  if (points.length < 2) return { atoms, bonds, addedAtomIds: [] as string[] };
  if (endId && startId === endId && points.length === 2)
    throw new Error('A chain cannot make a self-bond.');
  const nextAtoms = [...atoms],
    nextBonds = [...bonds];
  const addedAtomIds: string[] = [];
  const ids = points.map((p, i) => {
    const existing = i === 0 ? startId : i === points.length - 1 ? endId : undefined;
    if (existing) {
      if (!atoms.some((a) => a.id === existing))
        throw new Error('Chain attachment refers to a missing atom.');
      return existing;
    }
    const atomId = id();
    nextAtoms.push({ ...p, id: atomId, kind: 'element', element: 'C' });
    addedAtomIds.push(atomId);
    return atomId;
  });
  for (let i = 1; i < ids.length; i++) {
    const from = ids[i - 1]!,
      to = ids[i]!;
    if (
      from === to ||
      nextBonds.some((b) => (b.from === from && b.to === to) || (b.from === to && b.to === from))
    )
      throw new Error('Chain attachment would create a self-bond or duplicate bond.');
    nextBonds.push({ id: id(), from, to, order: 1 });
  }
  return { atoms: nextAtoms, bonds: nextBonds, addedAtomIds };
}
