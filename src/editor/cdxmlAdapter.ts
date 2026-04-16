import type { CanvasState } from '../types/chemistry';
import type { DocumentStyleSettings, PageSetup } from '../types/settings';
import { cdxmlToChemDrawDocument, chemDrawDocumentToCDXML, stateToCDXML } from '../utils/cdxml';

export function importCdxml(xmlString: string) {
  return cdxmlToChemDrawDocument(xmlString);
}

export function exportCdxml(document: Parameters<typeof chemDrawDocumentToCDXML>[0]): string {
  return chemDrawDocumentToCDXML(document);
}

export function exportCdxmlFromCanvasState(
  state: CanvasState,
  options?: { documentStyleSettings?: DocumentStyleSettings; pageSetup?: PageSetup },
): string {
  return stateToCDXML(state, options);
}
