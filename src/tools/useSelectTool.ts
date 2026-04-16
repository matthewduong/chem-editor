import { useState, useRef, useCallback } from 'react';
import { useStore } from '../store';
import type { Atom, Bond, Arrow, TextBox } from '../types/chemistry';
import type { ChemDrawDocument } from '../types/chemdraw';
import {
  createMoveSelectionCommand,
  createRotateSelectionCommand,
  createScaleSelectionCommand,
} from '../editor/commands';
import { SNAP_ANGLE } from '../lib/graph';
import { getArrowSelectionPoints } from '../lib/renderGeometry';

export interface SelectToolOverlay {
  isDragging: boolean;
  isRotating: boolean;
  isScaling: boolean;
  isSelectionBoxActive: boolean;
  selectionBoxStart: { x: number; y: number } | null;
  selectionBoxEnd: { x: number; y: number } | null;
}

export interface ScaleHandleHit {
  anchorX: number;
  anchorY: number;
}

export interface SelectToolActions {
  onMouseDown: (
    pos: { x: number; y: number },
    hitAtom: Atom | null,
    hitBond: Bond | null,
    hitArrow: Arrow | null,
    isShiftDown: boolean,
    selectionCenter: { x: number; y: number } | null,
    hitTextBox?: TextBox | null,
    hitScaleHandle?: ScaleHandleHit | null,
    hitObjectId?: string | null,
  ) => void;
  onMouseMove: (pos: { x: number; y: number }, hitAtom: Atom | null, isShiftDown: boolean) => void;
  onMouseUp: () => void;
  cleanup: () => void;
}

function collectMovedAtomIds(
  selectedAtomIds: Set<string>,
  selectedBondIds: Set<string>,
  bonds: Bond[],
): Set<string> {
  const movedAtomIds = new Set(selectedAtomIds);
  selectedBondIds.forEach((bondId) => {
    const bond = bonds.find((entry) => entry.id === bondId);
    if (!bond) return;
    movedAtomIds.add(bond.from);
    movedAtomIds.add(bond.to);
  });
  return movedAtomIds;
}

function collectAffectedBondIds(movedAtomIds: Set<string>, bonds: Bond[]): Set<string> {
  return new Set(
    bonds
      .filter((bond) => movedAtomIds.has(bond.from) || movedAtomIds.has(bond.to))
      .map((bond) => bond.id),
  );
}

