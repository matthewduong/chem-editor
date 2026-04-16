import type { ChemDrawDocument } from '../types/chemdraw';
import type { CanvasState } from '../types/chemistry';
import type { DocumentStyleSettings, PageSetup } from '../types/settings';

export interface LoadChemDrawDocumentResult {
  document: ChemDrawDocument;
  state: CanvasState;
  warnings: string[];
  importWarnings: string[];
  projectionWarnings: string[];
}

export interface PrepareChemDrawDocumentForSaveParams {
  canvasState: CanvasState;
  document: ChemDrawDocument | null;
  documentStyleSettings: DocumentStyleSettings;
  pageSetup: PageSetup;
}

export interface PrepareChemDrawDocumentForSaveResult {
  document: ChemDrawDocument | null;
  xml: string;
}

export type CdxmlWorkerRequest =
  | { id: number; type: 'load'; xmlString: string }
  | { id: number; type: 'prepare-save'; params: PrepareChemDrawDocumentForSaveParams };

export type CdxmlWorkerResponse =
  | { id: number; success: true; type: 'load'; result: LoadChemDrawDocumentResult }
  | {
      id: number;
      success: true;
      type: 'prepare-save';
      result: PrepareChemDrawDocumentForSaveResult;
    }
  | { id: number; success: false; error: string };
