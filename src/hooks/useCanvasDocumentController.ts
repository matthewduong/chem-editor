import { useEffect, useRef } from 'react';
import { encodeEmf, encodeEps, encodePdf, encodeTiff } from '../lib/rasterExports';
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
  exportPng: (format?: 'png' | 'jpeg') => string | undefined,
): Pick<
  ChemCanvasRef,
  'saveNative' | 'loadNative' | 'exportPNG' | 'exportJPEG' | 'exportSVG' | 'exportRaster'
> {
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
    exportJPEG: async () => {
      try {
        const d = exportPng('jpeg');
        if (!d) return;
        await saveBinaryWithDialog({
          title: 'Export JPEG',
          defaultPath: 'molecule.jpg',
          name: 'JPEG Image',
          extensions: ['jpg', 'jpeg'],
          content: Uint8Array.from(atob(d.split(',')[1]), (c) => c.charCodeAt(0)),
        });
      } catch (e) {
        useStore.getState().showToast('JPEG export failed');
        console.error(e);
      }
    },
    exportRaster: async (format) => {
      try {
        const png = exportPng('png');
        const jpeg = format === 'pdf' || format === 'eps' ? exportPng('jpeg') : null;
        if (!png) return;
        // Pixels, and the drawing's size in points (exports render at 3x).
        const image = new Image();
        image.src = png;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(image, 0, 0);
        const { width, height } = canvas;
        const rgba = new Uint8Array(ctx.getImageData(0, 0, width, height).data.buffer);
        const points = [width / 3, height / 3] as const;
        const jpegBytes = jpeg
          ? Uint8Array.from(atob(jpeg.split(',')[1]!), (c) => c.charCodeAt(0))
          : null;
        const content =
          format === 'tiff'
            ? encodeTiff(width, height, rgba, 216)
            : format === 'emf'
              ? encodeEmf(width, height, rgba, ...points)
              : format === 'pdf'
                ? encodePdf(jpegBytes!, width, height, ...points)
                : encodeEps(jpegBytes!, width, height, ...points);
        const label = {
          tiff: 'TIFF Image',
          pdf: 'PDF Document',
          eps: 'EPS Image',
          emf: 'EMF Metafile',
        }[format];
        const extension = format === 'tiff' ? 'tif' : format;
        await saveBinaryWithDialog({
          title: `Export ${format.toUpperCase()}`,
          defaultPath: `molecule.${extension}`,
          name: label,
          extensions: format === 'tiff' ? ['tif', 'tiff'] : [extension],
          content,
        });
      } catch (e) {
        useStore.getState().showToast(`${format.toUpperCase()} export failed`);
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
