import { useRef, useState } from 'react';
import { ToolLifecycle } from '../editor/toolLifecycle';
import { isClickPlacedShape, shapeForDrag, type ShapeKind } from '../lib/shapeGesture';
import type { ChemDrawDocument, ChemDrawObject, ChemDrawPoint } from '../types/chemdraw';
import { useStore } from '../store';

interface ShapeDrag {
  kind: ShapeKind;
  start: ChemDrawPoint;
  objects: ChemDrawObject[];
  bigEnough: boolean;
  symbolSize?: number;
}

/**
 * Drawing-element gesture (shapes, lines, arcs, brackets and symbols) on the shared tool
 * lifecycle. The preview is the native objects being drawn; `commit` returns them only for a real
 * drag (or, for a click-placed symbol, a press) on the document the press began on, so a click,
 * a cancel or a stale gesture never produces an edit.
 */
export function useShapeTool() {
  const lifecycle = useRef(new ToolLifecycle<null, ChemDrawDocument | null>());
  const latest = useRef<ShapeDrag | null>(null);
  const [preview, setPreview] = useState<ChemDrawObject[] | null>(null);
  const build = (
    kind: ShapeKind,
    start: ChemDrawPoint,
    pointer: ChemDrawPoint,
    shift: boolean,
    symbolSize?: number,
  ) => {
    const { object, extra, bigEnough } = shapeForDrag(
      kind,
      '__preview-shape',
      start,
      pointer,
      shift,
      { symbolSize },
    );
    return { objects: [object, ...(extra ?? [])], bigEnough };
  };
  const cancel = () => {
    lifecycle.current.cancel();
    latest.current = null;
    setPreview(null);
  };
  return {
    preview,
    isActive: () => latest.current !== null,
    begin(kind: ShapeKind, point: ChemDrawPoint, options: { symbolSize?: number } = {}) {
      lifecycle.current.begin(useStore.getState().chemDrawDocument, {
        point,
        hit: null,
        modifiers: { primary: false, shift: false },
      });
      latest.current = {
        kind,
        start: point,
        symbolSize: options.symbolSize,
        ...build(kind, point, point, false, options.symbolSize),
      };
      setPreview(isClickPlacedShape(kind) ? latest.current.objects : null);
    },
    update(point: ChemDrawPoint, shift = false) {
      const current = latest.current;
      if (!current || isClickPlacedShape(current.kind)) return;
      lifecycle.current.update({ point, hit: null, modifiers: { primary: false, shift } });
      latest.current = {
        ...current,
        ...build(current.kind, current.start, point, shift, current.symbolSize),
      };
      setPreview(latest.current.bigEnough ? latest.current.objects : null);
    },
    /** The finished objects with fresh ids, or null when there is nothing to commit. */
    commit(): ChemDrawObject[] | null {
      const drag = latest.current;
      const accepted = lifecycle.current.commit(useStore.getState().chemDrawDocument);
      latest.current = null;
      setPreview(null);
      if (!drag || !accepted || !drag.bigEnough) return null;
      return drag.objects.map((object) => ({ ...object, id: crypto.randomUUID() }));
    },
    cancel,
  };
}
