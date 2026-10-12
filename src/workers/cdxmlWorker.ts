/// <reference lib="webworker" />
import {
  loadChemDrawDocumentForCanvas,
  prepareChemDrawDocumentForSave,
} from '../lib/chemdrawDocumentCommands';
import type { CdxmlWorkerRequest, CdxmlWorkerResponse } from '../lib/cdxmlWorkerTypes';

const scope = self as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<CdxmlWorkerRequest>) => {
  const request = event.data;
  let response: CdxmlWorkerResponse;
  try {
    response =
      request.type === 'load'
        ? {
            id: request.id,
            type: 'load',
            success: true,
            result: loadChemDrawDocumentForCanvas(request.xmlString),
          }
        : {
            id: request.id,
            type: 'prepare-save',
            success: true,
            result: prepareChemDrawDocumentForSave(request.params),
          };
  } catch (error) {
    response = {
      id: request.id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  scope.postMessage(response);
};
scope.postMessage({ type: 'ready' } satisfies CdxmlWorkerResponse);
