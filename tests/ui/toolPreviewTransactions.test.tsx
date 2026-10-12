import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useAtomTool } from '../../src/tools/useAtomTool';
import { useBondTool } from '../../src/tools/useBondTool';
import { useStore } from '../../src/store';
import { resetStore } from './helpers';

beforeEach(() => {
  resetStore();
});
it('cancels bond creation without dirtying history, even if pointer-up arrives afterwards', () => {
  const { result } = renderHook(() => useBondTool());
  const source = useStore.getState();
  act(() => result.current.onMouseDown({ x: 50, y: 50 }, null, null));
  act(() => result.current.onMouseMove({ x: 95, y: 50 }, null));
  expect(useStore.getState().previewChemDrawDocument).not.toBeNull();
  expect(useStore.getState().atoms).toBe(source.atoms);
  expect(useStore.getState().history).toBe(source.history);
  expect(useStore.getState().documentRevision).toBe(source.documentRevision);
  expect(useStore.getState().documentFile.dirty).toBe(false);
  act(() => result.current.cleanup());
  act(() => result.current.onMouseUp());
  expect(useStore.getState().chemDrawDocument).toBe(source.chemDrawDocument);
  expect(useStore.getState().previewChemDrawDocument).toBeNull();
});
it('commits an entire bond drag as one undo step', () => {
  const { result } = renderHook(() => useBondTool());
  const source = useStore.getState();
  act(() => result.current.onMouseDown({ x: 50, y: 50 }, null, null));
  act(() => result.current.onMouseMove({ x: 95, y: 50 }, null));
  act(() => result.current.onMouseUp());
  expect(useStore.getState().atoms).toHaveLength(2);
  expect(useStore.getState().bonds).toHaveLength(1);
  expect(useStore.getState().history).toHaveLength(source.history.length + 1);
  expect(useStore.getState().previewChemDrawDocument).toBeNull();
  act(() => useStore.getState().undo());
  expect(useStore.getState().chemDrawDocument).toBe(source.chemDrawDocument);
});
it('cancels alias creation and commits a subsequent atom click once', () => {
  act(() => {
    useStore.getState().setAtomToolSelection('COOH', 'alias');
  });
  const { result } = renderHook(() => useAtomTool());
  const source = useStore.getState();
  act(() => result.current.onMouseDown({ x: 50, y: 50 }, null));
  act(() => result.current.cleanup());
  act(() => result.current.onMouseUp());
  expect(useStore.getState().history).toBe(source.history);
  act(() => result.current.onMouseDown({ x: 50, y: 50 }, null));
  act(() => result.current.onMouseUp());
  expect(useStore.getState().atoms).toHaveLength(1);
  expect(useStore.getState().atoms[0].kind).toBe('alias');
  expect(useStore.getState().history).toHaveLength(source.history.length + 1);
});
