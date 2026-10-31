import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  broadcast: vi.fn(async () => undefined),
  handler: null as null | ((event: { payload: unknown }) => void),
  invoke: vi.fn(async () => null),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: mocks.invoke }));
vi.mock('../../src/lib/tauri', () => ({
  invokeTauri: mocks.invoke,
  broadcastTauri: mocks.broadcast,
  currentWindowLabel: () => 'main',
  listenTauri: vi.fn(async (_event: string, handler: (event: { payload: unknown }) => void) => {
    mocks.handler = handler;
    return () => {};
  }),
}));

import { usePreferenceSync } from '../../src/hooks/usePreferenceSync';
import { useStore } from '../../src/store';

it('tells other windows about a preference change and adopts theirs', async () => {
  const state = useStore.getState();
  state.setAppPreferences({ ...state.appPreferences, exportBorder: 12 });
  expect(mocks.broadcast).toHaveBeenCalledWith(
    'chem-editor://preferences-changed',
    expect.objectContaining({ source: 'main' }),
  );
  renderHook(() => usePreferenceSync());
  await waitFor(() => expect(mocks.handler).not.toBeNull());
  mocks.broadcast.mockClear();
  const theirs = { ...useStore.getState().appPreferences, exportBorder: 30 };
  mocks.handler!({ payload: { source: 'document-x', preferences: theirs } });
  expect(useStore.getState().appPreferences.exportBorder).toBe(30);
  // Adopting is not a change of our own: nothing is sent back.
  expect(mocks.broadcast).not.toHaveBeenCalled();
  // Our own broadcast coming back is ignored.
  mocks.handler!({ payload: { source: 'main', preferences: { ...theirs, exportBorder: 5 } } });
  expect(useStore.getState().appPreferences.exportBorder).toBe(30);
});
