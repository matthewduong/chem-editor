import type { RefObject } from 'react';
import type { ChemCanvasRef } from '../types/canvas';

/**
 * Drag the selection (or the drawing) into another app: CDXML (`chemical/x-cdxml`, which
 * ChemDraw-aware apps take), SMILES as plain text, and the drawing as an image in HTML.
 */
export function DragOutHandle({ canvas }: { canvas: RefObject<ChemCanvasRef | null> }) {
  return (
    <button
      type="button"
      draggable
      title="Drag the selection, or the drawing, into another app"
      aria-label="Drag out"
      onDragStart={(event) => {
        const payload = canvas.current?.dragPayload();
        if (!payload) {
          event.preventDefault();
          return;
        }
        const data = event.dataTransfer;
        data.effectAllowed = 'copy';
        data.setData('chemical/x-cdxml', payload.cdxml);
        data.setData('text/plain', payload.smiles ?? payload.cdxml);
        if (payload.png) {
          data.setData(
            'text/html',
            `<img src="${payload.png}" alt="${payload.smiles ?? 'structure'}">`,
          );
          data.setData('text/uri-list', payload.png);
        }
      }}
      style={{ cursor: 'grab' }}
    >
      ⠿ Drag
    </button>
  );
}
