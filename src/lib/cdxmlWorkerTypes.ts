import type { ChemDrawDocument } from '../types/chemdraw';
import type { CanvasState } from '../types/chemistry';

export interface LoadChemDrawDocumentResult {
  document: ChemDrawDocument;
  state: CanvasState;
  warnings: string[];
  importWarnings: string[];
  projectionWarnings: string[];
}

export interface PrepareChemDrawDocumentForSaveParams {
  document: ChemDrawDocument;
}

export interface PrepareChemDrawDocumentForSaveResult {
  document: ChemDrawDocument;
  xml: string;
}

export type CdxmlWorkerRequest =
  | { id: number; type: 'load'; xmlString: string }
  | { id: number; type: 'prepare-save'; params: PrepareChemDrawDocumentForSaveParams };

export type CdxmlWorkerResponse =
  | { type: 'ready' }
  | { id: number; success: true; type: 'load'; result: LoadChemDrawDocumentResult }
  | {
      id: number;
      success: true;
      type: 'prepare-save';
      result: PrepareChemDrawDocumentForSaveResult;
    }
  | { id: number; success: false; error: string };
