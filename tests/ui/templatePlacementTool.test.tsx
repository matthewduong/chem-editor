import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { buildBuiltinTemplates } from '../../src/lib/builtinTemplates';
import { useTemplatePlacementTool } from '../../src/tools/useTemplatePlacementTool';
import { useStore } from '../../src/store';
import { resetStore } from './helpers';

const benzene = () => buildBuiltinTemplates(14.4).find((t) => t.name === 'Benzene')!;

beforeEach(() => {
  resetStore();
});

it('previews at the pointer without touching the document, then commits one undo step', () => {
  const { result } = renderHook(() => useTemplatePlacementTool());
  const source = useStore.getState();
  act(() => result.current.arm(benzene()));
  expect(result.current.isActive()).toBe(true);
  act(() => result.current.update({ x: 80, y: 80 }));
  expect(useStore.getState().previewChemDrawDocument).not.toBeNull();
  expect(useStore.getState().chemDrawDocument).toBe(source.chemDrawDocument);
  expect(useStore.getState().history).toBe(source.history);
  act(() => result.current.commit({ x: 80, y: 80 }));
  const after = useStore.getState();
  expect(after.atoms).toHaveLength(6);
  expect(after.bonds).toHaveLength(6);
  expect(after.history).toHaveLength(source.history.length + 1);
  expect(after.previewChemDrawDocument).toBeNull();
  expect(after.selectedObjectIds.size).toBeGreaterThan(0);
  expect(result.current.isActive()).toBe(false);
  act(() => useStore.getState().undo());
  expect(useStore.getState().atoms).toHaveLength(0);
});

it('cancel disarms, clears the preview and leaves history alone', () => {
  const { result } = renderHook(() => useTemplatePlacementTool());
  const source = useStore.getState();
  act(() => result.current.arm(benzene()));
  act(() => result.current.update({ x: 80, y: 80 }));
  act(() => result.current.cancel());
  expect(result.current.isActive()).toBe(false);
  expect(useStore.getState().previewChemDrawDocument).toBeNull();
  act(() => result.current.commit({ x: 80, y: 80 }));
  expect(useStore.getState().history).toBe(source.history);
  expect(useStore.getState().atoms).toHaveLength(0);
});

it('a placement armed on a document that was replaced commits nothing', () => {
  const { result } = renderHook(() => useTemplatePlacementTool());
  act(() => result.current.arm(benzene()));
  const replacement = {
    schemaVersion: 1,
    source: 'canvas-state',
    pages: [{ id: 'page', objects: [] }],
  } as unknown as NonNullable<ReturnType<typeof useStore.getState>['chemDrawDocument']>;
  act(() => useStore.setState({ chemDrawDocument: replacement }));
  const before = useStore.getState();
  act(() => result.current.commit({ x: 80, y: 80 }));
  expect(useStore.getState().chemDrawDocument).toBe(replacement);
  expect(useStore.getState().history).toBe(before.history);
  expect(useStore.getState().previewChemDrawDocument).toBeNull();
});

it('returns one stable object across renders so effects and handles do not churn', () => {
  const { result, rerender } = renderHook(() => useTemplatePlacementTool());
  const first = result.current;
  rerender();
  expect(result.current).toBe(first);
});
