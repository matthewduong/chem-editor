import { afterEach, describe, expect, it, vi } from 'vitest';
import { runCdxmlWorkerTask } from '../../src/lib/cdxmlWorkerClient';
import { loadChemDrawDocumentForCanvasAsync } from '../../src/lib/chemdrawDocumentCommandsAsync';

class FakeWorker {
  static last: FakeWorker;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message: string }) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.last = this;
  }
  send(data: unknown) {
    this.onmessage?.({ data });
  }
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
describe('CDXML worker lifecycle', () => {
  it('waits for initialization, rejects task errors and terminates without retry', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const promise = loadChemDrawDocumentForCanvasAsync('<CDXML/>');
    const worker = FakeWorker.last;
    expect(worker.postMessage).not.toHaveBeenCalled();
    worker.send({ type: 'ready' });
    const request = worker.postMessage.mock.calls[0][0];
    worker.send({ id: request.id, success: false, error: 'task failed' });
    await expect(promise).rejects.toThrow('task failed');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
  });
  it('falls back only when initialization is unavailable', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const promise = loadChemDrawDocumentForCanvasAsync('<CDXML><page id="1"/></CDXML>');
    FakeWorker.last.onerror?.({ message: 'Cannot initialize' });
    expect((await promise).document.pages).toHaveLength(1);
    expect(warn).toHaveBeenCalledOnce();
  });
  it('cleans up cancellation and ignores late completion', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const controller = new AbortController();
    const promise = runCdxmlWorkerTask((id) => ({ id, type: 'load', xmlString: '<CDXML/>' }), {
      signal: controller.signal,
    });
    const worker = FakeWorker.last;
    const late = worker.onmessage;
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    late?.({ data: { type: 'ready' } });
    expect(worker.postMessage).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
  it('rejects malformed messages rather than hanging', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const promise = runCdxmlWorkerTask((id) => ({ id, type: 'load', xmlString: '' }));
    FakeWorker.last.send(null);
    await expect(promise).rejects.toThrow('invalid response');
  });
});
