import { useRef, useState } from 'react';
import { ToolLifecycle } from '../editor/toolLifecycle';
import type { RingPlacementPreview } from '../lib/ringGesture';
import type { ChemDrawDocument } from '../types/chemdraw';
import type { Atom, Bond } from '../types/chemistry';
import { useStore } from '../store';

type Resolve = (
  pos: { x: number; y: number },
  hitAtom: Atom | null,
  hitBond: Bond | null,
) => RingPlacementPreview;

/**
 * Ring tool gesture on the shared lifecycle. The preview follows the pointer on hover and
 * during a press; `commit` returns the placement only for a gesture that began and was neither
 * cancelled nor overtaken by a document replacement, so a stale pointer-up creates nothing.
 */
export function useRingTool(resolve: Resolve) {
  const lifecycle = useRef(new ToolLifecycle<Atom | null, ChemDrawDocument | null>());
  const pending = useRef<RingPlacementPreview | null>(null);
  const [preview, setPreview] = useState<RingPlacementPreview | null>(null);
  const input = (pos: { x: number; y: number }, hit: Atom | null) => ({
    point: pos,
    hit,
    modifiers: { primary: false, shift: false },
  });
  const cancel = () => {
    lifecycle.current.cancel();
    pending.current = null;
    setPreview(null);
  };
  return {
    preview,
    /** A press is in progress (pointer is down and not cancelled). */
    isActive: () => pending.current !== null,
    hover(pos: { x: number; y: number }, hitAtom: Atom | null, hitBond: Bond | null) {
      const placement = resolve(pos, hitAtom, hitBond);
      if (pending.current) {
        pending.current = placement;
        lifecycle.current.update(input(pos, hitAtom));
      }
      setPreview(placement);
    },
    begin(pos: { x: number; y: number }, hitAtom: Atom | null, hitBond: Bond | null) {
      lifecycle.current.begin(useStore.getState().chemDrawDocument, input(pos, hitAtom));
      pending.current = resolve(pos, hitAtom, hitBond);
      setPreview(pending.current);
    },
    /** The placement to apply, or null when there is nothing to commit. Always ends the press. */
    commit(): RingPlacementPreview | null {
      const placement = pending.current;
      const accepted = lifecycle.current.commit(useStore.getState().chemDrawDocument);
      pending.current = null;
      setPreview(null);
      return placement && accepted ? placement : null;
    },
    cancel,
  };
}
