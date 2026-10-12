import { chemDrawDocumentToCanvasState } from './chemdrawModel';
import type { ChemDrawDocument } from '../types/chemdraw';

export interface DocumentRecovery {
  version: 1;
  savedAt: string;
  path: string | null;
  document: ChemDrawDocument;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Parse an autosave recovery snapshot. The file is untrusted (it may be truncated by a crash,
 * hand-edited, or written by another version), so every failure is an `Error` naming the problem
 * rather than a `TypeError` from deep inside the document projection.
 */
export function parseDocumentRecovery(contents: string): DocumentRecovery {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new Error('The recovery file is not valid JSON.');
  }
  if (!isRecord(parsed)) throw new Error('The recovery file is not a recovery snapshot.');
  if (parsed.version !== 1) {
    throw new Error(`The recovery file has unsupported version ${String(parsed.version)}.`);
  }
  if (typeof parsed.savedAt !== 'string') {
    throw new Error('The recovery file is missing its save time.');
  }
  if (parsed.path !== null && typeof parsed.path !== 'string') {
    throw new Error('The recovery file has an invalid document path.');
  }
  const document = parsed.document;
  if (!isRecord(document) || document.schemaVersion !== 1) {
    throw new Error('The recovery document has an unsupported schema.');
  }
  if (!Array.isArray(document.pages) || document.pages.length === 0) {
    throw new Error('The recovery document has no pages.');
  }
  for (const page of document.pages) {
    if (!isRecord(page) || typeof page.id !== 'string' || !Array.isArray(page.objects)) {
      throw new Error('The recovery document has a malformed page.');
    }
    for (const object of page.objects) {
      if (!isRecord(object) || typeof object.id !== 'string' || typeof object.type !== 'string') {
        throw new Error('The recovery document has a malformed object.');
      }
    }
  }
  const typed = document as unknown as ChemDrawDocument;
  try {
    chemDrawDocumentToCanvasState(typed);
  } catch (error) {
    const wrapped = new Error(
      `The recovery document cannot be opened: ${error instanceof Error ? error.message : String(error)}`,
    );
    (wrapped as Error & { cause?: unknown }).cause = error;
    throw wrapped;
  }
  return { version: 1, savedAt: parsed.savedAt, path: parsed.path, document: typed };
}
