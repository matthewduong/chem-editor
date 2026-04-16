import type { CdxmlWorkerRequest, CdxmlWorkerResponse } from './cdxmlWorkerTypes';

let nextRequestId = 1;

function canUseCdxmlWorker(): boolean {
  return typeof window !== 'undefined' && typeof Worker !== 'undefined';
}

export function runCdxmlWorkerTask<TResult>(
  createRequest: (id: number) => CdxmlWorkerRequest,
): Promise<TResult> {
  if (!canUseCdxmlWorker()) {
    return Promise.reject(new Error('CDXML worker unavailable'));
  }

  return new Promise<TResult>((resolve, reject) => {
    const id = nextRequestId++;
    const worker = new Worker(new URL('../workers/cdxmlWorker.ts', import.meta.url), {
      type: 'module',
    });

    const cleanup = () => {
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
    };

    worker.onmessage = (event: MessageEvent<CdxmlWorkerResponse>) => {
      const response = event.data;
      if (!response || response.id !== id) return;
      cleanup();
      if (!response.success) {
        reject(new Error(response.error));
        return;
      }
      resolve(response.result as TResult);
    };

    worker.onerror = (event) => {
      cleanup();
      reject(event.error ?? new Error(event.message || 'CDXML worker failed'));
    };

    worker.onmessageerror = () => {
      cleanup();
      reject(new Error('CDXML worker returned an unreadable response'));
    };

    worker.postMessage(createRequest(id));
  });
}
