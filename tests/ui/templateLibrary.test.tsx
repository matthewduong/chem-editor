import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useTemplateLibrary } from '../../src/hooks/useTemplateLibrary';
const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('../../src/lib/tauri', () => ({ invokeTauri: mock.invoke }));
beforeEach(() => mock.invoke.mockReset());
it('loads on restart, persists separately, and keeps the old library on failed writes', async () => {
  const empty = { version: 1 as const, templates: [] };
  mock.invoke.mockResolvedValueOnce(JSON.stringify(empty));
  const { result, unmount } = renderHook(() => useTemplateLibrary());
  await waitFor(() => expect(result.current.library).toEqual(empty));
  mock.invoke.mockRejectedValueOnce(new Error('disk full'));
  await act(async () => result.current.update(empty));
  expect(result.current.library).toEqual(empty);
  expect(result.current.error).toContain('prior library was retained');
  expect(mock.invoke).toHaveBeenLastCalledWith('save_template_library', {
    contents: JSON.stringify(empty),
    expected: JSON.stringify(empty),
  });
  unmount();
  mock.invoke.mockResolvedValueOnce(JSON.stringify(empty));
  const restarted = renderHook(() => useTemplateLibrary());
  await waitFor(() => expect(restarted.result.current.library).toEqual(empty));
});
it('malformed and newer libraries stay blocked and are never overwritten', async () => {
  mock.invoke.mockResolvedValueOnce('{"version":2,"templates":[]}');
  const { result } = renderHook(() => useTemplateLibrary());
  await waitFor(() => expect(result.current.error).toContain('original library was retained'));
  await act(async () => result.current.update({ version: 1, templates: [] }));
  expect(mock.invoke).toHaveBeenCalledTimes(1);
  expect(result.current.library).toBeNull();
});