export function useSelectTool(): SelectToolOverlay & SelectToolActions {
  const [isDragging, setIsDragging] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [isScaling, setIsScaling] = useState(false);
  const [isSelectionBoxActive, setIsSelectionBoxActive] = useState(false);
  const [selectionBoxStart, setSelectionBoxStart] = useState<{ x: number; y: number } | null>(null);
  const [selectionBoxEnd, setSelectionBoxEnd] = useState<{ x: number; y: number } | null>(null);

  const isDraggingRef = useRef(false);
  const isRotatingRef = useRef(false);
  const isScalingRef = useRef(false);
  const isSelectionBoxRef = useRef(false);
  const dragStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const moveDataRef = useRef<{
    sourceDocument: ChemDrawDocument | null;
    totalDx: number;
    totalDy: number;
    selectedObjectIds: Set<string>;
    movedAtomIds: Set<string>;
    affectedBondIds: Set<string>;
  } | null>(null);
  const rotateDataRef = useRef<{
    sourceDocument: ChemDrawDocument | null;
    center: { x: number; y: number };
    totalRadians: number;
    selectedObjectIds: Set<string>;
    movedAtomIds: Set<string>;
    affectedBondIds: Set<string>;
  } | null>(null);
  const scaleDataRef = useRef<{
    anchorX: number;
    anchorY: number;
    startX: number;
    startY: number;
    origAtoms: Atom[];
    origArrows: Arrow[];
    origTBs: TextBox[];
    sourceDocument: ChemDrawDocument | null;
    selectedObjectIds: Set<string>;
    movedAtomIds: Set<string>;
    affectedBondIds: Set<string>;
    factor: number;
  } | null>(null);

  const setDragging = (v: boolean) => {
    isDraggingRef.current = v;
    setIsDragging(v);
  };
  const setRotating = (v: boolean) => {
    isRotatingRef.current = v;
    setIsRotating(v);
  };
  const setScalingState = (v: boolean) => {
    isScalingRef.current = v;
    setIsScaling(v);
  };
  const setSelectionBox = (v: boolean) => {
    isSelectionBoxRef.current = v;
    setIsSelectionBoxActive(v);
  };

  const onMouseDown = useCallback(
    (
      pos: { x: number; y: number },
      hitAtom: Atom | null,
      hitBond: Bond | null,
      hitArrow: Arrow | null,
      isShiftDown: boolean,
      selectionCenter: { x: number; y: number } | null,
      hitTextBox?: TextBox | null,
      hitScaleHandle?: ScaleHandleHit | null,
      hitObjectId?: string | null,
    ) => {
      const {
        atoms,
        bonds,
        arrows,
        groups,
        textBoxes,
        pushToHistory,
        selectedObjectIds,
        selectedAtomIds,
        selectedBondIds,
        selectedArrowIds,
        selectedTextBoxIds,
        chemDrawDocument,
        setSelectedObjectIds,
        setSelectedAtomIds,
        setSelectedBondIds,
        setSelectedArrowIds,
        setSelectedTextBoxIds,
        clearPreviewChemDrawDocument,
        clearSelectionPreviewTransform,
      } = useStore.getState();

      clearPreviewChemDrawDocument();
      clearSelectionPreviewTransform();

      // Check for scale handle
      if (hitScaleHandle) {
        scaleDataRef.current = {
          anchorX: hitScaleHandle.anchorX,
          anchorY: hitScaleHandle.anchorY,
          startX: pos.x,
          startY: pos.y,
          origAtoms: atoms.filter((a) => selectedAtomIds.has(a.id)),
          origArrows: arrows.filter((a) => selectedArrowIds.has(a.id)),
          origTBs: (textBoxes ?? []).filter((t) => selectedTextBoxIds.has(t.id)),
          sourceDocument: chemDrawDocument,
          selectedObjectIds: new Set(selectedObjectIds),
          movedAtomIds: collectMovedAtomIds(selectedAtomIds, selectedBondIds, bonds),
          affectedBondIds: collectAffectedBondIds(
            collectMovedAtomIds(selectedAtomIds, selectedBondIds, bonds),
            bonds,
          ),
          factor: 1,
        };
        setScalingState(true);
        return;
      }

      // Check for rotation handle
      const hasSelection =
        selectedObjectIds.size > 0 ||
        selectedAtomIds.size > 0 ||
        selectedBondIds.size > 0 ||
        selectedArrowIds.size > 0 ||
        selectedTextBoxIds.size > 0;
      if (hasSelection && selectionCenter) {
        if (Math.sqrt((pos.x - selectionCenter.x) ** 2 + (pos.y - selectionCenter.y) ** 2) < 15) {
          rotateDataRef.current = {
            sourceDocument: chemDrawDocument,
            center: selectionCenter,
            totalRadians: 0,
            selectedObjectIds: new Set(selectedObjectIds),
            movedAtomIds: collectMovedAtomIds(selectedAtomIds, selectedBondIds, bonds),
            affectedBondIds: collectAffectedBondIds(
              collectMovedAtomIds(selectedAtomIds, selectedBondIds, bonds),
              bonds,
            ),
          };
          setRotating(true);
          dragStartPosRef.current = pos;
          return;
        }
      }

      if (hitTextBox) {
        if (isShiftDown) {
          const n = new Set(selectedTextBoxIds);
          if (n.has(hitTextBox.id)) n.delete(hitTextBox.id);
          else n.add(hitTextBox.id);
          setSelectedTextBoxIds(n);
        } else {
          if (!selectedTextBoxIds.has(hitTextBox.id)) {
            setSelectedTextBoxIds(new Set([hitTextBox.id]));
            setSelectedAtomIds(new Set());
            setSelectedBondIds(new Set());
            setSelectedArrowIds(new Set());
          }
        }
        setDragging(true);
        dragStartPosRef.current = pos;
        moveDataRef.current = {
          sourceDocument: chemDrawDocument,
          totalDx: 0,
          totalDy: 0,
          selectedObjectIds: new Set(useStore.getState().selectedObjectIds),
          movedAtomIds: collectMovedAtomIds(
            useStore.getState().selectedAtomIds,
            useStore.getState().selectedBondIds,
            bonds,
          ),
          affectedBondIds: collectAffectedBondIds(
            collectMovedAtomIds(
              useStore.getState().selectedAtomIds,
              useStore.getState().selectedBondIds,
              bonds,
            ),
            bonds,
          ),
        };
      } else if (hitAtom) {
        if (isShiftDown) {
          const s = new Set(selectedAtomIds);
          if (s.has(hitAtom.id)) s.delete(hitAtom.id);
          else s.add(hitAtom.id);
          setSelectedAtomIds(s);
        } else {
          if (!selectedAtomIds.has(hitAtom.id)) {
            setSelectedAtomIds(new Set([hitAtom.id]));
            setSelectedBondIds(new Set());
            setSelectedArrowIds(new Set());
            setSelectedTextBoxIds(new Set());
          }
        }
        setDragging(true);
        dragStartPosRef.current = pos;
        moveDataRef.current = {
          sourceDocument: chemDrawDocument,
          totalDx: 0,
          totalDy: 0,
          selectedObjectIds: new Set(useStore.getState().selectedObjectIds),
          movedAtomIds: collectMovedAtomIds(
            useStore.getState().selectedAtomIds,
            useStore.getState().selectedBondIds,
            bonds,
          ),
          affectedBondIds: collectAffectedBondIds(
            collectMovedAtomIds(
              useStore.getState().selectedAtomIds,
              useStore.getState().selectedBondIds,
              bonds,
            ),
            bonds,
          ),
        };
      } else if (hitBond) {
        if (isShiftDown) {
          const s = new Set(selectedBondIds);
          if (s.has(hitBond.id)) s.delete(hitBond.id);
          else s.add(hitBond.id);
          setSelectedBondIds(s);
        } else {
          if (selectedBondIds.has(hitBond.id)) {
            pushToHistory({
              atoms,
              bonds: bonds.map((b) =>
                b.id === hitBond.id ? { ...b, order: (b.order % 3) + 1, stereo: 0 } : b,
              ),
              arrows,
              groups: groups ?? [],
              textBoxes: textBoxes ?? [],
            });
          } else {
            setSelectedBondIds(new Set([hitBond.id]));
            setSelectedAtomIds(new Set());
            setSelectedArrowIds(new Set());
            setSelectedTextBoxIds(new Set());
            setDragging(true);
            dragStartPosRef.current = pos;
            moveDataRef.current = {
              sourceDocument: chemDrawDocument,
              totalDx: 0,
              totalDy: 0,
              selectedObjectIds: new Set(useStore.getState().selectedObjectIds),
              movedAtomIds: collectMovedAtomIds(
                useStore.getState().selectedAtomIds,
                useStore.getState().selectedBondIds,
                bonds,
              ),
              affectedBondIds: collectAffectedBondIds(
                collectMovedAtomIds(
                  useStore.getState().selectedAtomIds,
                  useStore.getState().selectedBondIds,
                  bonds,
                ),
                bonds,
              ),
            };
          }
        }
      } else if (hitArrow) {
        if (isShiftDown) {
          const n = new Set(selectedArrowIds);
          if (n.has(hitArrow.id)) n.delete(hitArrow.id);
          else n.add(hitArrow.id);
          setSelectedArrowIds(n);
        } else {
          if (!selectedArrowIds.has(hitArrow.id)) {
            setSelectedArrowIds(new Set([hitArrow.id]));
            setSelectedAtomIds(new Set());
            setSelectedBondIds(new Set());
            setSelectedTextBoxIds(new Set());
          }
        }
        setDragging(true);
        dragStartPosRef.current = pos;
        moveDataRef.current = {
          sourceDocument: chemDrawDocument,
          totalDx: 0,
          totalDy: 0,
          selectedObjectIds: new Set(useStore.getState().selectedObjectIds),
          movedAtomIds: collectMovedAtomIds(
            useStore.getState().selectedAtomIds,
            useStore.getState().selectedBondIds,
            bonds,
          ),
          affectedBondIds: collectAffectedBondIds(
            collectMovedAtomIds(
              useStore.getState().selectedAtomIds,
              useStore.getState().selectedBondIds,
              bonds,
            ),
            bonds,
          ),
        };
      } else if (hitObjectId) {
        if (isShiftDown) {
          const next = new Set(selectedObjectIds);
          if (next.has(hitObjectId)) next.delete(hitObjectId);
          else next.add(hitObjectId);
          setSelectedObjectIds(next);
        } else {
          if (!selectedObjectIds.has(hitObjectId)) {
            setSelectedObjectIds(new Set([hitObjectId]));
            setSelectedAtomIds(new Set());
            setSelectedBondIds(new Set());
            setSelectedArrowIds(new Set());
            setSelectedTextBoxIds(new Set());
          }
        }
        setDragging(true);
        dragStartPosRef.current = pos;
        moveDataRef.current = {
          sourceDocument: chemDrawDocument,
          totalDx: 0,
          totalDy: 0,
          selectedObjectIds: new Set(useStore.getState().selectedObjectIds),
          movedAtomIds: collectMovedAtomIds(
            useStore.getState().selectedAtomIds,
            useStore.getState().selectedBondIds,
            bonds,
          ),
          affectedBondIds: collectAffectedBondIds(
            collectMovedAtomIds(
              useStore.getState().selectedAtomIds,
              useStore.getState().selectedBondIds,
              bonds,
            ),
            bonds,
          ),
        };
      } else {
        if (!isShiftDown) {
          setSelectedAtomIds(new Set());
          setSelectedBondIds(new Set());
          setSelectedArrowIds(new Set());
          setSelectedTextBoxIds(new Set());
        }
        setSelectionBox(true);
        setSelectionBoxStart(pos);
        setSelectionBoxEnd(pos);
      }
    },
    [],
  );

  const onMouseMove = useCallback(
    (pos: { x: number; y: number }, _hitAtom: Atom | null, isShiftDown: boolean) => {
      if (isScalingRef.current && scaleDataRef.current) {
        const {
          atoms,
          bonds,
          arrows,
          groups,
          textBoxes,
          selectedObjectIds,
          setSelectionPreviewTransform,
          setCurrentCanvasState,
        } = useStore.getState();
        const { anchorX, anchorY, startX, startY, origAtoms, origArrows, origTBs } =
          scaleDataRef.current;
        const dStartX = startX - anchorX,
          dStartY = startY - anchorY;
        const dCurrX = pos.x - anchorX,
          dCurrY = pos.y - anchorY;
        let scaleX = dStartX !== 0 ? dCurrX / dStartX : 1;
        let scaleY = dStartY !== 0 ? dCurrY / dStartY : 1;
        if (!isFinite(scaleX)) scaleX = 1;
        if (!isFinite(scaleY)) scaleY = 1;
        if (isShiftDown) {
          const origDist = Math.hypot(dStartX, dStartY);
          const currDist = Math.hypot(dCurrX, dCurrY);
          const sign = Math.sign(dCurrX * dStartX + dCurrY * dStartY);
          const uni = origDist > 0 ? (sign * currDist) / origDist : 1;
          scaleX = uni;
          scaleY = uni;
        }
        if (scaleDataRef.current) {
          const factor = Math.abs(scaleY !== 0 ? scaleY : scaleX);
          scaleDataRef.current.factor = factor;
          const selectionIds =
            scaleDataRef.current.selectedObjectIds.size > 0
              ? scaleDataRef.current.selectedObjectIds
              : selectedObjectIds;
          if (scaleDataRef.current.sourceDocument && selectionIds.size > 0) {
            setSelectionPreviewTransform({
              kind: 'scale',
              selectedObjectIds: new Set(selectionIds),
              movedAtomIds: scaleDataRef.current.movedAtomIds,
              affectedBondIds: scaleDataRef.current.affectedBondIds,
              anchor: { x: anchorX, y: anchorY },
              factor,
            });
            return;
          }
        }
        const sp = (ox: number, oy: number) => ({
          x: anchorX + (ox - anchorX) * scaleX,
          y: anchorY + (oy - anchorY) * scaleY,
        });
        const aMap = new Map(origAtoms.map((a) => [a.id, a]));
        const arMap = new Map(origArrows.map((a) => [a.id, a]));
        const tMap = new Map(origTBs.map((t) => [t.id, t]));
        setCurrentCanvasState({
          atoms: atoms.map((a) => {
            const o = aMap.get(a.id);
            if (!o) return a;
            const r = sp(o.x, o.y);
            return { ...a, x: r.x, y: r.y };
          }),
          bonds,
          arrows: arrows.map((a) => {
            const o = arMap.get(a.id);
            if (!o) return a;
            const r1 = sp(o.x1, o.y1),
              r2 = sp(o.x2, o.y2),
              rc = sp(o.cpx, o.cpy);
            return { ...a, x1: r1.x, y1: r1.y, x2: r2.x, y2: r2.y, cpx: rc.x, cpy: rc.y };
          }),
          groups: groups ?? [],
          textBoxes: (textBoxes ?? []).map((t) => {
            const o = tMap.get(t.id);
            if (!o) return t;
            const r = sp(o.x, o.y);
            const newFontSize = Math.max(6, o.fontSize * Math.abs(scaleY !== 0 ? scaleY : scaleX));
            return { ...t, x: r.x, y: r.y, fontSize: newFontSize };
          }),
        });
        return;
      }

      if (isRotatingRef.current && dragStartPosRef.current) {
        const {
          atoms,
          selectedAtomIds,
          selectedBondIds,
          selectedArrowIds,
          selectedTextBoxIds,
          setSelectionPreviewTransform,
          setCurrentCanvasState,
          bonds,
          arrows,
          groups,
          textBoxes,
        } = useStore.getState();
        const movedAtomIds = new Set(selectedAtomIds);
        selectedBondIds.forEach((bondId) => {
          const bond = bonds.find((entry) => entry.id === bondId);
          if (!bond) return;
          movedAtomIds.add(bond.from);
          movedAtomIds.add(bond.to);
        });
        const selAtoms = atoms.filter((a) => movedAtomIds.has(a.id));
        const selArrows = arrows.filter((a) => selectedArrowIds.has(a.id));
        const selTBs = (textBoxes ?? []).filter((t) => selectedTextBoxIds.has(t.id));
        const pts = [
          ...selAtoms.map((a) => ({ x: a.x, y: a.y })),
          ...selArrows.flatMap((a) => getArrowSelectionPoints(a)),
          ...selTBs.map((t) => {
            const numLines = 1 + t.runs.filter((r) => r.text === '\n').length;
            return { x: t.x, y: t.y + (numLines * t.fontSize) / 2 };
          }),
        ];
        if (!pts.length) return;
        const center = {
          x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
          y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
        };
        const oldA = Math.atan2(
          dragStartPosRef.current.y - center.y,
          dragStartPosRef.current.x - center.x,
        );
        const newA = Math.atan2(pos.y - center.y, pos.x - center.x);
        let da = newA - oldA;
        if (isShiftDown) da = Math.round(da / SNAP_ANGLE) * SNAP_ANGLE;
        dragStartPosRef.current = pos;
        if (rotateDataRef.current) {
          rotateDataRef.current.totalRadians += da;
          if (
            rotateDataRef.current.sourceDocument &&
            rotateDataRef.current.selectedObjectIds.size > 0
          ) {
            setSelectionPreviewTransform({
              kind: 'rotate',
              selectedObjectIds: rotateDataRef.current.selectedObjectIds,
              movedAtomIds: rotateDataRef.current.movedAtomIds,
              affectedBondIds: rotateDataRef.current.affectedBondIds,
              center: rotateDataRef.current.center,
              radians: rotateDataRef.current.totalRadians,
            });
            return;
          }
        }
        const rot = (x: number, y: number) => ({
          x: center.x + (x - center.x) * Math.cos(da) - (y - center.y) * Math.sin(da),
          y: center.y + (x - center.x) * Math.sin(da) + (y - center.y) * Math.cos(da),
        });
        setCurrentCanvasState({
          atoms: atoms.map((a) => {
            if (!selectedAtomIds.has(a.id)) return a;
            const r = rot(a.x, a.y);
            return { ...a, x: r.x, y: r.y };
          }),
          bonds,
          arrows: arrows.map((a) => {
            if (!selectedArrowIds.has(a.id)) return a;
            const r1 = rot(a.x1, a.y1),
              r2 = rot(a.x2, a.y2),
              rc = rot(a.cpx, a.cpy);
            return { ...a, x1: r1.x, y1: r1.y, x2: r2.x, y2: r2.y, cpx: rc.x, cpy: rc.y };
          }),
          groups: groups ?? [],
          textBoxes: (textBoxes ?? []).map((t) => {
            if (!selectedTextBoxIds.has(t.id)) return t;
            const numLines = 1 + t.runs.filter((r) => r.text === '\n').length;
            const textH = numLines * t.fontSize;
            const tbCenter = rot(t.x, t.y + textH / 2);
            const newRotation = ((t.rotation ?? 0) + (da * 180) / Math.PI + 360) % 360;
            return { ...t, x: tbCenter.x, y: tbCenter.y - textH / 2, rotation: newRotation };
          }),
        });
        return;
      }

      if (isSelectionBoxRef.current && selectionBoxStart) {
        setSelectionBoxEnd(pos);
        const x1 = Math.min(selectionBoxStart.x, pos.x),
          x2 = Math.max(selectionBoxStart.x, pos.x);
        const y1 = Math.min(selectionBoxStart.y, pos.y),
          y2 = Math.max(selectionBoxStart.y, pos.y);
        const {
          atoms,
          bonds,
          arrows,
          textBoxes,
          selectedObjectIds,
          selectedAtomIds,
          selectedBondIds,
          selectedArrowIds,
          selectedTextBoxIds,
          setSelectedObjectIds,
          setSelectedAtomIds,
          setSelectedBondIds,
          setSelectedArrowIds,
          setSelectedTextBoxIds,
          chemDrawDocument,
        } = useStore.getState();

        const inBoxAtoms = atoms
          .filter((a) => a.x >= x1 && a.x <= x2 && a.y >= y1 && a.y <= y2)
          .map((a) => a.id);
        setSelectedAtomIds(
          isShiftDown ? new Set([...selectedAtomIds, ...inBoxAtoms]) : new Set(inBoxAtoms),
        );

        const inBoxBonds = bonds
          .filter((b) => {
            const a1 = atoms.find((a) => a.id === b.from);
            const a2 = atoms.find((a) => a.id === b.to);
            if (!a1 || !a2) return false;
            const mx = (a1.x + a2.x) / 2;
            const my = (a1.y + a2.y) / 2;
            return mx >= x1 && mx <= x2 && my >= y1 && my <= y2;
          })
          .map((b) => b.id);
        setSelectedBondIds(
          isShiftDown ? new Set([...selectedBondIds, ...inBoxBonds]) : new Set(inBoxBonds),
        );

        // Arrows: include if midpoint is in box
        const inBoxArrows = arrows
          .filter((a) => {
            const mx = (a.x1 + a.x2) / 2,
              my = (a.y1 + a.y2) / 2;
            return mx >= x1 && mx <= x2 && my >= y1 && my <= y2;
          })
          .map((a) => a.id);
        setSelectedArrowIds(
          isShiftDown ? new Set([...selectedArrowIds, ...inBoxArrows]) : new Set(inBoxArrows),
        );

        // Text boxes: include if anchor point is in box
        const inBoxTBs = (textBoxes ?? [])
          .filter((t) => t.x >= x1 && t.x <= x2 && t.y >= y1 && t.y <= y2)
          .map((t) => t.id);
        setSelectedTextBoxIds(
          isShiftDown ? new Set([...selectedTextBoxIds, ...inBoxTBs]) : new Set(inBoxTBs),
        );
        const inBoxObjects: string[] = [];
        chemDrawDocument?.pages[0]?.objects.forEach((object) => {
          if (object.type === 'bracket') {
            if (
              !(
                object.bounds.right < x1 ||
                object.bounds.left > x2 ||
                object.bounds.bottom < y1 ||
                object.bounds.top > y2
              )
            )
              inBoxObjects.push(object.id);
          } else if (object.type === 'graphic') {
            const bounds =
              object.bounds ??
              (object.points?.length
                ? {
                    left: Math.min(...object.points.map((point) => point.x)),
                    top: Math.min(...object.points.map((point) => point.y)),
                    right: Math.max(...object.points.map((point) => point.x)),
                    bottom: Math.max(...object.points.map((point) => point.y)),
                  }
                : null);
            if (
              bounds &&
              !(bounds.right < x1 || bounds.left > x2 || bounds.bottom < y1 || bounds.top > y2)
            )
              inBoxObjects.push(object.id);
          }
        });
        setSelectedObjectIds(
          isShiftDown
            ? new Set([
                ...selectedObjectIds,
                ...inBoxAtoms,
                ...inBoxBonds,
                ...inBoxArrows,
                ...inBoxTBs,
                ...inBoxObjects,
              ])
            : new Set([...inBoxAtoms, ...inBoxBonds, ...inBoxArrows, ...inBoxTBs, ...inBoxObjects]),
        );
        return;
      }

      if (
        isDraggingRef.current &&
        !isRotatingRef.current &&
        !isSelectionBoxRef.current &&
        dragStartPosRef.current
      ) {
        const {
          atoms,
          bonds,
          selectedAtomIds,
          selectedBondIds,
          selectedArrowIds,
          selectedTextBoxIds,
          setSelectionPreviewTransform,
          arrows,
          groups,
          textBoxes,
          setCurrentCanvasState,
        } = useStore.getState();
        const hasSelection =
          selectedAtomIds.size > 0 ||
          selectedBondIds.size > 0 ||
          selectedArrowIds.size > 0 ||
          selectedTextBoxIds.size > 0;
        if (!hasSelection) return;
        const dx = pos.x - dragStartPosRef.current.x,
          dy = pos.y - dragStartPosRef.current.y;
        dragStartPosRef.current = pos;
        if (moveDataRef.current) {
          moveDataRef.current.totalDx += dx;
          moveDataRef.current.totalDy += dy;
          const selectionIds =
            moveDataRef.current.selectedObjectIds.size > 0
              ? moveDataRef.current.selectedObjectIds
              : useStore.getState().selectedObjectIds;
          if (moveDataRef.current.sourceDocument && selectionIds.size > 0) {
            setSelectionPreviewTransform({
              kind: 'move',
              selectedObjectIds: new Set(selectionIds),
              movedAtomIds: moveDataRef.current.movedAtomIds,
              affectedBondIds: moveDataRef.current.affectedBondIds,
              dx: moveDataRef.current.totalDx,
              dy: moveDataRef.current.totalDy,
            });
            return;
          }
        }
        const movedAtomIds = new Set(selectedAtomIds);
        selectedBondIds.forEach((bondId) => {
          const bond = bonds.find((entry) => entry.id === bondId);
          if (!bond) return;
          movedAtomIds.add(bond.from);
          movedAtomIds.add(bond.to);
        });
        setCurrentCanvasState({
          atoms: atoms.map((a) =>
            movedAtomIds.has(a.id) ? { ...a, x: a.x + dx, y: a.y + dy } : a,
          ),
          bonds,
          arrows: arrows.map((a) =>
            selectedArrowIds.has(a.id)
              ? {
                  ...a,
                  x1: a.x1 + dx,
                  y1: a.y1 + dy,
                  x2: a.x2 + dx,
                  y2: a.y2 + dy,
                  cpx: a.cpx + dx,
                  cpy: a.cpy + dy,
                }
              : a,
          ),
          groups: groups ?? [],
          textBoxes: (textBoxes ?? []).map((t) =>
            selectedTextBoxIds.has(t.id) ? { ...t, x: t.x + dx, y: t.y + dy } : t,
          ),
        });
      }
    },
    [selectionBoxStart],
  );

  const onMouseUp = useCallback(() => {
    if (isScalingRef.current) {
      setScalingState(false);
      const {
        atoms,
        bonds,
        arrows,
        groups,
        textBoxes,
        pushToHistory,
        dispatchEditorCommand,
        clearSelectionPreviewTransform,
      } = useStore.getState();
      const scaleData = scaleDataRef.current;
      scaleDataRef.current = null;
      if (scaleData?.sourceDocument && scaleData.selectedObjectIds.size > 0) {
        clearSelectionPreviewTransform();
        if (Math.abs(scaleData.factor - 1) > 0.0001) {
          dispatchEditorCommand(
            createScaleSelectionCommand(
              { x: scaleData.anchorX, y: scaleData.anchorY },
              scaleData.factor,
              { objectIds: scaleData.selectedObjectIds, description: 'scale-selection' },
            ),
          );
        }
        return;
      }
      pushToHistory({ atoms, bonds, arrows, groups: groups ?? [], textBoxes: textBoxes ?? [] });
      return;
    }
    if (isRotatingRef.current) {
      setRotating(false);
      dragStartPosRef.current = null;
      const {
        atoms,
        bonds,
        arrows,
        groups,
        textBoxes,
        pushToHistory,
        dispatchEditorCommand,
        clearSelectionPreviewTransform,
      } = useStore.getState();
      const rotateData = rotateDataRef.current;
      rotateDataRef.current = null;
      if (rotateData?.sourceDocument && rotateData.selectedObjectIds.size > 0) {
        clearSelectionPreviewTransform();
        if (Math.abs(rotateData.totalRadians) > 0.0001) {
          dispatchEditorCommand(
            createRotateSelectionCommand(rotateData.center, rotateData.totalRadians, {
              objectIds: rotateData.selectedObjectIds,
              description: 'rotate-selection',
            }),
          );
        }
        return;
      }
      pushToHistory({ atoms, bonds, arrows, groups: groups ?? [], textBoxes: textBoxes ?? [] });
      return;
    }
    if (isSelectionBoxRef.current) {
      setSelectionBox(false);
      setSelectionBoxStart(null);
      setSelectionBoxEnd(null);
      moveDataRef.current = null;
      return;
    }
    if (isDraggingRef.current) {
      setDragging(false);
      dragStartPosRef.current = null;
      const {
        atoms,
        bonds,
        arrows,
        groups,
        textBoxes,
        pushToHistory,
        dispatchEditorCommand,
        clearSelectionPreviewTransform,
      } = useStore.getState();
      const moveData = moveDataRef.current;
      moveDataRef.current = null;
      if (moveData?.sourceDocument && moveData.selectedObjectIds.size > 0) {
        clearSelectionPreviewTransform();
        if (Math.abs(moveData.totalDx) > 0.0001 || Math.abs(moveData.totalDy) > 0.0001) {
          dispatchEditorCommand(
            createMoveSelectionCommand(
              { dx: moveData.totalDx, dy: moveData.totalDy },
              {
                objectIds: moveData.selectedObjectIds,
                description: 'move-selection',
              },
            ),
          );
        }
        return;
      }
      pushToHistory({ atoms, bonds, arrows, groups: groups ?? [], textBoxes: textBoxes ?? [] });
    }
  }, []);

  const cleanup = useCallback(() => {
    setDragging(false);
    setRotating(false);
    setScalingState(false);
    setSelectionBox(false);
    setSelectionBoxStart(null);
    setSelectionBoxEnd(null);
    dragStartPosRef.current = null;
    moveDataRef.current = null;
    rotateDataRef.current = null;
    scaleDataRef.current = null;
    useStore.getState().clearPreviewChemDrawDocument();
    useStore.getState().clearSelectionPreviewTransform();
  }, []);

  return {
    isDragging,
    isRotating,
    isScaling,
    isSelectionBoxActive,
    selectionBoxStart,
    selectionBoxEnd,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    cleanup,
  };
}
