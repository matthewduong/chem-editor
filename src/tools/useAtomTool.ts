import { useState, useRef, useCallback } from 'react';
import { useStore } from '../store';
import type { Atom } from '../types/chemistry';
import { createReplaceDocumentCommand } from '../editor/commands';
import { SNAP_ANGLE } from '../lib/graph';
import { applyNodeValueEdit } from '../lib/chemdrawModel';
import { setAliasAtomValue, setAtomValue } from '../lib/atomIdentity';
import { resolveChairAttachmentSnapping } from '../lib/ringTemplates';

export interface AtomToolOverlay {
  activeAtomId: string | null;
  dragPreviewLine: {
    startX: number;
    startY: number;
    x2: number;
    y2: number;
    targetId?: string;
  } | null;
  isDragging: boolean;
  editingAtomId: string | null;
  editingValue: string;
}

export interface AtomToolActions {
  onMouseDown: (pos: { x: number; y: number }, hitAtom: Atom | null) => void;
  onMouseMove: (pos: { x: number; y: number }, hitAtom: Atom | null) => void;
  onMouseUp: () => void;
  cleanup: () => void;
  openEditor: (id: string, value: string) => void;
  closeEditor: () => void;
  setEditingValue: (val: string) => void;
  handleFinishEditing: () => void;
}

