import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useDocumentLifecycle } from '../../src/hooks/useDocumentLifecycle';
import { useStore } from '../../src/store';

vi.mock('../../src/lib/tauri', () => ({ invokeTauri: vi.fn(async () => null) }));

afterEach(() => vi.useRealTimers());

it('saves the open file on the interval only while it has changes', async () => {
  vi.useFakeTimers();
  const saveNative = vi.fn(async ({ path }: { path: string | null }) => ({ saved: true, path }));
  const canvas = { current: { saveNative } } as never;
  useStore.setState({
    appPreferences: { ...useStore.getState().appPreferences, autosaveMinutes: 1 },
    documentFile: {
      path: '/tmp/a.cdxml',
      name: 'a.cdxml',
      format: 'cdxml',
      dirty: true,
      lastSavedRevision: 0,
    },
  } as never);
  renderHook(() => useDocumentLifecycle(canvas));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(saveNative).toHaveBeenCalledWith({ path: '/tmp/a.cdxml', prompt: false });
  saveNative.mockClear();
  useStore.setState({
    documentFile: { ...useStore.getState().documentFile, dirty: false },
  } as never);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(60_000);
  });
  expect(saveNative).not.toHaveBeenCalled();
});
