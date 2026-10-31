import { isTauri } from '@tauri-apps/api/core';
import { useEffect, useRef } from 'react';
import type { openChemicalTextFile } from '../lib/fileDialogs';
import { invokeTauri } from '../lib/tauri';
import { useStore } from '../store';

type OpenedChemicalTextFile = NonNullable<Awaited<ReturnType<typeof openChemicalTextFile>>>;

/**
 * A CDXML path the app was started on ("Open with", or the OLE server's open editing), opened
 * once, in the main window, as File > Open would, so Save writes back to it.
 */
export function useStartupDocument(open: (file: OpenedChemicalTextFile) => Promise<unknown>): void {
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !isTauri()) return;
    opened.current = true;
    void invokeTauri<{ path: string; content: string } | null>('startup_document')
      .then((startup) =>
        startup
          ? open({ filePath: startup.path, extension: 'cdxml', content: startup.content })
          : undefined,
      )
      .catch((error: unknown) => {
        useStore.getState().showToast(`Could not open ${String(error)}`);
      });
  }, [open]);
}
