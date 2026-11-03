let quitToken: string | null = null;
export function setDocumentQuitGuard(token: string | null) {
  quitToken = token;
}
export function documentChangesBlocked() {
  return quitToken !== null;
}

import type { StateCreator } from 'zustand';
export function guardDocumentWrites<T extends object>(
  createState: StateCreator<T>,
): StateCreator<T> {
  return (rawSet, get, api) => {
    const guarded: typeof rawSet = (update) =>
      rawSet((state) => {
        const next =
          typeof update === 'function' ? (update as (s: T) => Partial<T>)(state) : update;
        if (
          documentChangesBlocked() &&
          Object.keys(next).some((key) =>
            [
              'chemDrawDocument',
              'documentRevision',
              'documentSessionId',
              'previewChemDrawDocument',
              'documentFile',
            ].includes(key),
          )
        )
          return state;
        return next;
      });
    api.setState = guarded;
    return createState(guarded, get, api);
  };
}
