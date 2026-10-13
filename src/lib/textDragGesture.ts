export interface TextDrag {
  textBoxId: string;
  startPos: { x: number; y: number };
  lastPos: { x: number; y: number };
  hasMoved: boolean;
}

/** A press on a text box moves it only after the pointer travels this far (screen pixels). */
export const TEXT_DRAG_THRESHOLD_PX = 4;

/**
 * Advances a text-box drag. Returns the new state and the movement since the last step, or
 * null while the pointer is still within the click threshold, so a click never nudges the box.
 */
export function stepTextDrag(
  drag: TextDrag,
  pos: { x: number; y: number },
  stageScale: number,
): { drag: TextDrag; dx: number; dy: number } | null {
  const total = Math.hypot(pos.x - drag.startPos.x, pos.y - drag.startPos.y);
  if (!(stageScale > 0) || total <= TEXT_DRAG_THRESHOLD_PX / stageScale) return null;
  return {
    drag: { ...drag, hasMoved: true, lastPos: { x: pos.x, y: pos.y } },
    dx: pos.x - drag.lastPos.x,
    dy: pos.y - drag.lastPos.y,
  };
}
