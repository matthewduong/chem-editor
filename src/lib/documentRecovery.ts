import { isTauri } from '@tauri-apps/api/core';
import { invokeTauri } from './tauri';
import type { ChemDrawDocument } from '../types/chemdraw';

export interface DocumentRecovery {
  version: 1;
  savedAt: string;
  path: string | null;
  document: ChemDrawDocument;
}

const STORAGE_KEY = 'chem-editor.document-recovery.v1';
let pendingWrite = Promise.resolve();

/** localStorage can be absent or throw (private windows, blocked site data); recovery is then unavailable. */
function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export async function loadDocumentRecovery(): Promise<DocumentRecovery | null> {
  const contents = isTauri()
    ? await invokeTauri<string | null>('load_document_recovery')
    : (browserStorage()?.getItem(STORAGE_KEY) ?? null);
  if (!contents) return null;
  const parsed = JSON.parse(contents) as DocumentRecovery;
  if (parsed.version !== 1 || !Array.isArray(parsed.document?.pages)) {
    throw new Error('The recovery document has an unsupported format.');
  }
  return parsed;
}

/** Serialize writes so a slow autosave cannot resurrect a discarded snapshot. */
export function saveDocumentRecovery(recovery: DocumentRecovery | null): Promise<void> {
  const contents = recovery ? JSON.stringify(recovery) : null;
  const write = pendingWrite
    .catch(() => {})
    .then(async () => {
      if (isTauri()) {
        await invokeTauri('save_document_recovery', { contents });
      } else if (contents) {
        browserStorage()?.setItem(STORAGE_KEY, contents);
      } else {
        browserStorage()?.removeItem(STORAGE_KEY);
      }
    });
  pendingWrite = write;
  return write;
}
