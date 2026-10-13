import { useRef } from 'react';
import { ToolLifecycle } from '../editor/toolLifecycle';
import { stepTextDrag, type TextDrag } from '../lib/textDragGesture';
import type { ChemDrawDocument } from '../types/chemdraw';
import { useStore } from '../store';

/**
 * Press on a text box with the text tool: a short click opens it for editing, a drag moves it.
 * The press is not decided until release, so editing never starts mid-drag.
 */
export function useTextDragTool() {
  const lifecycle = useRef(new ToolLifecycle<null, ChemDrawDocument | null>());
  const drag = useRef<TextDrag | null>(null);
  const cancel = () => {
    lifecycle.current.cancel();
    drag.current = null;
  };
  return {
    isActive: () => drag.current !== null,
    begin(textBoxId: string, pos: { x: number; y: number }) {
      lifecycle.current.begin(useStore.getState().chemDrawDocument, {
        point: pos,
        hit: null,
        modifiers: { primary: false, shift: false },
      });
      drag.current = { textBoxId, startPos: pos, lastPos: pos, hasMoved: false };
    },
    /** Movement to apply to the preview, or null while still within the click threshold. */
    update(pos: { x: number; y: number }, stageScale: number) {
      const current = drag.current;
      if (!current) return null;
      const step = stepTextDrag(current, pos, stageScale);
      if (!step) return null;
      drag.current = step.drag;
      return { textBoxId: current.textBoxId, dx: step.dx, dy: step.dy };
    },
    /**
     * How the press ended: a `click` on a box, a `drag` that moved it, or null when it was
     * cancelled or the document was replaced meanwhile. Always ends the press.
     */
    commit(): { kind: 'click' | 'drag'; textBoxId: string } | null {
      const current = drag.current;
      const accepted = lifecycle.current.commit(useStore.getState().chemDrawDocument);
      drag.current = null;
      if (!current || !accepted) return null;
      return { kind: current.hasMoved ? 'drag' : 'click', textBoxId: current.textBoxId };
    },
    cancel,
  };
}
