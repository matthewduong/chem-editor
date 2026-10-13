import type { Atom, Bond } from '../types/chemistry';
import {
  materializeResolvedRingTemplatePlacement,
  materializeRingGeometry,
  type ResolvedRingTemplatePlacement,
  type RingGeometry,
} from './ringTemplates';

/** What the ring tool shows under the pointer and commits on release. */
export type RingPlacementPreview =
  | { kind: 'polygon'; geometry: RingGeometry }
  | { kind: 'template'; placement: ResolvedRingTemplatePlacement };

/**
 * The atoms and bonds the document has after the ring is placed. A free ring is appended; a
 * template placement may also merge into an existing atom or bond, so it receives the current
 * graph. Pure: the preview and the commit use the same call.
 */
export function applyRingPlacement(
  placement: RingPlacementPreview,
  atoms: Atom[],
  bonds: Bond[],
): { atoms: Atom[]; bonds: Bond[] } {
  if (placement.kind === 'template') {
    return materializeResolvedRingTemplatePlacement(placement.placement, atoms, bonds);
  }
  const ring = materializeRingGeometry(placement.geometry);
  return { atoms: [...atoms, ...ring.atoms], bonds: [...bonds, ...ring.bonds] };
}
