/**
 * File > Preferences > Save Files Every (ChemDraw 17.1 guide, "Autosave and Autorecovery"): the
 * open document is saved every so many minutes. Here it is off unless set, and it saves only a
 * file this session opened or saved as CDXML, with unsaved changes; anything else (an untitled
 * document, an imported molfile, a failed import) is left to the recovery snapshot.
 */
export function shouldAutosave(
  minutes: number,
  file: { path: string | null; format: string | null; dirty: boolean },
): boolean {
  return minutes > 0 && Boolean(file.path) && file.format === 'cdxml' && file.dirty;
}

/** The preference's allowed values: 0 (off) to a day, in whole minutes. */
export function normalizeAutosaveMinutes(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1440, Math.max(0, Math.round(value)))
    : 0;
}
