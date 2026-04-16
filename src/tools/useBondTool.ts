import { useState, useRef, useCallback } from 'react';
import { useStore } from '../store';
import type { Atom, Bond } from '../types/chemistry';
import { createReplaceDocumentCommand } from '../editor/commands';
import { SNAP_ANGLE } from '../lib/graph';
import { DEFAULT_DOUBLE_BOND_MODE, getNextDoubleBondToolMode } from '../lib/renderGeometry';
import { applyBondEdit, reverseBondDirection } from '../lib/chemdrawModel';
import { getPreferredAttachmentAngle, resolveChairAttachmentSnapping } from '../lib/ringTemplates';

export interface BondToolOverlay {
  activeAtomId: string | null;
  activeAtomIsNew: boolean;
  dragPreviewLine: {
    startX: number;
    startY: number;
    x2: number;
    y2: number;
    targetId?: string;
  } | null;
  isDragging: boolean;
}

export interface BondToolActions {
  onMouseDown: (pos: { x: number; y: number }, hitAtom: Atom | null, hitBond: Bond | null) => void;
  onMouseMove: (pos: { x: number; y: number }, hitAtom: Atom | null) => void;
  onMouseUp: () => void;
  cleanup: () => void;
}

export function useBondTool(): BondToolOverlay & BondToolActions {
  const [activeAtomId, setActiveAtomId] = useState<string | null>(null);
  const [activeAtomIsNew, setActiveAtomIsNew] = useState(false);
  const [dragPreviewLine, setDragPreviewLine] = useState<BondToolOverlay['dragPreviewLine']>(null);
  const [isDragging, setIsDragging] = useState(false);
  const activeAtomWasExisting = useRef(false);

  // Keep refs for stable use in callbacks
  const activeAtomIdRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const dragPreviewLineRef = useRef<BondToolOverlay['dragPreviewLine']>(null);

  const setActive = (id: string | null) => {
    activeAtomIdRef.current = id;
    setActiveAtomId(id);
  };
  const setDragging = (v: boolean) => {
    isDraggingRef.current = v;
    setIsDragging(v);
  };
  const setPreview = (v: BondToolOverlay['dragPreviewLine']) => {
    dragPreviewLineRef.current = v;
    setDragPreviewLine(v);
  };

  const onMouseDown = useCallback(
    (pos: { x: number; y: number }, hitAtom: Atom | null, hitBond: Bond | null) => {
      const {
        atoms,
        bonds,
        arrows,
        groups,
        textBoxes,
        pushToHistory,
        setCurrentCanvasState,
        bondOrder,
        stereo,
        setLastInteractedAtomId,
        chemDrawDocument,
      } = useStore.getState();

      if (hitAtom) {
        activeAtomWasExisting.current = true;
        setActiveAtomIsNew(false);
        setDragging(true);
        setActive(hitAtom.id);
        setPreview({ startX: hitAtom.x, startY: hitAtom.y, x2: hitAtom.x, y2: hitAtom.y });
      } else if (hitBond) {
        const isPlainDoubleTool = bondOrder === 2 && stereo === 0;
        if (chemDrawDocument) {
          const nextDocument =
            hitBond.stereo === stereo && stereo !== 0
              ? reverseBondDirection(chemDrawDocument, hitBond.id)
              : isPlainDoubleTool
                ? applyBondEdit(chemDrawDocument, hitBond.id, {
                    order: 2,
                    stereo: 0,
                    doubleBondMode: getNextDoubleBondToolMode(hitBond),
                  })
                : applyBondEdit(chemDrawDocument, hitBond.id, { order: bondOrder, stereo });
          useStore
            .getState()
            .dispatchEditorCommand(createReplaceDocumentCommand(nextDocument, 'edit-bond'));
        } else if (hitBond.stereo === stereo && stereo !== 0) {
          pushToHistory({
            atoms,
            bonds: bonds.map((b) => (b.id === hitBond.id ? { ...b, from: b.to, to: b.from } : b)),
            arrows,
            groups: groups ?? [],
            textBoxes: textBoxes ?? [],
          });
        } else {
          pushToHistory({
            atoms,
            bonds: bonds.map((b) =>
              b.id === hitBond.id
                ? isPlainDoubleTool
                  ? {
                      ...b,
                      order: 2,
                      stereo: 0,
                      doubleBondMode: getNextDoubleBondToolMode(hitBond),
                    }
                  : {
                      ...b,
                      order: bondOrder,
                      stereo,
                      doubleBondMode:
                        bondOrder === 2 && stereo === 0
                          ? (b.doubleBondMode ?? DEFAULT_DOUBLE_BOND_MODE)
                          : undefined,
                    }
                : b,
            ),
            arrows,
            groups: groups ?? [],
            textBoxes: textBoxes ?? [],
          });
        }
      } else {
        activeAtomWasExisting.current = false;
        setActiveAtomIsNew(true);
        const nid = crypto.randomUUID();
        setLastInteractedAtomId(nid);
        setCurrentCanvasState({
          atoms: [...atoms, { id: nid, x: pos.x, y: pos.y, kind: 'element', element: 'C' }],
          bonds,
          arrows,
          groups: groups ?? [],
          textBoxes: textBoxes ?? [],
        });
        setDragging(true);
        setActive(nid);
        setPreview({ startX: pos.x, startY: pos.y, x2: pos.x, y2: pos.y });
      }
    },
    [],
  );

  const onMouseMove = useCallback((pos: { x: number; y: number }, hitAtom: Atom | null) => {
    if (!isDraggingRef.current || !activeAtomIdRef.current) return;
    const { atoms, bonds, documentStyleSettings } = useStore.getState();
    const bondLength = documentStyleSettings.bondLength;
    const start = atoms.find((a) => a.id === activeAtomIdRef.current);
    if (!start) return;

    if (hitAtom && hitAtom.id !== activeAtomIdRef.current) {
      setPreview({
        startX: start.x,
        startY: start.y,
        x2: hitAtom.x,
        y2: hitAtom.y,
        targetId: hitAtom.id,
      });
    } else {
      const chairSnap = resolveChairAttachmentSnapping({
        atomId: start.id,
        atoms,
        bonds,
        bondLength,
        pointer: pos,
      });
      if (chairSnap?.selectedCandidate) {
        setPreview({
          startX: start.x,
          startY: start.y,
          x2: chairSnap.selectedCandidate.x,
          y2: chairSnap.selectedCandidate.y,
        });
        return;
      }

      const dx = pos.x - start.x;
      const dy = pos.y - start.y;
      const angle = Math.round(Math.atan2(dy, dx) / SNAP_ANGLE) * SNAP_ANGLE;
      setPreview({
        startX: start.x,
        startY: start.y,
        x2: start.x + Math.cos(angle) * bondLength,
        y2: start.y + Math.sin(angle) * bondLength,
      });
    }
  }, []);

  const onMouseUp = useCallback(() => {
    if (!isDraggingRef.current) return;
    setDragging(false);

    const {
      atoms,
      bonds,
      arrows,
      groups,
      textBoxes,
      pushToHistory,
      setCurrentCanvasState,
      bondOrder,
      stereo,
      history,
      historyIndex,
      documentStyleSettings,
    } = useStore.getState();
    const bondLength = documentStyleSettings.bondLength;
    const preview = dragPreviewLineRef.current;
    const aid = activeAtomIdRef.current;

    if (!aid || !preview) {
      setPreview(null);
      setActive(null);
      return;
    }

    const start = atoms.find((a) => a.id === aid);
    if (!start) {
      setPreview(null);
      setActive(null);
      return;
    }

    let finalX = preview.x2,
      finalY = preview.y2;
    let targetId = preview.targetId;

    if (Math.sqrt((finalX - start.x) ** 2 + (finalY - start.y) ** 2) < 5 && !targetId) {
      const fallbackAngle = getPreferredAttachmentAngle(start, atoms, bonds, false);
      const chairSnap = resolveChairAttachmentSnapping({
        atomId: aid,
        atoms,
        bonds,
        bondLength,
        fallbackAngle,
      });
      if (chairSnap?.quickClickCandidate) {
        finalX = chairSnap.quickClickCandidate.x;
        finalY = chairSnap.quickClickCandidate.y;
      } else {
        finalX = start.x + Math.cos(fallbackAngle) * bondLength;
        finalY = start.y + Math.sin(fallbackAngle) * bondLength;
      }
    }

    const newAtoms = [...atoms];
    if (!targetId) {
      targetId = crypto.randomUUID();
      newAtoms.push({ id: targetId, x: finalX, y: finalY, kind: 'element', element: 'C' });
    }

    if (targetId !== aid) {
      const existing = bonds.find(
        (b) => (b.from === aid && b.to === targetId) || (b.from === targetId && b.to === aid),
      );
      let newBonds = [...bonds];
      if (existing) {
        newBonds = newBonds.map((b) =>
          b.id === existing.id
            ? {
                ...b,
                order: (b.order % 3) + 1,
                stereo: 0,
                doubleBondMode:
                  (b.order % 3) + 1 === 2
                    ? (b.doubleBondMode ?? DEFAULT_DOUBLE_BOND_MODE)
                    : undefined,
              }
            : b,
        );
      } else {
        newBonds.push({
          id: crypto.randomUUID(),
          from: aid,
          to: targetId,
          order: bondOrder,
          ...(bondOrder === 2 && stereo === 0
            ? { doubleBondMode: DEFAULT_DOUBLE_BOND_MODE }
            : {}),
          stereo,
        });
      }
      pushToHistory({
        atoms: newAtoms,
        bonds: newBonds,
        arrows,
        groups: groups ?? [],
        textBoxes: textBoxes ?? [],
      });
    } else {
      // Dragged onto self — restore
      if (historyIndex >= 0) setCurrentCanvasState(history[historyIndex]);
      else setCurrentCanvasState({ atoms: [], bonds: [], arrows: [], groups: [], textBoxes: [] });
    }
    setPreview(null);
    setActive(null);
    setActiveAtomIsNew(false);
  }, []);

  const cleanup = useCallback(() => {
    if (isDraggingRef.current && !activeAtomWasExisting.current) {
      const { history, historyIndex, setCurrentCanvasState } = useStore.getState();
      if (historyIndex >= 0) setCurrentCanvasState(history[historyIndex]);
      else setCurrentCanvasState({ atoms: [], bonds: [], arrows: [] });
    }
    setDragging(false);
    setPreview(null);
    setActive(null);
    setActiveAtomIsNew(false);
  }, []);

  return {
    activeAtomId,
    activeAtomIsNew,
    dragPreviewLine,
    isDragging,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    cleanup,
  };
}
