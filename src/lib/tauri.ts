import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow, type Theme as AppWindowTheme } from '@tauri-apps/api/window';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

export type { AppWindowTheme };

export function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(command, args);
}

export function listenTauri<T>(
  event: string,
  handler: Parameters<typeof listen<T>>[1],
): ReturnType<typeof listen<T>> {
  return listen<T>(event, handler);
}

export function getCurrentAppWindow() {
  return getCurrentWindow();
}

/**
 * File > New Window: another document in its own window, configured like the main one. Labels are
 * `document-<n>`, which the default capability covers.
 */
export function openDocumentWindow(): void {
  const label = `document-${Date.now().toString(36)}`;
  new WebviewWindow(label, {
    url: 'index.html',
    title: 'ChemEditor',
    width: 1000,
    height: 700,
    decorations: false,
    zoomHotkeysEnabled: false,
  });
}

/** The label of the window this code runs in. */
export function currentWindowLabel(): string {
  return getCurrentWindow().label;
}

/** Tell the other windows that preferences changed, with the new value. */
export function broadcastTauri<T>(event: string, payload: T): Promise<void> {
  return emit(event, payload);
}

export function readClipboardText() {
  return readText();
}

export function writeClipboardText(value: string) {
  return writeText(value);
}
