import {
  loadChemDrawDocumentForCanvas,
  prepareChemDrawDocumentForSave,
} from './chemdrawDocumentCommands';
import {
  runCdxmlWorkerTask,
  CdxmlWorkerUnavailableError,
  type CdxmlTaskOptions,
} from './cdxmlWorkerClient';
import type {
  LoadChemDrawDocumentResult,
  PrepareChemDrawDocumentForSaveParams,
  PrepareChemDrawDocumentForSaveResult,
} from './cdxmlWorkerTypes';

export async function loadChemDrawDocumentForCanvasAsync(
  xmlString: string,
  options?: CdxmlTaskOptions,
): Promise<LoadChemDrawDocumentResult> {
  try {
    return await runCdxmlWorkerTask<LoadChemDrawDocumentResult>(
      (id) => ({
        id,
        type: 'load',
        xmlString,
      }),
      options,
    );
  } catch (error) {
    if (!(error instanceof CdxmlWorkerUnavailableError)) throw error;
    if (options?.signal?.aborted) throw new DOMException('CDXML task cancelled', 'AbortError');
    console.warn('CDXML worker unavailable; using synchronous processing:', error.message);
    return loadChemDrawDocumentForCanvas(xmlString);
  }
}

export async function prepareChemDrawDocumentForSaveAsync(
  params: PrepareChemDrawDocumentForSaveParams,
  options?: CdxmlTaskOptions,
): Promise<PrepareChemDrawDocumentForSaveResult> {
  try {
    return await runCdxmlWorkerTask<PrepareChemDrawDocumentForSaveResult>(
      (id) => ({
        id,
        type: 'prepare-save',
        params,
      }),
      options,
    );
  } catch (error) {
    if (!(error instanceof CdxmlWorkerUnavailableError)) throw error;
    if (options?.signal?.aborted) throw new DOMException('CDXML task cancelled', 'AbortError');
    console.warn('CDXML worker unavailable; using synchronous processing:', error.message);
    return prepareChemDrawDocumentForSave(params);
  }
}
