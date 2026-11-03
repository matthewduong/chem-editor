import { isTauri } from '@tauri-apps/api/core';
import { invokeTauri } from './tauri';
import { parseDocumentRecovery, type DocumentRecovery } from './recoveryFormat';

export type { DocumentRecovery };

const STORAGE_KEY = 'chem-editor.document-recovery.v1';
// This window's snapshot identity; a recovered window keeps the identity it claimed, so its
// autosaves replace the claimed snapshot instead of leaving a stale duplicate beside it.
let snapshotId: string = crypto.randomUUID();
let pendingWrite = Promise.resolve();

/** localStorage can be absent or throw (private windows, blocked site data); recovery is then unavailable. */
function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export async function listDocumentRecovery(
  report: (message: string) => void,
): Promise<DocumentRecovery[]> {
  if (isTauri()) {
    const result = await invokeTauri<{ snapshots: unknown[]; errors: string[] }>(
      'list_document_recovery',
    );
    if (result.errors.length) console.error('Unreadable recovery files retained:', result.errors);
    const snapshots: DocumentRecovery[] = [];
    const errors = [...result.errors];
    for (const value of result.snapshots) {
      try {
        snapshots.push(parseDocumentRecovery(JSON.stringify(value)));
      } catch (error) {
        errors.push(String(error));
      }
    }
    if (errors.length) {
      report(`Unreadable recovery files retained: ${errors.join('; ')}`);
    }
    return snapshots;
  }
  const contents = browserStorage()?.getItem(STORAGE_KEY);
  return contents ? [parseDocumentRecovery(contents)] : [];
}
export async function claimDocumentRecovery(id: string): Promise<DocumentRecovery> {
  const recovery = parseDocumentRecovery(
    await invokeTauri<string>('claim_document_recovery', { id }),
  );
  snapshotId = id;
  return recovery;
}
export async function discardDocumentRecovery(id?: string): Promise<void> {
  if (isTauri() && id) await invokeTauri('discard_document_recovery', { id });
  else browserStorage()?.removeItem(STORAGE_KEY);
}

/** Serialize writes so a slow autosave cannot resurrect a discarded snapshot. */
export function saveDocumentRecovery(recovery: DocumentRecovery | null): Promise<void> {
  const contents = recovery ? JSON.stringify({ ...recovery, version: 2, id: snapshotId }) : null;
  const write = pendingWrite
    .catch(() => {})
    .then(async () => {
      if (isTauri()) {
        await invokeTauri('save_document_recovery', { id: snapshotId, contents });
      } else if (contents) {
        browserStorage()?.setItem(STORAGE_KEY, contents);
      } else {
        browserStorage()?.removeItem(STORAGE_KEY);
      }
    });
  pendingWrite = write;
  return write;
}

/**
 * Wait for queued snapshot writes to settle. A failed autosave has already been reported and must
 * not make every later quit fail, so the outcome is ignored.
 */
export function flushRecoveryWrites(): Promise<void> {
  return pendingWrite.catch(() => {});
}
