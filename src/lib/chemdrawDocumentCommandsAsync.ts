import {
  loadChemDrawDocumentForCanvas,
  prepareChemDrawDocumentForSave,
} from './chemdrawDocumentCommands';
import { runCdxmlWorkerTask } from './cdxmlWorkerClient';
import type {
  LoadChemDrawDocumentResult,
  PrepareChemDrawDocumentForSaveParams,
  PrepareChemDrawDocumentForSaveResult,
} from './cdxmlWorkerTypes';

export async function loadChemDrawDocumentForCanvasAsync(
  xmlString: string,
): Promise<LoadChemDrawDocumentResult> {
  try {
    return await runCdxmlWorkerTask<LoadChemDrawDocumentResult>((id) => ({
      id,
      type: 'load',
      xmlString,
    }));
  } catch {
    return loadChemDrawDocumentForCanvas(xmlString);
  }
}

export async function prepareChemDrawDocumentForSaveAsync(
  params: PrepareChemDrawDocumentForSaveParams,
): Promise<PrepareChemDrawDocumentForSaveResult> {
  try {
    return await runCdxmlWorkerTask<PrepareChemDrawDocumentForSaveResult>((id) => ({
      id,
      type: 'prepare-save',
      params,
    }));
  } catch {
    return prepareChemDrawDocumentForSave(params);
  }
}
