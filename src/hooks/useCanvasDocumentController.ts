import { useEffect, useRef } from 'react';
import {
  loadChemDrawDocumentForCanvasAsync,
  prepareChemDrawDocumentForSaveAsync,
} from '../lib/chemdrawDocumentCommandsAsync';
import { saveBinaryWithDialog, saveTextToPath, saveTextWithDialog } from '../lib/fileDialogs';
import { generateCanvasSVG } from '../lib/svgExportFromStore';
import { useStore } from '../store';

import type { ChemCanvasRef } from '../types/canvas';

export function useCanvasDocumentController(
  resetStageView: () => void,
  exportPng: () => string | undefined,
): Pick<ChemCanvasRef, 'saveNative' | 'loadNative' | 'exportPNG' | 'exportSVG'> {
  const loadState = useRef({ serial: 0, controller: null as AbortController | null });
  useEffect(
    () => () => {
      loadState.current.serial++;
      loadState.current.controller?.abort();
    },
    [],
  );
  return {
    saveNative: async (options = {}) => {
      try {
        const store = useStore.getState();
        const { chemDrawDocument } = store;
        const snapshot = {
          document: chemDrawDocument,
          revision: store.documentRevision,
          sessionId: store.documentSessionId,
        };
        if (!chemDrawDocument) throw new Error('No document to save.');
        const prepared = await prepareChemDrawDocumentForSaveAsync({ document: chemDrawDocument });
        if (options.path && !options.prompt) {
          const path = await saveTextToPath(options.path, prepared.xml);
          return { path, saved: true, snapshot };
        }
        const path = await saveTextWithDialog({
          title: options.prompt ? 'Save Sketch As' : 'Save Sketch',
          defaultPath: options.path ?? 'sketch.cdxml',
          name: 'ChemDraw XML',
          extensions: ['cdxml'],
          content: prepared.xml,
        });
        return { path, saved: Boolean(path), snapshot };
      } catch (e) {
        useStore.getState().showToast('Failed to save file');
        console.error(e);
        return { path: null, saved: false };
      }
    },
    loadNative: async (c, beforeReplace, path) => {
      const serial = ++loadState.current.serial;
      loadState.current.controller?.abort();
      const controller = new AbortController();
      loadState.current.controller = controller;
      const source = useStore.getState();
      const sessionId = source.documentSessionId;
      const revision = source.documentRevision;
      let loaded;
      try {
        loaded = await loadChemDrawDocumentForCanvasAsync(c, { signal: controller.signal });
      } catch (error) {
        if (controller.signal.aborted || serial !== loadState.current.serial) return false;
        throw error;
      }
      if (
        serial !== loadState.current.serial ||
        sessionId !== useStore.getState().documentSessionId ||
        revision !== useStore.getState().documentRevision
      )
        return false;
      if (beforeReplace && !(await beforeReplace())) return false;
      if (
        serial !== loadState.current.serial ||
        sessionId !== useStore.getState().documentSessionId ||
        revision !== useStore.getState().documentRevision
      )
        return false;
      const store = useStore.getState();
      store.replaceDocument(loaded.document, loaded.warnings, path);
      for (const warning of loaded.warnings.slice(0, 3)) store.showToast(warning, 'info');
      resetStageView();
      return true;
    },
    exportPNG: async () => {
      try {
        const d = exportPng();
        if (!d) return;
        await saveBinaryWithDialog({
          title: 'Export PNG',
          defaultPath: 'molecule.png',
          name: 'PNG Image',
          extensions: ['png'],
          content: Uint8Array.from(atob(d.split(',')[1]), (c) => c.charCodeAt(0)),
        });
      } catch (e) {
        useStore.getState().showToast('PNG export failed');
        console.error(e);
      }
    },
    exportSVG: async () => {
      try {
        const {
          atoms: a,
          bonds: b,
          arrows: arr,
          isDarkMode: dm,
          textBoxes: tb,
          pageSetup: currentPageSetup,
        } = useStore.getState();
        const svg = generateCanvasSVG(a, b, arr, dm, false, tb ?? [], currentPageSetup);
        await saveTextWithDialog({
          title: 'Export SVG',
          defaultPath: 'molecule.svg',
          name: 'SVG Vector Image',
          extensions: ['svg'],
          content: svg,
        });
      } catch (e) {
        useStore.getState().showToast('SVG export failed');
        console.error(e);
      }
    },
  };
}
