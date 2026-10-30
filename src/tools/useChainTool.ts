import { createEditorCommandContext } from '../editor/commands';
import { useRef, useState } from 'react';
import { ToolLifecycle, type ToolPointerInput } from '../editor/toolLifecycle';
import { chainGeometry, chainPoints, materializeChain } from '../lib/chain';
import { getNewBondAngle } from '../lib/newBondAngle';
import { createProjectionEditCommand } from '../editor/commands/projectionEdit';
import { chemDrawDocumentToCanvasState } from '../lib/chemdrawModel';
import type { Atom } from '../types/chemistry';
import type { ChemDrawDocument } from '../types/chemdraw';
import { useStore } from '../store';

type Input = ToolPointerInput<Atom | null>;
export function useChainTool() {
  const lifecycle = useRef(new ToolLifecycle<Atom | null, ChemDrawDocument>());
  const gesture = useRef<{
    source: ChemDrawDocument;
    start: { x: number; y: number };
    startId?: string;
    length: number;
    points: Array<{ x: number; y: number }>;
    endId?: string;
    /** Alt held at the press: a click repeats the last chain length. */
    repeatLast?: boolean;
  } | null>(null);
  const [count, setCount] = useState(0);
  const editable = (source: ChemDrawDocument, atom: Atom) => {
    const o = source.pages[0]?.objects.find((o) => o.id === atom.id);
    return (
      o?.type === 'node' &&
      !o.query &&
      !o.alias &&
      (o.preservation?.capability ?? 'editable') === 'editable'
    );
  };
  const cancel = () => {
    lifecycle.current.cancel();
    gesture.current = null;
    setCount(0);
    useStore.getState().clearPreviewChemDrawDocument();
  };
  return {
    count,
    isActive: () => gesture.current !== null,
    begin(input: Input, options: { repeatLast?: boolean } = {}) {
      cancel();
      const s = useStore.getState(),
        source = s.chemDrawDocument;
      if (!source) return;
      if (input.hit && !editable(source, input.hit)) {
        s.showToast('This atom cannot accept a chain.');
        return;
      }
      const start = input.hit ?? input.point;
      lifecycle.current.begin(source, input);
      gesture.current = {
        source,
        start,
        startId: input.hit?.id,
        length: s.documentStyleSettings.bondLength,
        points: [],
        repeatLast: options.repeatLast,
      };
    },
    update(input: Input) {
      const g = gesture.current;
      if (!g) return;
      lifecycle.current.update(input);
      const points = chainGeometry(g.start, input.point, g.length);
      const last = points.at(-1)!;
      const hit = input.hit;
      const attach =
        points.length > 1 &&
        hit &&
        editable(g.source, hit) &&
        Math.hypot(last.x - hit.x, last.y - hit.y) < g.length * 0.6;
      g.points = points;
      g.endId = attach ? hit.id : undefined;
      if (attach) points[points.length - 1] = { x: hit.x, y: hit.y };
      try {
        const state = chemDrawDocumentToCanvasState(g.source).state;
        const materialized = materializeChain(
          points,
          state.atoms,
          state.bonds,
          g.startId,
          g.endId,
          (() => {
            let i = 0;
            return () => `__chain-preview-${i++}`;
          })(),
        );
        const command = createProjectionEditCommand(g.source, {
          ...state,
          atoms: materialized.atoms,
          bonds: materialized.bonds,
        });
        // No store/history commit: the same command supplies the shared scene preview.
        const preview = command.apply(
          g.source,
          createEditorCommandContext({
            activePageId: g.source.pages[0]?.id ?? null,
            documentStyleSettings: useStore.getState().documentStyleSettings,
            pageSetup: useStore.getState().pageSetup,
          }),
        ).document;
        useStore.getState().setPreviewChemDrawDocument(preview);
        setCount(materialized.addedAtomIds.length);
      } catch {
        useStore.getState().clearPreviewChemDrawDocument();
        setCount(0);
      }
    },
    commit() {
      const g = gesture.current,
        s = useStore.getState();
      if (!g || !s.chemDrawDocument || !lifecycle.current.commit(s.chemDrawDocument)) {
        cancel();
        return;
      }
      // A click, not a drag: ask for the number of carbons (ChemDraw's Add Chain), or with Alt
      // repeat the last one given.
      if (g.points.length < 2) {
        cancel();
        if (g.repeatLast && s.lastChainCount) {
          commitChainOfLength(g.start, g.startId, s.lastChainCount);
        } else {
          s.setChainLengthRequest({ start: g.start, startId: g.startId });
        }
        return;
      }
      try {
        const state = chemDrawDocumentToCanvasState(g.source).state;
        const result = materializeChain(g.points, state.atoms, state.bonds, g.startId, g.endId);
        if (result.atoms !== state.atoms)
          s.dispatchEditorCommand(
            createProjectionEditCommand(
              g.source,
              { ...state, atoms: result.atoms, bonds: result.bonds },
              'draw-chain',
            ),
          );
      } catch (error) {
        s.showToast(error instanceof Error ? error.message : 'Chain attachment failed.');
      }
      cancel();
    },
    cancel,
  };
}

/**
 * Adds a chain of `count` carbons at `start` (an atom when `startId` is given), zigzagging away
 * from that atom's bonds, as one undo step. Remembers the count for Alt+click.
 */
export function commitChainOfLength(
  start: { x: number; y: number },
  startId: string | undefined,
  count: number,
): void {
  const s = useStore.getState();
  const source = s.chemDrawDocument;
  if (!source || !Number.isInteger(count) || count < 1 || count > 200) return;
  s.setLastChainCount(count);
  const state = chemDrawDocumentToCanvasState(source).state;
  const atom = startId ? state.atoms.find((entry) => entry.id === startId) : undefined;
  // The first bond leaves the way a new bond would; the chain's axis is 30° off it.
  const axis = atom ? getNewBondAngle(atom, state.atoms, state.bonds) - Math.PI / 6 : 0;
  const origin = atom ? { x: atom.x, y: atom.y } : start;
  try {
    const result = materializeChain(
      // n carbons: n new atoms off an existing one, n atoms in all on empty canvas.
      chainPoints(origin, axis, atom ? count : count - 1, s.documentStyleSettings.bondLength),
      state.atoms,
      state.bonds,
      atom?.id,
    );
    s.dispatchEditorCommand(
      createProjectionEditCommand(
        source,
        { ...state, atoms: result.atoms, bonds: result.bonds },
        'draw-chain',
      ),
    );
  } catch (error) {
    s.showToast(error instanceof Error ? error.message : 'Chain attachment failed.');
  }
}
