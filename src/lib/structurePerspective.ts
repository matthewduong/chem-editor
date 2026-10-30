import type { ChemDrawDocument, ChemDrawNode, ChemDrawPoint } from '../types/chemdraw';
import { getSelectedNodeIds, mapObjectTags } from './chemdrawModel';

/**
 * Structure Perspective (ChemDraw 17.1 guide): tilts the selected structures through three
 * dimensions. Atoms turn about the vertical axis by `tiltY` and the horizontal axis by `tiltX`
 * (radians) through `center`, and are projected straight back onto the page. Each atom keeps
 * its depth (`ChemDrawNode.depth`, not written to files) so successive tilts compose like one.
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
    // About the vertical axis, then the horizontal one.
    const x1 = dx * cy + z * sy;
    const z1 = -dx * sy + z * cy;
    const y2 = dy * cx - z1 * sx;
    const z2 = dy * sx + z1 * cx;
    return { x: center.x + x1, y: center.y + y2, z: z2 };
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
 * The tilt a drag asks for: across turns about the vertical axis, down about the horizontal one,
 * a quarter turn per three bond lengths dragged. Shift keeps only the larger of the two (the
 * guide: "limit the rotation to the X or Y axes only").
 */
export function perspectiveTiltForDrag(
  start: ChemDrawPoint,
  current: ChemDrawPoint,
  bondLength: number,
  shift: boolean,
): { tiltX: number; tiltY: number } {
  const perRadian = (3 * bondLength) / (Math.PI / 2);
  let tiltY = (current.x - start.x) / perRadian;
  let tiltX = -(current.y - start.y) / perRadian;
  if (shift) {
    if (Math.abs(tiltY) >= Math.abs(tiltX)) tiltX = 0;
    else tiltY = 0;
  }
  return { tiltX, tiltY };
}
