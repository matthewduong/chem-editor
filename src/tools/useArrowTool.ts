import { useRef, useState } from 'react';
import { ToolLifecycle } from '../editor/toolLifecycle';
import { arrowDragGeometry, isArrowLongEnough } from '../lib/arrowGesture';
import type { ChemDrawDocument } from '../types/chemdraw';
import type { Arrow } from '../types/chemistry';
import { useStore } from '../store';

/**
 * Arrow drawing gesture on the shared tool lifecycle. The preview is the in-progress arrow;
 * `commit` returns it only when the drag was long enough and the document was not replaced
 * mid-gesture, so a cancelled or stale gesture never produces an edit.
 */
export function useArrowTool() {
  const lifecycle = useRef(new ToolLifecycle<null, ChemDrawDocument | null>());
  const latest = useRef<Arrow | null>(null);
  const [preview, setPreview] = useState<Arrow | null>(null);
  const cancel = () => {
    lifecycle.current.cancel();
    latest.current = null;
    setPreview(null);
  };
  return {
    preview,
    isActive: () => latest.current !== null,
    begin(type: Arrow['type'], point: { x: number; y: number }) {
      lifecycle.current.begin(useStore.getState().chemDrawDocument, {
        point,
        hit: null,
        modifiers: { primary: false, shift: false },
      });
      latest.current = {
        id: 'preview',
        type,
        x1: point.x,
        y1: point.y,
        x2: point.x,
        y2: point.y,
        cpx: point.x,
        cpy: point.y,
      };
      setPreview(latest.current);
    },
    update(point: { x: number; y: number }) {
      const current = latest.current;
      if (!current) return;
      lifecycle.current.update({
        point,
        hit: null,
        modifiers: { primary: false, shift: false },
      });
      latest.current = {
        ...current,
        ...arrowDragGeometry(current.type, { x: current.x1, y: current.y1 }, point),
      };
      setPreview(latest.current);
    },
    /** The finished arrow, or null when there is nothing to commit. Always ends the gesture. */
    commit(): Arrow | null {
      const arrow = latest.current;
      const accepted = lifecycle.current.commit(useStore.getState().chemDrawDocument);
      latest.current = null;
      setPreview(null);
      return arrow && accepted && isArrowLongEnough(arrow) ? arrow : null;
    },
    cancel,
  };
}
