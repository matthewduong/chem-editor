import type { CdxmlWorkerRequest, CdxmlWorkerResponse } from './cdxmlWorkerTypes';

let nextRequestId = 1;
export class CdxmlWorkerUnavailableError extends Error {}
export interface CdxmlTaskOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export function runCdxmlWorkerTask<TResult>(
  createRequest: (id: number) => CdxmlWorkerRequest,
  options: CdxmlTaskOptions = {},
): Promise<TResult> {
  if (options.signal?.aborted)
    return Promise.reject(new DOMException('CDXML task cancelled', 'AbortError'));
  if (typeof Worker === 'undefined')
    return Promise.reject(new CdxmlWorkerUnavailableError('CDXML worker unavailable'));
  return new Promise<TResult>((resolve, reject) => {
    const id = nextRequestId++;
    let worker: Worker;
    try {
      worker = new Worker(new URL('../workers/cdxmlWorker.ts', import.meta.url), {
        type: 'module',
      });
    } catch (error) {
      reject(new CdxmlWorkerUnavailableError(String(error)));
      return;
    }
    let ready = false;
    let settled = false;
    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };
    const fail = (error: unknown) => {
      if (!settled) {
        cleanup();
        reject(error);
      }
    };
    const abort = () => fail(new DOMException('CDXML task cancelled', 'AbortError'));
    const timer = setTimeout(
      () => fail(new Error('CDXML worker timed out.')),
      options.timeoutMs ?? 120_000,
    );
    options.signal?.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<CdxmlWorkerResponse>) => {
      if (settled) return;
      const response = event.data;
      if (!response || typeof response !== 'object') {
        fail(new Error('CDXML worker returned an invalid response'));
        return;
      }
      if ('type' in response && response.type === 'ready') {
        if (ready) return;
        ready = true;
        try {
          worker.postMessage(createRequest(id));
        } catch (error) {
          fail(error);
        }
        return;
      }
      if (!('id' in response) || response.id !== id) return;
      cleanup();
      if (!response.success) reject(new Error(response.error));
      else resolve(response.result as TResult);
    };
    worker.onerror = (event) =>
      fail(
        ready
          ? new Error(event.message || 'CDXML worker failed')
          : new CdxmlWorkerUnavailableError(event.message || 'CDXML worker failed to initialize'),
      );
    if (options.signal?.aborted) abort();
    worker.onmessageerror = () => fail(new Error('CDXML worker returned an unreadable response'));
  });
}
