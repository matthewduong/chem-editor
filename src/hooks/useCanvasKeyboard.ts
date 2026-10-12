import { useEffect } from 'react';
import { createDeleteSelectionCommand } from '../editor/commands';
import type { ScenePreview } from '../editor/scene/preview';
import { resolveAliasChemistry } from '../lib/aliasChemistry';
import { getAtomNodeText } from '../lib/atomIdentity';
import { getAtomFreeValence } from '../lib/canvasChemistry';
import { applyBondEdit, applyNodeValueEdit, reverseBondDirection } from '../lib/chemdrawModel';
import { getConnectedComponents } from '../lib/graph';
import {
  ATOM_FRAGMENT_HOTKEY_VALUES,
  ATOM_FRAGMENT_OPTIONS,
  ATOM_HOTKEY_VALUES,
  BOND_HOTKEY_VALUES,
  eventMatchesShortcut,
  FRAGMENT_MIN_FV,
  getCanvasToolShortcut,
  getShortcutBinding,
} from '../lib/keybindings';
import { shouldIgnoreKeyboardShortcuts } from '../lib/keyboard';
import { getNextDoubleBondToolMode } from '../lib/renderGeometry';
import { getPreferredAttachmentAngle } from '../lib/ringTemplates';
import { commitCanvasEdit, getCanvasEditorState, useStore } from '../store';
import type {
  Arrow,
  ArrowType,
  Atom,
  AtomLabelOrientation,
  Bond,
  BondDisplayStyle,
} from '../types/chemistry';
type RingPlacementPreview = NonNullable<ScenePreview['ring']>;

interface CanvasKeyboardBindings {
  cancelSelectionDrag: () => void;
  syncModifierKeys: (eventLike?: unknown) => { primary: boolean; shift: boolean };
  atomTool: import('../tools/useAtomTool').AtomToolOverlay &
    import('../tools/useAtomTool').AtomToolActions;
  editingTextBoxId: string | null;
  editingArrowLabels: {
    id: string;
    above: string;
    below: string;
    fontSize: number;
    color: string;
    screenX: number;
    screenY: number;
  } | null;
  editingAtomLabel: {
    id: string;
    value: string;
    fontFamily: string;
    fontSize: number;
    color: string;
    defaultColor: string;
    colorExplicit: boolean;
    orientation: AtomLabelOrientation;
    resolution: ReturnType<typeof resolveAliasChemistry> | null;
    selectedCandidateId?: string;
    screenX: number;
    screenY: number;
  } | null;
  editingBondStyle: {
    id: string;
    order: number;
    color: string;
    lineWidth: number;
    display: BondDisplayStyle;
    doubleBondMode: 'auto' | 'flipped' | 'symmetric';
  } | null;
  editingArrowStyle: {
    id: string;
    type: ArrowType;
    color: string;
    lineWidth: number;
    lineStyle: 'solid' | 'dashed' | 'bold';
    curveEnabled: boolean;
  } | null;
  hoveredAtomId: string | null;
  hoveredBondId: string | null;
  setSelectedBondIds: (ids: Set<string>) => void;
  setSelectedAtomIds: (ids: Set<string>) => void;
  setSelectedArrowIds: (ids: Set<string>) => void;
  setSelectedTextBoxIds: (ids: Set<string>) => void;
  hoveredArrowId: string | null;
  hoveredTextBoxId: string | null;
  bondTool: import('../tools/useBondTool').BondToolOverlay &
    import('../tools/useBondTool').BondToolActions;
  selectTool: import('../tools/useSelectTool').SelectToolOverlay &
    import('../tools/useSelectTool').SelectToolActions;
  textToolDragRef: import('react').RefObject<{
    textBoxId: string;
    startPos: { x: number; y: number };
    lastPos: { x: number; y: number };
    hasMoved: boolean;
  } | null>;
  setArrowPreview: import('react').Dispatch<import('react').SetStateAction<Arrow | null>>;
  setRingPreview: import('react').Dispatch<
    import('react').SetStateAction<RingPlacementPreview | null>
  >;
  setEditingArrowLabels: import('react').Dispatch<
    import('react').SetStateAction<{
      id: string;
      above: string;
      below: string;
      fontSize: number;
      color: string;
      screenX: number;
      screenY: number;
    } | null>
  >;
  setEditingTextBoxId: import('react').Dispatch<import('react').SetStateAction<string | null>>;
  setEditingAtomLabel: import('react').Dispatch<
    import('react').SetStateAction<{
      id: string;
      value: string;
      fontFamily: string;
      fontSize: number;
      color: string;
      defaultColor: string;
      colorExplicit: boolean;
      orientation: AtomLabelOrientation;
      resolution: ReturnType<typeof resolveAliasChemistry> | null;
      selectedCandidateId?: string;
      screenX: number;
      screenY: number;
    } | null>
  >;
  setEditingBondStyle: import('react').Dispatch<
    import('react').SetStateAction<{
      id: string;
      order: number;
      color: string;
      lineWidth: number;
      display: BondDisplayStyle;
      doubleBondMode: 'auto' | 'flipped' | 'symmetric';
    } | null>
  >;
  setEditingArrowStyle: import('react').Dispatch<
    import('react').SetStateAction<{
      id: string;
      type: ArrowType;
      color: string;
      lineWidth: number;
      lineStyle: 'solid' | 'dashed' | 'bold';
      curveEnabled: boolean;
    } | null>
  >;
  bondLength: number;
  placeFragmentAt: (
    smiles: string,
    pos: { x: number; y: number },
    hitAtom?: Atom,
    hitBond?: Bond,
    preferInterior?: boolean,
  ) => void;
  setLastInteractedAtomId: (id: string | null) => void;
  commitNativeDocument: (
    nextDocument: NonNullable<import('../types/chemdraw').ChemDrawDocument | null>,
    description: string,
  ) => void;
  hoveredNativeObjectId: string | null;
  setIsCtrlDown: import('react').Dispatch<import('react').SetStateAction<boolean>>;
}

