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
  moveContentIntoPage: () => void;
  centerPageInView: () => void;
}

export type EditPanelLayout = {
  pos: { x: number; y: number };
  size: { width: number; height: number };
  align: 'left' | 'right';
};
