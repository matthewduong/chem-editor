import { useRef, useState } from 'react';
import { ToolLifecycle } from '../editor/toolLifecycle';
import {
  boxShapeGeometry,
  createBoxShapeGraphic,
  isShapeBigEnough,
  type ShapeKind,
} from '../lib/shapeGesture';
import type { ChemDrawDocument, ChemDrawObject, ChemDrawPoint } from '../types/chemdraw';
import { useStore } from '../store';

interface ShapeDrag {
  kind: ShapeKind;
  start: ChemDrawPoint;
  object: ChemDrawObject;
  bigEnough: boolean;
}

/**
 * Drawing-element gesture (rectangles and ovals) on the shared tool lifecycle. The preview is
 * the native object being drawn; `commit` returns it only for a real drag on the document the
 * press began on, so a click, a cancel or a stale gesture never produces an edit.
 */
export function useShapeTool() {
  const lifecycle = useRef(new ToolLifecycle<null, ChemDrawDocument | null>());
  const latest = useRef<ShapeDrag | null>(null);
  const [preview, setPreview] = useState<ChemDrawObject | null>(null);
  const build = (kind: ShapeKind, start: ChemDrawPoint, pointer: ChemDrawPoint, shift: boolean) => {
    const geometry = boxShapeGeometry(kind, start, pointer, shift);
    return {
      object: createBoxShapeGraphic('__preview-shape', kind, geometry),
      bigEnough: isShapeBigEnough(geometry),
    };
  };
  const cancel = () => {
    lifecycle.current.cancel();
    latest.current = null;
    setPreview(null);
  };
  return {
    preview,
    isActive: () => latest.current !== null,
    begin(kind: ShapeKind, point: ChemDrawPoint) {
      lifecycle.current.begin(useStore.getState().chemDrawDocument, {
        point,
        hit: null,
        modifiers: { primary: false, shift: false },
      });
      latest.current = { kind, start: point, ...build(kind, point, point, false) };
      setPreview(null);
    },
    update(point: ChemDrawPoint, shift = false) {
      const current = latest.current;
      if (!current) return;
      lifecycle.current.update({ point, hit: null, modifiers: { primary: false, shift } });
      latest.current = { ...current, ...build(current.kind, current.start, point, shift) };
      setPreview(latest.current.bigEnough ? latest.current.object : null);
    },
    /** The finished object with a fresh id, or null when there is nothing to commit. */
    commit(): ChemDrawObject | null {
      const drag = latest.current;
      const accepted = lifecycle.current.commit(useStore.getState().chemDrawDocument);
      latest.current = null;
      setPreview(null);
      if (!drag || !accepted || !drag.bigEnough) return null;
      return { ...drag.object, id: crypto.randomUUID() };
    },
    cancel,
  };
}
