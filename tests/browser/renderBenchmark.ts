import { buildDocumentSceneState, type BuildSceneInput } from '../../src/editor/scene/buildScene';
import { renderDocumentScene } from '../../src/editor/scene/renderDocumentScene';
import { buildPreviewScene } from '../../src/editor/scene/preview';
import { buildDocumentIndex, buildDocumentIndexUncached } from '../../src/editor/document';
import { chemDrawDocumentToCanvasState } from '../../src/lib/chemdrawModel';
import {
  DEFAULT_DOCUMENT_STYLE_SETTINGS,
  CHEMDRAW_FIDELITY_DOCUMENT_VIEW_SETTINGS,
  DEFAULT_PAGE_SETUP,
} from '../../src/lib/settings';
import type { ChemDrawDocument, ChemDrawObject } from '../../src/types/chemdraw';

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
function synthetic(size: number) {
  const objects: ChemDrawObject[] = [];
  for (let i = 0; i < size; i++) {
    objects.push({
      id: `a${i}`,
      type: 'node',
      element: i % 7 === 0 ? 'N' : 'C',
      position: { x: (i % 40) * 14.4, y: Math.floor(i / 40) * 25 + (i % 2) * 7 },
      ...(i % 7 === 0 ? { text: { runs: [{ text: 'N' }] } } : {}),
    });
    if (i % 20)
      objects.push({
        id: `b${i}`,
        type: 'bond',
        beginNodeId: `a${i - 1}`,
        endNodeId: `a${i}`,
        order: i % 5 === 0 ? 2 : 1,
      });
    if (i % 20 === 19)
      objects.push({
        id: `g${i}`,
        type: 'group',
        childIds: Array.from({ length: 20 }, (_, j) => `a${i - j}`),
      });
  }
  const document: ChemDrawDocument = freeze({
    schemaVersion: 1,
    source: 'canvas-state',
    pages: [{ id: 'page', objects }],
  });
  const state = chemDrawDocumentToCanvasState(document).state;
  const input: BuildSceneInput = {
    document,
    canvasState: freeze({ ...state, groups: state.groups ?? [], textBoxes: state.textBoxes ?? [] }),
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
    documentViewSettings: CHEMDRAW_FIDELITY_DOCUMENT_VIEW_SETTINGS,
    pageSetup: DEFAULT_PAGE_SETUP,
  };
  return input;
}
const stats = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samples: sorted.length,
  };
};
let history: ChemDrawDocument[] = [];
export function retainHistory(size: number) {
  const input = synthetic(size),
    source = input.document!;
  history = Array.from({ length: 50 }, (_, i) =>
    freeze({
      ...source,
      pages: [
        {
          ...source.pages[0]!,
          objects: source.pages[0]!.objects.map((o) =>
            o.id === 'a0' && o.type === 'node' ? { ...o, position: { x: i, y: 0 } } : o,
          ),
        },
      ],
    }),
  );
  return {
    snapshots: history.length,
    serializedBytes: new TextEncoder().encode(JSON.stringify(history)).length,
  };
}
export function clearHistory() {
  history = [];
}
/** Hard ceiling: the 5,000-atom uncached case is slow enough that more samples are not worth it. */
export const MAX_SAMPLES = 5;
/**
 * `hover`: the same document object every sample, as while a pointer previews a move. Cached
 * runs are cache *hits* here. `edit`: a fresh document object per sample, as after a commit, so
 * cached runs are cache *misses* and show the bookkeeping overhead. Building the fresh document
 * is not timed.
 */
export type BenchmarkMode = 'hover' | 'edit';
export async function benchmark(
  size: number,
  useCache: boolean,
  samples = MAX_SAMPLES,
  mode: BenchmarkMode = 'hover',
) {
  samples = Math.max(1, Math.min(MAX_SAMPLES, Math.floor(samples)));
  const setupStart = performance.now();
  let input = { ...synthetic(size), useCache };
  const setupMs = performance.now() - setupStart;
  const canvas = document.createElement('canvas');
  canvas.width = 1000;
  canvas.height = 800;
  const ctx = canvas.getContext('2d')!;
  const options = {
    width: 1000,
    height: 800,
    stageScale: 1,
    stagePos: { x: 0, y: 0 },
    drawPageChrome: false,
  };
  const indexes: number[] = [],
    scenes: number[] = [],
    paints: number[] = [],
    previews: number[] = [];
  // Warm both the runtime and the requested cache mode before recording.
  const warmStart = performance.now();
  buildDocumentSceneState(input);
  const warmupMs = performance.now() - warmStart;
  for (let i = 0; i < samples; i++) {
    if (mode === 'edit') input = { ...synthetic(size), useCache };
    let t = performance.now();
    (useCache ? buildDocumentIndex : buildDocumentIndexUncached)(input.document, {
      documentStyleSettings: input.documentStyleSettings,
    });
    indexes.push(performance.now() - t);
    t = performance.now();
    const scene = buildDocumentSceneState(input);
    scenes.push(performance.now() - t);
    t = performance.now();
    renderDocumentScene(ctx, scene, options);
    paints.push(performance.now() - t);
    t = performance.now();
    const preview = buildPreviewScene(scene, input.document, {
      transform: {
        kind: 'move',
        dx: i,
        dy: i,
        selectedObjectIds: new Set(['a0']),
        movedAtomIds: new Set(['a0']),
        affectedBondIds: new Set(['b1']),
      },
      arrow: null,
      ring: null,
      line: null,
    });
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        renderDocumentScene(ctx, preview, options);
        resolve();
      }),
    );
    previews.push(performance.now() - t);
  }
  return {
    size,
    useCache,
    mode,
    setupMs,
    warmupMs,
    indexMs: stats(indexes),
    sceneMs: stats(scenes),
    paintMs: stats(paints),
    pointerPreviewMs: stats(previews),
  };
}
