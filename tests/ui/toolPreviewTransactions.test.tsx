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
  act(() => result.current.begin({ x: 50, y: 50 }, null, null));
  act(() => result.current.update({ x: 95, y: 50 }, null));
  expect(useStore.getState().previewChemDrawDocument).not.toBeNull();
  expect(useStore.getState().atoms).toBe(source.atoms);
  expect(useStore.getState().history).toBe(source.history);
  expect(useStore.getState().documentRevision).toBe(source.documentRevision);
  expect(useStore.getState().documentFile.dirty).toBe(false);
  act(() => result.current.cancel());
  act(() => result.current.commit());
  expect(useStore.getState().chemDrawDocument).toBe(source.chemDrawDocument);
  expect(useStore.getState().previewChemDrawDocument).toBeNull();
});
it('commits an entire bond drag as one undo step', () => {
  const { result } = renderHook(() => useBondTool());
  const source = useStore.getState();
  act(() => result.current.begin({ x: 50, y: 50 }, null, null));
  act(() => result.current.update({ x: 95, y: 50 }, null));
  act(() => result.current.commit());
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
  act(() => result.current.begin({ x: 50, y: 50 }, null));
  act(() => result.current.cancel());
  act(() => result.current.commit());
  expect(useStore.getState().history).toBe(source.history);
  act(() => result.current.begin({ x: 50, y: 50 }, null));
  act(() => result.current.commit());
  expect(useStore.getState().atoms).toHaveLength(1);
  expect(useStore.getState().atoms[0].kind).toBe('alias');
  expect(useStore.getState().history).toHaveLength(source.history.length + 1);
});

const otherDocument = () =>
  ({
    schemaVersion: 1,
    source: 'canvas-state',
    pages: [{ id: 'page', objects: [] }],
  }) as unknown as NonNullable<ReturnType<typeof useStore.getState>['chemDrawDocument']>;

it('a bond press that began on a replaced document commits nothing', () => {
  const { result } = renderHook(() => useBondTool());
  act(() => result.current.begin({ x: 50, y: 50 }, null, null));
  act(() => result.current.update({ x: 95, y: 50 }, null));
  const replacement = otherDocument();
  act(() => useStore.setState({ chemDrawDocument: replacement }));
  const before = useStore.getState();
  act(() => result.current.commit());
  expect(useStore.getState().chemDrawDocument).toBe(replacement);
  expect(useStore.getState().history).toBe(before.history);
  expect(useStore.getState().atoms).toBe(before.atoms);
  expect(result.current.isActive()).toBe(false);
});

it('an atom press that began on a replaced document commits nothing', () => {
  const { result } = renderHook(() => useAtomTool());
  act(() => result.current.begin({ x: 50, y: 50 }, null));
  const replacement = otherDocument();
  act(() => useStore.setState({ chemDrawDocument: replacement }));
  const before = useStore.getState();
  act(() => result.current.commit());
  expect(useStore.getState().chemDrawDocument).toBe(replacement);
  expect(useStore.getState().history).toBe(before.history);
  expect(result.current.isActive()).toBe(false);
});

it('isActive follows a bond press and clears on commit and on cancel', () => {
  const { result } = renderHook(() => useBondTool());
  expect(result.current.isActive()).toBe(false);
  act(() => result.current.begin({ x: 50, y: 50 }, null, null));
  expect(result.current.isActive()).toBe(true);
  act(() => result.current.commit());
  expect(result.current.isActive()).toBe(false);
  act(() => result.current.begin({ x: 150, y: 50 }, null, null));
  expect(result.current.isActive()).toBe(true);
  act(() => result.current.cancel());
  expect(result.current.isActive()).toBe(false);
});
