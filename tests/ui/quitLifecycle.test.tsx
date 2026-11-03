import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
  handlers: new Map<string, (event: { payload: string }) => void>(),
}));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: string }) => void) => {
    mocks.handlers.set(name, handler);
    return () => mocks.handlers.delete(name);
  }),
}));
vi.mock('../../src/lib/tauri', () => ({
  invokeTauri: mocks.invokeTauri,
  getCurrentAppWindow: () => ({ onCloseRequested: async () => () => {}, destroy: vi.fn() }),
  openDocumentWindow: vi.fn(),
}));

import { useDocumentLifecycle } from '../../src/hooks/useDocumentLifecycle';
import { documentChangesBlocked, setDocumentQuitGuard } from '../../src/store/documentGuard';
import { useStore } from '../../src/store';

const saveNative = vi.fn();
function Host() {
  return useDocumentLifecycle({ current: { saveNative } } as never).dialog;
}
const acks = () =>
  mocks.invokeTauri.mock.calls.filter(([command]) => command === 'acknowledge_document_quit');

async function requestQuit(token: string) {
  render(<Host />);
  await act(async () => {});
  await act(async () => mocks.handlers.get('document-quit-requested')!({ payload: token }));
}

beforeEach(() => {
  mocks.invokeTauri.mockReset();
  mocks.invokeTauri.mockImplementation(async (command: string) =>
    command === 'list_document_recovery' ? { snapshots: [], errors: [] } : null,
  );
  saveNative.mockReset();
  setDocumentQuitGuard(null);
  useStore.setState({
    documentFile: { ...useStore.getState().documentFile, path: null, dirty: false },
  } as never);
});

test('a clean window confirms receipt, then votes ready and blocks further edits', async () => {
  await requestQuit('t1');
  expect(mocks.invokeTauri).toHaveBeenCalledWith('receive_document_quit', { token: 't1' });
  expect(acks()).toEqual([['acknowledge_document_quit', { token: 't1', ready: true }]]);
  expect(documentChangesBlocked()).toBe(true);
});

test('cancelling the save dialog votes not ready and leaves edits allowed', async () => {
  useStore.setState({
    documentFile: { ...useStore.getState().documentFile, dirty: true },
  } as never);
  await requestQuit('t2');
  expect(acks()).toEqual([]);
  await act(async () => fireEvent.click(screen.getByText('Cancel')));
  expect(acks()).toEqual([['acknowledge_document_quit', { token: 't2', ready: false }]]);
  expect(documentChangesBlocked()).toBe(false);
});

test('a failed save votes not ready', async () => {
  useStore.setState({
    documentFile: { ...useStore.getState().documentFile, dirty: true },
  } as never);
  saveNative.mockRejectedValue(new Error('disk full'));
  await requestQuit('t3');
  await act(async () => fireEvent.click(screen.getByText('Save')));
  expect(acks()).toEqual([['acknowledge_document_quit', { token: 't3', ready: false }]]);
  expect(documentChangesBlocked()).toBe(false);
});

test('an IPC failure mid-vote still withdraws the vote so later quits are not ignored', async () => {
  mocks.invokeTauri.mockImplementation(async (command: string) => {
    if (command === 'list_document_recovery') return { snapshots: [], errors: [] };
    if (command === 'receive_document_quit') throw new Error('Quit attempt expired');
    return null;
  });
  await requestQuit('t4');
  expect(acks()).toEqual([['acknowledge_document_quit', { token: 't4', ready: false }]]);
  expect(documentChangesBlocked()).toBe(false);
});

test('the coordinator cancelling a quit releases the edit guard', async () => {
  await requestQuit('t5');
  expect(documentChangesBlocked()).toBe(true);
  await act(async () => mocks.handlers.get('document-quit-cancelled')!({ payload: 't5' }));
  expect(documentChangesBlocked()).toBe(false);
});
