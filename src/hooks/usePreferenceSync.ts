import { isTauri } from '@tauri-apps/api/core';
import { useEffect } from 'react';
import { normalizeAppPreferences } from '../lib/settings';
import { currentWindowLabel, listenTauri } from '../lib/tauri';
import { PREFERENCES_CHANGED_EVENT, useStore } from '../store';

/**
 * Preferences changed in another document window (File > New Window) are adopted here without
 * being saved again, so no window later writes a stale copy over them.
 */
export function usePreferenceSync(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    let cancelled = false;
    void listenTauri<{ source: string; preferences: unknown }>(
      PREFERENCES_CHANGED_EVENT,
      (event) => {
        if (event.payload.source === currentWindowLabel()) return;
        useStore
          .getState()
          .hydrateAppPreferences(normalizeAppPreferences(event.payload.preferences as never));
      },
    ).then((stop) => {
      if (cancelled) stop();
      else unlisten = stop;
    });
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
