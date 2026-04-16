import type { ChemDrawBounds } from '../../types/chemdraw';

export function pointInExpandedBounds(
  bounds: ChemDrawBounds,
  point: { x: number; y: number },
  padding = 0,
): boolean {
  return (
    point.x >= bounds.left - padding &&
    point.x <= bounds.right + padding &&
    point.y >= bounds.top - padding &&
    point.y <= bounds.bottom + padding
  );
}

export function distanceToSegment(
  point: { x: number; y: number },
  start: { x: number; y: number },
  end: { x: number; y: number },
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / l2));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}
