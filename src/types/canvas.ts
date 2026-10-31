export interface ChemCanvasRef {
  saveNative: (options?: { path?: string | null; prompt?: boolean }) => Promise<{
    path: string | null;
    saved: boolean;
    snapshot?: {
      document: import('../types/chemdraw').ChemDrawDocument | null;
      revision: number;
      sessionId: string;
    };
  }>;
  loadNative: (
    content: string,
    beforeReplace?: () => Promise<boolean>,
    path?: string | null,
  ) => Promise<boolean>;
  exportPNG: () => Promise<void>;
  /** File > Export > JPEG: the drawing on its paper, as exported PNGs are drawn. */
  exportJPEG: () => Promise<void>;
  /** File > Export As TIFF, PDF, EPS or EMF: the export raster in that format. */
  exportRaster: (format: 'tiff' | 'pdf' | 'eps' | 'emf') => Promise<void>;
  exportSVG: () => Promise<void>;
  insertImage: (options: {
    bytes: Uint8Array;
    mimeType: 'image/png' | 'image/jpeg';
    sourceFileName?: string;
  }) => Promise<void>;
  getMolblock: () => string;
  loadFromSmiles: (smiles: string) => void;
  cleanUp: () => void;
  beginTemplatePlacement: (template: import('../lib/templates').UserTemplate) => void;
  revealObjects: (ids: string[]) => void;
  addFromState: (buf: import('../lib/clipboard').ClipboardBuffer) => void;
  addFromSmiles: (input: string) => void;
  applyTextFormat: (cmd: string, value?: string) => void;
  fitToScreen: () => void;
  /** Structure > Name to Structure: from `name`, or from the selected caption; false if unread. */
  structureFromName: (name?: string) => boolean;
  /** Structure > Structure to Name: captions under the selected structures. */
  nameStructures: () => void;
  /** Edit > Copy As: the selection as text in `format`, or null. */
  structureText: (format: import('../lib/structureText').StructureTextFormat) => string | null;
  /** Structure > Expand Label / Contract Label for the selection. */
  expandLabels: () => void;
  contractLabel: () => void;
  /** View > Magnify, Reduce and Actual Size (ChemDraw F7, F8, F5). */
  zoomIn: () => void;
  zoomOut: () => void;
  actualSize: () => void;
  moveContentIntoPage: () => void;
  centerPageInView: () => void;
}

export type EditPanelLayout = {
  pos: { x: number; y: number };
  size: { width: number; height: number };
  align: 'left' | 'right';
};
