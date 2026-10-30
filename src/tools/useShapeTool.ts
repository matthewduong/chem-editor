import { useRef, useState } from 'react';
import { ToolLifecycle } from '../editor/toolLifecycle';
import { createFreehandCurve } from '../lib/curveGesture';
import { appendCurveSegment, findCurveHandle, moveCurveHandle } from '../lib/curveEdit';
import { CURVE_TYPE, curveSegments, sampleCurve } from '../lib/curveGeometry';
import {
  isClickPlacedShape,
  isOrbitalShape,
  shapeForDrag,
  type ShapeKind,
} from '../lib/shapeGesture';
import type {
  ChemDrawDocument,
  ChemDrawGraphic,
  ChemDrawObject,
  ChemDrawPoint,
} from '../types/chemdraw';
import { useStore } from '../store';

interface ShapeDrag {
  kind: ShapeKind;
  start: ChemDrawPoint;
  objects: ChemDrawObject[];
  bigEnough: boolean;
  symbolSize?: number;
  orbitalSize?: number;
  /** The pointer path, for the pen. */
  path: ChemDrawPoint[];
  /** Edit Curve: the curve and handle being dragged. Edits keep the curve's id. */
  editing?: { curve: ChemDrawGraphic; index: number };
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
    orbitalSize?: number,
  ) => {
    const { object, extra, bigEnough } = shapeForDrag(
      kind,
      '__preview-shape',
      start,
      pointer,
      shift,
      { symbolSize, orbitalSize },
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
    begin(
      kind: ShapeKind,
      point: ChemDrawPoint,
      options: { symbolSize?: number; orbitalSize?: number; handleTolerance?: number } = {},
    ) {
      const state = useStore.getState();
      lifecycle.current.begin(state.chemDrawDocument, {
        point,
        hit: null,
        modifiers: { primary: false, shift: false },
      });
      if (kind === 'edit-curve') {
        const curves = (state.chemDrawDocument?.pages[0]?.objects ?? []).filter(
          (object): object is ChemDrawGraphic =>
            object.type === 'graphic' && object.graphicType === 'curve',
        );
        const handle = findCurveHandle(curves, point, options.handleTolerance ?? 6);
        const curve = handle && curves.find((entry) => entry.id === handle.curveId);
        if (handle && curve) {
          latest.current = {
            kind,
            start: point,
            path: [point],
            editing: { curve, index: handle.index },
            objects: [curve],
            bigEnough: false,
          };
          setPreview(null);
          return;
        }
        // A click on a curve's stroke selects it, which shows its handles.
        const clicked = curves.find((entry) => {
          const closed =
            entry.closed === true || ((entry.curveType ?? 0) & CURVE_TYPE.closed) !== 0;
          const samples = sampleCurve(curveSegments(entry.points ?? [], closed));
          return samples.some(
            (sample) =>
              Math.hypot(sample.x - point.x, sample.y - point.y) <= (options.handleTolerance ?? 6),
          );
        });
        if (clicked) {
          lifecycle.current.cancel();
          latest.current = null;
          state.setSelectedObjectIds(new Set([clicked.id]));
          return;
        }
        // A click away from every handle adds a segment to the selected curve.
        const target = curves.find((entry) => state.selectedObjectIds.has(entry.id));
        if (!target) {
          lifecycle.current.cancel();
          latest.current = null;
          return;
        }
        latest.current = {
          kind,
          start: point,
          path: [point],
          objects: [appendCurveSegment(target, point)],
          bigEnough: true,
        };
        setPreview(latest.current.objects);
        return;
      }
      latest.current = {
        kind,
        start: point,
        symbolSize: options.symbolSize,
        orbitalSize: options.orbitalSize,
        path: [point],
        ...(kind === 'curve'
          ? { objects: [], bigEnough: false }
          : build(kind, point, point, false, options.symbolSize, options.orbitalSize)),
      };
      setPreview(isClickPlacedShape(kind) || isOrbitalShape(kind) ? latest.current.objects : null);
    },
    update(point: ChemDrawPoint, shift = false) {
      const current = latest.current;
      if (!current || isClickPlacedShape(current.kind)) return;
      if (current.kind === 'edit-curve') {
        if (!current.editing) return;
        lifecycle.current.update({ point, hit: null, modifiers: { primary: false, shift } });
        const moved = Math.hypot(point.x - current.start.x, point.y - current.start.y) > 0.5;
        latest.current = {
          ...current,
          objects: [moveCurveHandle(current.editing.curve, current.editing.index, point)],
          bigEnough: moved,
        };
        setPreview(moved ? latest.current.objects : null);
        return;
      }
      lifecycle.current.update({ point, hit: null, modifiers: { primary: false, shift } });
      if (current.kind === 'curve') {
        const path = [...current.path, point];
        const curve = createFreehandCurve('__preview-shape', path);
        latest.current = { ...current, path, objects: curve ? [curve] : [], bigEnough: !!curve };
      } else {
        latest.current = {
          ...current,
          ...build(
            current.kind,
            current.start,
            point,
            shift,
            current.symbolSize,
            current.orbitalSize,
          ),
        };
      }
      setPreview(latest.current.bigEnough ? latest.current.objects : null);
    },
    /** The finished objects with fresh ids, or null when there is nothing to commit. */
    commit(): ChemDrawObject[] | null {
      const drag = latest.current;
      const accepted = lifecycle.current.commit(useStore.getState().chemDrawDocument);
      latest.current = null;
      setPreview(null);
      if (!drag || !accepted || !drag.bigEnough) return null;
      // Edit Curve replaces the curve it edited; everything else is a new object.
      if (drag.kind === 'edit-curve') return drag.objects;
      return drag.objects.map((object) => ({ ...object, id: crypto.randomUUID() }));
    },
    cancel,
  };
}
