import type { ChemDrawDocument, ChemDrawNode, ChemDrawPoint } from '../types/chemdraw';
import { getSelectedNodeIds, mapObjectTags } from './chemdrawModel';

/**
 * Structure Perspective (ChemDraw 17.1 guide): tilts the selected structures through three
 * dimensions. Atoms turn about the horizontal axis by `tiltX`, then the vertical axis by `tiltY`
 * (radians) through `center`, and are projected straight back onto the page. Each atom keeps
 * its depth (`ChemDrawNode.depth`, written as CDXML `xyz`) so successive tilts compose like one.
 * Orbitals and other drawings are not structures and stay put, as in ChemDraw.
 */
export function perspectiveSelectedObjects(
  document: ChemDrawDocument,
  selectedObjectIds: Set<string>,
  center: ChemDrawPoint,
  tiltX: number,
  tiltY: number,
): ChemDrawDocument {
  const page = document.pages[0];
  if (!page || (tiltX === 0 && tiltY === 0)) return document;
  const nodeIds = getSelectedNodeIds(page.objects, selectedObjectIds);
  if (nodeIds.size === 0) return document;
  const [cy, sy, cx, sx] = [Math.cos(tiltY), Math.sin(tiltY), Math.cos(tiltX), Math.sin(tiltX)];
  const tilt = (x: number, y: number, z: number) => {
    const dx = x - center.x;
    const dy = y - center.y;
    // About the horizontal axis first, then the vertical one: ChemDraw's order for a diagonal
    // drag (the other order was 8.6pt off, this 0.24pt).
    const y1 = dy * cx - z * sx;
    const z1 = dy * sx + z * cx;
    const x2 = dx * cy + z1 * sy;
    const z2 = -dx * sy + z1 * cy;
    return { x: center.x + x2, y: center.y + y1, z: z2 };
  };
  const objects = page.objects.map((object) => {
    if (object.type !== 'node' || !nodeIds.has(object.id)) return object;
    if (object.preservation?.capability === 'render-only') return object;
    const moved = tilt(object.position.x, object.position.y, object.depth ?? 0);
    const shift = (x: number, y: number) => ({
      x: x + moved.x - object.position.x,
      y: y + moved.y - object.position.y,
    });
    const next: ChemDrawNode = {
      ...object,
      position: { x: moved.x, y: moved.y },
      depth: moved.z,
      ...(object.objectTags ? { objectTags: mapObjectTags(object.objectTags, shift) } : {}),
    };
    return next;
  });
  return { ...document, pages: [{ ...page, objects }, ...document.pages.slice(1)] };
}

/**
 * The tilt a drag asks for: across turns about the vertical axis, down about the horizontal one.
 * Measured on ChemDraw 26.1.0.6801 (gaps.md): 1.089 degrees per point dragged (20, 40 and 80pt gave
 * 21.8, 43.5 and 87.1 degrees; 1.088 to 1.090 throughout), at a bond length of 14.4 only, so whether
 * it scales with the bond length is not known and this does not. Dragging right or down puts the
 * far side of the structure deeper (positive depth, as ChemDraw's `xyz` has it), which is the
 * opposite sign of the formulas above. Shift keeps only the larger of the two (the guide: "limit
 * the rotation to the X or Y axes only").
 */
const RADIANS_PER_POINT = (1.089 * Math.PI) / 180;
export function perspectiveTiltForDrag(
  start: ChemDrawPoint,
  current: ChemDrawPoint,
  bondLength: number,
  shift: boolean,
): { tiltX: number; tiltY: number } {
  void bondLength;
  let tiltY = -(current.x - start.x) * RADIANS_PER_POINT;
  let tiltX = (current.y - start.y) * RADIANS_PER_POINT;
  if (shift) {
    if (Math.abs(tiltY) >= Math.abs(tiltX)) tiltX = 0;
    else tiltY = 0;
  }
  return { tiltX, tiltY };
}