export function useAtomTool(): AtomToolOverlay & AtomToolActions {
  const [activeAtomId, setActiveAtomId] = useState<string | null>(null);
  const [dragPreviewLine, setDragPreviewLine] = useState<AtomToolOverlay['dragPreviewLine']>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editingAtomId, setEditingAtomId] = useState<string | null>(null);
  const editingAtomIdRef = useRef<string | null>(null);
  const [editingValue, setEditingValue] = useState('');
  const activeAtomWasExisting = useRef(false);

  const activeAtomIdRef = useRef<string | null>(null);
  const isDraggingRef = useRef(false);
  const dragPreviewLineRef = useRef<AtomToolOverlay['dragPreviewLine']>(null);

  const setActive = (id: string | null) => {
    activeAtomIdRef.current = id;
    setActiveAtomId(id);
  };
  const setDragging = (v: boolean) => {
    isDraggingRef.current = v;
    setIsDragging(v);
  };
  const setPreview = (v: AtomToolOverlay['dragPreviewLine']) => {
    dragPreviewLineRef.current = v;
    setDragPreviewLine(v);
  };

  const onMouseDown = useCallback((pos: { x: number; y: number }, hitAtom: Atom | null) => {
    const {
      atoms,
      bonds,
      arrows,
      groups,
      textBoxes,
      setCurrentCanvasState,
      element,
      atomToolMode,
      setLastInteractedAtomId,
    } = useStore.getState();

    if (hitAtom) {
      activeAtomWasExisting.current = true;
      setDragging(true);
      setActive(hitAtom.id);
      setPreview({ startX: hitAtom.x, startY: hitAtom.y, x2: hitAtom.x, y2: hitAtom.y });
    } else {
      activeAtomWasExisting.current = false;
      const nid = crypto.randomUUID();
      setLastInteractedAtomId(nid);
      const baseAtom: Atom = { id: nid, x: pos.x, y: pos.y, kind: 'element', element };
      setCurrentCanvasState({
        atoms: [
          ...atoms,
          atomToolMode === 'alias' ? setAliasAtomValue(baseAtom, element) : baseAtom,
        ],
        bonds,
        arrows,
        groups: groups ?? [],
        textBoxes: textBoxes ?? [],
      });
      setDragging(true);
      setActive(nid);
      setPreview({ startX: pos.x, startY: pos.y, x2: pos.x, y2: pos.y });
    }
  }, []);

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
      element,
      atomToolMode,
      history,
      historyIndex,
    } = useStore.getState();
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

    const dist = Math.sqrt((preview.x2 - start.x) ** 2 + (preview.y2 - start.y) ** 2);
    if (dist < 5 && !preview.targetId) {
      // Short click on an existing atom applies the active element; new atoms just commit.
      if (activeAtomWasExisting.current) {
        if (atomToolMode === 'element') {
          const nextAtom = setAtomValue(start, element);
          const atomChanged =
            nextAtom.kind !== start.kind ||
            nextAtom.element !== start.element ||
            nextAtom.alias !== start.alias ||
            nextAtom.aliasResolution !== start.aliasResolution ||
            nextAtom.labelRuns !== start.labelRuns;

          if (atomChanged) {
            pushToHistory({
              atoms: atoms.map((atom) => (atom.id === start.id ? nextAtom : atom)),
              bonds,
              arrows,
              groups: groups ?? [],
              textBoxes: textBoxes ?? [],
            });
          }
        } else {
          const nextAtom = setAliasAtomValue(start, element);
          const atomChanged =
            nextAtom.kind !== start.kind ||
            nextAtom.element !== start.element ||
            nextAtom.alias !== start.alias ||
            nextAtom.aliasResolution !== start.aliasResolution ||
            nextAtom.labelRuns !== start.labelRuns;

          if (atomChanged) {
            pushToHistory({
              atoms: atoms.map((atom) => (atom.id === start.id ? nextAtom : atom)),
              bonds,
              arrows,
              groups: groups ?? [],
              textBoxes: textBoxes ?? [],
            });
          }
        }
      } else {
        pushToHistory({ atoms, bonds, arrows, groups: groups ?? [], textBoxes: textBoxes ?? [] });
      }
      setPreview(null);
      setActive(null);
      return;
    }

    // Place new atom at end of drag (atom tool: place element, not 'C')
    const finalX = preview.x2,
      finalY = preview.y2;
    let targetId = preview.targetId;
    const newAtoms = [...atoms];
    if (!targetId) {
      targetId = crypto.randomUUID();
      const baseAtom: Atom = { id: targetId, x: finalX, y: finalY, kind: 'element', element };
      newAtoms.push(atomToolMode === 'alias' ? setAliasAtomValue(baseAtom, element) : baseAtom);
    }

    if (targetId !== aid) {
      const existing = bonds.find(
        (b) => (b.from === aid && b.to === targetId) || (b.from === targetId && b.to === aid),
      );
      const newBonds = existing
        ? bonds.map((b) =>
            b.id === existing.id ? { ...b, order: (b.order % 3) + 1, stereo: 0 } : b,
          )
        : [...bonds, { id: crypto.randomUUID(), from: aid, to: targetId, order: 1, stereo: 0 }];
      pushToHistory({
        atoms: newAtoms,
        bonds: newBonds,
        arrows,
        groups: groups ?? [],
        textBoxes: textBoxes ?? [],
      });
    } else {
      if (historyIndex >= 0) setCurrentCanvasState(history[historyIndex]);
      else setCurrentCanvasState({ atoms: [], bonds: [], arrows: [], groups: [], textBoxes: [] });
    }
    setPreview(null);
    setActive(null);
  }, []);

  const handleFinishEditing = useCallback(() => {
    const id = editingAtomIdRef.current;
    setEditingAtomId(null);
    editingAtomIdRef.current = null;
    setEditingValue('');
    if (!id) return;
    const val = editingValue.trim() || 'C';
    const { atoms, bonds, arrows, groups, textBoxes, pushToHistory, chemDrawDocument } =
      useStore.getState();
    if (chemDrawDocument) {
      const nextDocument = applyNodeValueEdit(chemDrawDocument, id, val);
      useStore
        .getState()
        .dispatchEditorCommand(createReplaceDocumentCommand(nextDocument, 'edit-node-value'));
      return;
    }
    pushToHistory({
      atoms: atoms.map((atom) => {
        if (atom.id !== id) return atom;
        return setAtomValue(atom, val);
      }),
      bonds,
      arrows,
      groups: groups ?? [],
      textBoxes: textBoxes ?? [],
    });
  }, [editingValue]);

  const cleanup = useCallback(() => {
    if (isDraggingRef.current && !activeAtomWasExisting.current) {
      const { history, historyIndex, setCurrentCanvasState } = useStore.getState();
      if (historyIndex >= 0) setCurrentCanvasState(history[historyIndex]);
      else setCurrentCanvasState({ atoms: [], bonds: [], arrows: [] });
    }
    setDragging(false);
    setPreview(null);
    setActive(null);
    editingAtomIdRef.current = null;
    setEditingAtomId(null);
    setEditingValue('');
  }, []);

  const openEditor = useCallback((id: string, value: string) => {
    editingAtomIdRef.current = id;
    setEditingAtomId(id);
    setEditingValue(value);
  }, []);

  const closeEditor = useCallback(() => {
    editingAtomIdRef.current = null;
    setEditingAtomId(null);
  }, []);

  return {
    activeAtomId,
    dragPreviewLine,
    isDragging,
    editingAtomId,
    editingValue,
    onMouseDown,
    onMouseMove,
    onMouseUp,
    cleanup,
    openEditor,
    closeEditor,
    setEditingValue,
    handleFinishEditing,
  };
}