export function useCanvasKeyboard({
  cancelSelectionDrag,
  syncModifierKeys,
  atomTool,
  editingTextBoxId,
  editingArrowLabels,
  editingAtomLabel,
  editingBondStyle,
  editingArrowStyle,
  hoveredAtomId,
  hoveredBondId,
  setSelectedBondIds,
  setSelectedAtomIds,
  setSelectedArrowIds,
  setSelectedTextBoxIds,
  hoveredArrowId,
  hoveredTextBoxId,
  bondTool,
  selectTool,
  textToolDragRef,
  setArrowPreview,
  setRingPreview,
  setEditingArrowLabels,
  setEditingTextBoxId,
  setEditingAtomLabel,
  setEditingBondStyle,
  setEditingArrowStyle,
  bondLength,
  placeFragmentAt,
  setLastInteractedAtomId,
  commitNativeDocument,
  hoveredNativeObjectId,
  setIsCtrlDown,
}: CanvasKeyboardBindings) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifiers = syncModifierKeys(e);
      const shortcutsBlocked = shouldIgnoreKeyboardShortcuts(e.target, document.activeElement);
      if (getCanvasEditorState().isInputFocused !== shortcutsBlocked) {
        getCanvasEditorState().setIsInputFocused(shortcutsBlocked);
      }
      if (shortcutsBlocked) return;

      const isEditingAtom = atomTool.editingAtomId !== null;
      const isEditingTextBox = editingTextBoxId !== null;
      const isEditingArrow = editingArrowLabels !== null;
      const isEditingAtomLabel = editingAtomLabel !== null;
      const isEditingBondStyle = editingBondStyle !== null;
      const isEditingArrowStyle = editingArrowStyle !== null;
      if (
        isEditingAtom ||
        isEditingTextBox ||
        isEditingArrow ||
        isEditingAtomLabel ||
        isEditingBondStyle ||
        isEditingArrowStyle
      )
        return;

      const {
        atoms: kAtoms,
        bonds: kBonds,
        arrows: kArrows,
        groups: kGroups,
        textBoxes: kTextBoxes,
        selectedAtomIds: kSel,
        selectedBondIds: kSelBond,
        selectedArrowIds: kSelArr,
        selectedTextBoxIds: kSelTB,

        appPreferences: currentPreferences,
      } = getCanvasEditorState();
      const matches = (shortcutId: string) =>
        eventMatchesShortcut(e, getShortcutBinding(currentPreferences.keybindings, shortcutId));

      // Space → select connected component (hover), or deselect + select mode (empty)
      if (matches('canvas.selection.component')) {
        e.preventDefault();
        if (hoveredAtomId || hoveredBondId) {
          if (hoveredBondId && !hoveredAtomId) {
            if (modifiers.shift) {
              const n = new Set(kSelBond);
              if (n.has(hoveredBondId)) n.delete(hoveredBondId);
              else n.add(hoveredBondId);
              setSelectedBondIds(n);
            } else {
              setSelectedBondIds(new Set([hoveredBondId]));
              setSelectedAtomIds(new Set());
              setSelectedArrowIds(new Set());
              setSelectedTextBoxIds(new Set());
            }
          } else {
            const startId =
              hoveredAtomId ??
              (hoveredBondId ? kBonds.find((b) => b.id === hoveredBondId)?.from : null);
            if (startId) {
              const comps = getConnectedComponents(kAtoms, kBonds),
                target = comps.find((c) => c.has(startId));
              if (target) {
                if (modifiers.shift) {
                  const s = new Set(kSel);
                  target.forEach((id) => s.add(id));
                  setSelectedAtomIds(s);
                } else {
                  setSelectedAtomIds(new Set(target));
                  setSelectedBondIds(new Set());
                  setSelectedArrowIds(new Set());
                  setSelectedTextBoxIds(new Set());
                }
              }
            }
          }
        } else if (hoveredArrowId) {
          if (modifiers.shift) {
            const n = new Set(kSelArr);
            if (n.has(hoveredArrowId)) n.delete(hoveredArrowId);
            else n.add(hoveredArrowId);
            setSelectedArrowIds(n);
          } else {
            setSelectedArrowIds(new Set([hoveredArrowId]));
            setSelectedAtomIds(new Set());
            setSelectedBondIds(new Set());
            setSelectedTextBoxIds(new Set());
          }
        } else if (hoveredTextBoxId) {
          if (modifiers.shift) {
            const n = new Set(kSelTB);
            if (n.has(hoveredTextBoxId)) n.delete(hoveredTextBoxId);
            else n.add(hoveredTextBoxId);
            setSelectedTextBoxIds(n);
          } else {
            setSelectedTextBoxIds(new Set([hoveredTextBoxId]));
            setSelectedAtomIds(new Set());
            setSelectedBondIds(new Set());
            setSelectedArrowIds(new Set());
          }
        } else {
          getCanvasEditorState().deselectAll();
          getCanvasEditorState().setTool('select');
        }
        return;
      }

      // Enter → edit hovered atom
      if (matches('canvas.atom.edit') && hoveredAtomId) {
        const atom = kAtoms.find((a) => a.id === hoveredAtomId);
        if (atom) {
          atomTool.openEditor(atom.id, getAtomNodeText(atom));
        }
        return;
      }

      // Escape → close arrow label editor
      if (e.key === 'Escape') {
        cancelSelectionDrag();
        bondTool.cleanup();
        atomTool.cleanup();
        selectTool.cleanup();
        textToolDragRef.current = null;
        setArrowPreview(null);
        setRingPreview(null);
        useStore.getState().clearPreviewChemDrawDocument();
        useStore.getState().clearSelectionPreviewTransform();
        setEditingArrowLabels(null);
        setEditingTextBoxId(null);
        setEditingAtomLabel(null);
        setEditingBondStyle(null);
        setEditingArrowStyle(null);
        return;
      }

      const atomShortcutEntry = Object.entries(ATOM_HOTKEY_VALUES).find(([key]) =>
        matches(`canvas.atom.${key}`),
      );
      const bondShortcutEntry = Object.entries(BOND_HOTKEY_VALUES).find(([key]) =>
        matches(`canvas.bond.${key}`),
      );
      const fragmentShortcutEntry = Object.entries(ATOM_FRAGMENT_HOTKEY_VALUES).find(([key]) =>
        matches(`canvas.fragment.${key}`),
      );
      const hE = atomShortcutEntry?.[1];
      const hB = bondShortcutEntry?.[1];
      const hAF = fragmentShortcutEntry?.[1];

      if (hoveredAtomId) {
        const atom = kAtoms.find((a) => a.id === hoveredAtomId);
        if (atom) {
          const atomFV = getAtomFreeValence(atom, kBonds);

          // Stereo bond shortcuts — only if atom has room for one more bond
          if (matches('canvas.stereo.wedge') || matches('canvas.stereo.hash')) {
            if (atomFV >= 1) {
              const angle = getPreferredAttachmentAngle(atom, kAtoms, kBonds, false);
              const nid = crypto.randomUUID();
              commitCanvasEdit({
                atoms: [
                  ...kAtoms,
                  {
                    id: nid,
                    x: atom.x + Math.cos(angle) * bondLength,
                    y: atom.y + Math.sin(angle) * bondLength,
                    kind: 'element',
                    element: 'C',
                  },
                ],
                bonds: [
                  ...kBonds,
                  {
                    id: crypto.randomUUID(),
                    from: atom.id,
                    to: nid,
                    order: 1,
                    stereo: matches('canvas.stereo.wedge') ? 1 : 6,
                  },
                ],
                arrows: kArrows,
                groups: kGroups ?? [],
                textBoxes: kTextBoxes ?? [],
              });
            }
            return;
          }

          // Fragment shortcuts — use ChemDraw-style smart SMILES based on free valence
          if (hAF) {
            const fragmentShortcutKey = fragmentShortcutEntry?.[0];
            const options = fragmentShortcutKey
              ? ATOM_FRAGMENT_OPTIONS[fragmentShortcutKey]
              : undefined;
            let smiles: string | null;
            if (options) {
              const match = options.find((o) => atomFV >= o.minFV);
              smiles = match ? match.smiles : null;
            } else {
              const minFV = fragmentShortcutKey ? (FRAGMENT_MIN_FV[fragmentShortcutKey] ?? 1) : 1;
              smiles = atomFV >= minFV ? hAF : null;
            }
            if (smiles) placeFragmentAt(smiles, { x: 0, y: 0 }, atom);
            return;
          }

          if (hE) {
            setLastInteractedAtomId(hoveredAtomId);
            if (getCanvasEditorState().chemDrawDocument) {
              const nextDocument = applyNodeValueEdit(
                getCanvasEditorState().chemDrawDocument!,
                hoveredAtomId,
                hE,
              );
              commitNativeDocument(nextDocument, 'edit-node-value');
            } else {
              commitCanvasEdit({
                atoms: kAtoms.map((a) => (a.id === hoveredAtomId ? { ...a, element: hE } : a)),
                bonds: kBonds,
                arrows: kArrows,
                groups: kGroups ?? [],
                textBoxes: kTextBoxes ?? [],
              });
            }
            return;
          }
        }
      }

      if (hB && hoveredBondId) {
        if (hB.ring) {
          const b = kBonds.find((x) => x.id === hoveredBondId);
          if (b) placeFragmentAt(hB.ring, { x: 0, y: 0 }, undefined, b);
        } else if (hB.order !== undefined) {
          const b = kBonds.find((x) => x.id === hoveredBondId);
          const nativeDocument = getCanvasEditorState().chemDrawDocument;
          if (nativeDocument) {
            const nextDocument =
              b && b.stereo === hB.stereo && hB.stereo !== 0
                ? reverseBondDirection(nativeDocument, hoveredBondId)
                : applyBondEdit(nativeDocument, hoveredBondId, {
                    order: hB.order,
                    stereo: hB.stereo || 0,
                    ...(hB.order === 2 && (hB.stereo || 0) === 0
                      ? { doubleBondMode: getNextDoubleBondToolMode(b) }
                      : {}),
                  });
            commitNativeDocument(nextDocument, 'edit-bond');
          } else if (b && b.stereo === hB.stereo && hB.stereo !== 0) {
            commitCanvasEdit({
              atoms: kAtoms,
              bonds: kBonds.map((x) =>
                x.id === hoveredBondId ? { ...x, from: x.to, to: x.from } : x,
              ),
              arrows: kArrows,
              groups: kGroups ?? [],
              textBoxes: kTextBoxes ?? [],
            });
          } else {
            commitCanvasEdit({
              atoms: kAtoms,
              bonds: kBonds.map((x) =>
                x.id === hoveredBondId
                  ? {
                      ...x,
                      order: hB.order!,
                      stereo: hB.stereo || 0,
                      ...(hB.order === 2 && (hB.stereo || 0) === 0
                        ? { doubleBondMode: getNextDoubleBondToolMode(x) }
                        : { doubleBondMode: undefined }),
                    }
                  : x,
              ),
              arrows: kArrows,
              groups: kGroups ?? [],
              textBoxes: kTextBoxes ?? [],
            });
          }
        }
        return;
      }

      const hasHoveredObject = Boolean(
        hoveredAtomId ||
        hoveredBondId ||
        hoveredArrowId ||
        hoveredTextBoxId ||
        hoveredNativeObjectId,
      );
      const toolShortcut = getCanvasToolShortcut(currentPreferences.keybindings, e, {
        hasHoveredObject,
      });
      if (toolShortcut) {
        e.preventDefault();
        getCanvasEditorState().setTool(toolShortcut.tool);
        if (toolShortcut.selectedFragment) {
          getCanvasEditorState().setSelectedFragment(toolShortcut.selectedFragment);
        }
        return;
      }

      // Delete / Backspace
      if (matches('canvas.delete') || matches('canvas.delete.backspace')) {
        if (kSel.size > 0 || kSelBond.size > 0 || kSelArr.size > 0 || kSelTB.size > 0) {
          const nativeDocument = getCanvasEditorState().chemDrawDocument;
          if (nativeDocument) {
            getCanvasEditorState().dispatchEditorCommand(
              createDeleteSelectionCommand({
                objectIds: getCanvasEditorState().selectedObjectIds,
                description: 'delete-selected-objects',
              }),
            );
          } else {
            commitCanvasEdit({
              atoms: kAtoms.filter((a) => !kSel.has(a.id)),
              bonds: kBonds.filter(
                (b) => !kSelBond.has(b.id) && !kSel.has(b.from) && !kSel.has(b.to),
              ),
              arrows: kArrows.filter((a) => !kSelArr.has(a.id)),
              groups: kGroups ?? [],
              textBoxes: (kTextBoxes ?? []).filter((t) => !kSelTB.has(t.id)),
            });
          }
          setSelectedAtomIds(new Set());
          setSelectedBondIds(new Set());
          setSelectedArrowIds(new Set());
          setSelectedTextBoxIds(new Set());
        } else if (hoveredAtomId) {
          commitCanvasEdit({
            atoms: kAtoms.filter((a) => a.id !== hoveredAtomId),
            bonds: kBonds.filter((b) => b.from !== hoveredAtomId && b.to !== hoveredAtomId),
            arrows: kArrows,
            groups: kGroups ?? [],
            textBoxes: kTextBoxes ?? [],
          });
        } else if (hoveredBondId) {
          commitCanvasEdit({
            atoms: kAtoms,
            bonds: kBonds.filter((b) => b.id !== hoveredBondId),
            arrows: kArrows,
            groups: kGroups ?? [],
            textBoxes: kTextBoxes ?? [],
          });
        } else if (hoveredArrowId) {
          commitCanvasEdit({
            atoms: kAtoms,
            bonds: kBonds,
            arrows: kArrows.filter((a) => a.id !== hoveredArrowId),
            groups: kGroups ?? [],
            textBoxes: kTextBoxes ?? [],
          });
        }
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      syncModifierKeys(e);
    };
    const clearModifierKeys = () => {
      setIsCtrlDown(false);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') clearModifierKeys();
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearModifierKeys);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearModifierKeys);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    hoveredAtomId,
    hoveredBondId,
    hoveredArrowId,
    hoveredTextBoxId,
    hoveredNativeObjectId,
    placeFragmentAt,
    atomTool.editingAtomId,
    editingTextBoxId,
    editingArrowLabels,
    editingAtomLabel,
    editingArrowStyle,
    editingBondStyle,
    setLastInteractedAtomId,
    setSelectedAtomIds,
    setSelectedArrowIds,
    setSelectedTextBoxIds,
    syncModifierKeys,
  ]);
}
