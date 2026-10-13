import { createEditorCommandContext } from '../editor/commands';
import { useRef, useState } from 'react';
import { ToolLifecycle, type ToolPointerInput } from '../editor/toolLifecycle';
import { chainGeometry, materializeChain } from '../lib/chain';
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
    begin(input: Input) {
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
