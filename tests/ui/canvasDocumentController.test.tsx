import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCanvasDocumentController } from '../../src/hooks/useCanvasDocumentController';
import { useStore } from '../../src/store';
import { resetStore } from './helpers';
import { loadChemDrawDocumentForCanvas } from '../../src/lib/chemdrawDocumentCommands';

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('../../src/lib/chemdrawDocumentCommandsAsync', () => ({
  loadChemDrawDocumentForCanvasAsync: mocks.load,
  prepareChemDrawDocumentForSaveAsync: vi.fn(),
}));
const loaded = (id: string) => loadChemDrawDocumentForCanvas(`<CDXML><page id="${id}"/></CDXML>`);
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  resetStore();
  vi.clearAllMocks();
});
it('aborts an older load and ignores its late completion', async () => {
  const first = deferred<ReturnType<typeof loaded>>();
  const second = deferred<ReturnType<typeof loaded>>();
  mocks.load.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = renderHook(() => useCanvasDocumentController(vi.fn(), () => undefined));
  let a!: Promise<boolean>;
  let b!: Promise<boolean>;
  act(() => {
    a = result.current.loadNative('first');
    b = result.current.loadNative('second');
  });
  expect(mocks.load.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => {
    second.resolve(loaded('second'));
    expect(await b).toBe(true);
  });
  await act(async () => {
    first.resolve(loaded('first'));
    expect(await a).toBe(false);
  });
  expect(useStore.getState().chemDrawDocument!.pages[0].id).toBe('second');
});
it('does not replace a document edited while parsing', async () => {
  const pending = deferred<ReturnType<typeof loaded>>();
  mocks.load.mockReturnValueOnce(pending.promise);
  const { result } = renderHook(() => useCanvasDocumentController(vi.fn(), () => undefined));
  const load = result.current.loadNative('source');
  const edited = loaded('edited').document;
  act(() => useStore.getState().commitDocument(edited));
  await act(async () => {
    pending.resolve(loaded('source'));
    expect(await load).toBe(false);
  });
  expect(useStore.getState().chemDrawDocument).toBe(edited);
});
it('checks revision again after replacement confirmation and cancels on unmount', async () => {
  mocks.load.mockResolvedValue(loaded('source'));
  const confirmation = deferred<boolean>();
  const { result, unmount } = renderHook(() =>
    useCanvasDocumentController(vi.fn(), () => undefined),
  );
  const load = result.current.loadNative('source', () => confirmation.promise);
  await act(async () => {
    await Promise.resolve();
  });
  const edited = loaded('edited').document;
  act(() => useStore.getState().commitDocument(edited));
  await act(async () => {
    confirmation.resolve(true);
    expect(await load).toBe(false);
  });
  expect(useStore.getState().chemDrawDocument).toBe(edited);
  const signal = mocks.load.mock.calls[0][1].signal;
  unmount();
  expect(signal.aborted).toBe(true);
});
