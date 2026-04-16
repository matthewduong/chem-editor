import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
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

export function readClipboardText() {
  return readText();
}

export function writeClipboardText(value: string) {
  return writeText(value);
}
