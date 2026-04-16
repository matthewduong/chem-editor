import type { CanvasState } from '../types/chemistry';
import type {
  ChemDrawDocument,
  ChemDrawEditingCapability,
  ChemDrawObject,
} from '../types/chemdraw';
import type { DocumentStyleSettings, PageSetup } from '../types/settings';
import {
  chemDrawDocumentToCanvasState,
  mergeCanvasStateIntoChemDrawDocument,
} from './chemdrawModel';
import { cdxmlToChemDrawDocument, chemDrawDocumentToCDXML, stateToCDXML } from '../utils/cdxml';

export interface ChemDrawCompatibilitySummary {
  warningCount: number;
  preservedObjectCount: number;
  roundTripOnlyCount: number;
  renderOnlyCount: number;
  preservedPageChildCount: number;
  graphicCount: number;
  objectTagCount: number;
  embeddedObjectCount: number;
  tableCount: number;
}

export function getChemDrawObjectCapability(object: ChemDrawObject): ChemDrawEditingCapability {
  if (object.preservation?.capability) return object.preservation.capability;
  if (
    object.type === 'graphic' ||
    object.type === 'bracket' ||
    object.type === 'embedded-object' ||
    object.type === 'table' ||
    object.type === 'group'
  ) {
    return 'round-trip-only';
  }
  return 'editable';
}

export function getChemDrawObjectPreservationReasons(object: ChemDrawObject): string[] {
  return object.preservation?.reasons ?? [];
}

export function summarizeChemDrawCompatibility(
  document: ChemDrawDocument | null,
  warnings: string[] = [],
): ChemDrawCompatibilitySummary {
  const page = document?.pages[0];
  const objects = page?.objects ?? [];
  let roundTripOnlyCount = 0;
  let renderOnlyCount = 0;
  let graphicCount = 0;
  let objectTagCount = 0;
  let embeddedObjectCount = 0;
  let tableCount = 0;
  for (const object of objects) {
    const capability = getChemDrawObjectCapability(object);
    if (capability === 'round-trip-only') roundTripOnlyCount += 1;
    else if (capability === 'render-only') renderOnlyCount += 1;
    if (object.type === 'graphic' || object.type === 'bracket') graphicCount += 1;
    if (object.type === 'embedded-object') embeddedObjectCount += 1;
    if (object.type === 'table') tableCount += 1;
    objectTagCount += object.objectTags?.length ?? 0;
  }
  const preservedPageChildCount = page?.preservedPageChildren?.length ?? 0;
  return {
    warningCount: warnings.length,
    preservedObjectCount: roundTripOnlyCount + renderOnlyCount + preservedPageChildCount,
    roundTripOnlyCount,
    renderOnlyCount,
    preservedPageChildCount,
    graphicCount,
    objectTagCount,
    embeddedObjectCount,
    tableCount,
  };
}

export function loadChemDrawDocumentForCanvas(xmlString: string): {
  document: ChemDrawDocument;
  state: CanvasState;
  warnings: string[];
  importWarnings: string[];
  projectionWarnings: string[];
} {
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

export function prepareChemDrawDocumentForSave(params: {
  canvasState: CanvasState;
  document: ChemDrawDocument | null;
  documentStyleSettings: DocumentStyleSettings;
  pageSetup: PageSetup;
}): { document: ChemDrawDocument | null; xml: string } {
  const merged = params.document
    ? mergeCanvasStateIntoChemDrawDocument(params.document, params.canvasState).document
    : null;
  return {
    document: merged,
    xml: merged
      ? chemDrawDocumentToCDXML(merged)
      : stateToCDXML(params.canvasState, {
          documentStyleSettings: params.documentStyleSettings,
          pageSetup: params.pageSetup,
        }),
  };
}
