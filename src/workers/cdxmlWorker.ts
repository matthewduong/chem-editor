/// <reference lib="webworker" />

import {
  chemDrawDocumentToCanvasState,
  mergeCanvasStateIntoChemDrawDocument,
} from '../lib/chemdrawModel';
import type {
  CdxmlWorkerRequest,
  CdxmlWorkerResponse,
  LoadChemDrawDocumentResult,
  PrepareChemDrawDocumentForSaveResult,
} from '../lib/cdxmlWorkerTypes';
import { cdxmlToChemDrawDocument, chemDrawDocumentToCDXML, stateToCDXML } from '../utils/cdxml';

function loadChemDrawDocumentForCanvas(xmlString: string): LoadChemDrawDocumentResult {
  const conversion = cdxmlToChemDrawDocument(xmlString);
  const projection = chemDrawDocumentToCanvasState(conversion.document);
  const warnings = [...new Set([...conversion.warnings, ...projection.warnings])];
  return {
    document: conversion.document,
    state: projection.state,
    warnings,
    importWarnings: conversion.warnings,
    projectionWarnings: projection.warnings,
  };
}

function prepareChemDrawDocumentForSave(
  request: Extract<CdxmlWorkerRequest, { type: 'prepare-save' }>['params'],
): PrepareChemDrawDocumentForSaveResult {
  const merged = request.document
    ? mergeCanvasStateIntoChemDrawDocument(request.document, request.canvasState).document
    : null;
  return {
    document: merged,
    xml: merged
      ? chemDrawDocumentToCDXML(merged)
      : stateToCDXML(request.canvasState, {
          documentStyleSettings: request.documentStyleSettings,
          pageSetup: request.pageSetup,
        }),
  };
}

function serializeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : 'Unknown CDXML worker error';
}

const workerScope = self as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<CdxmlWorkerRequest>) => {
  const request = event.data;
  let response: CdxmlWorkerResponse;
  try {
    if (request.type === 'load') {
      response = {
        id: request.id,
        success: true,
        type: 'load',
        result: loadChemDrawDocumentForCanvas(request.xmlString),
      };
    } else {
      response = {
        id: request.id,
        success: true,
        type: 'prepare-save',
        result: prepareChemDrawDocumentForSave(request.params),
      };
    }
  } catch (error) {
    response = {
      id: request.id,
      success: false,
      error: serializeError(error),
    };
  }
  workerScope.postMessage(response);
};

export {};
