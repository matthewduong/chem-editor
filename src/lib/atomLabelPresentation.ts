import type { Atom, AtomLabelOrientation, Bond, TextRun } from '../types/chemistry';
import type { DocumentStyleSettings, DocumentViewSettings } from '../types/settings';
import {
  findLeadElementDisplayRange,
  getAtomDisplayText,
  getAtomHydrogenCount,
  getAtomLabelColorMode,
  getColoredAtomDisplaySegments,
} from './atomLabels';
import { getAtomAlias, getAtomLeadElement, setAtomValue } from './atomIdentity';
import { resolveDocumentLabelFaceStyle } from './chemdrawMetrics';
import { VALENCIES } from './elements';
import { resolveAtomLabelColor, resolveBondColor } from './settings';
import { SHORTHAND_DATA } from './shorthand';

export function buildAtomLabelRuns(
  atom: Atom,
  displayText: string,
  baseColor: string,
  documentStyleSettings: DocumentStyleSettings,
  documentViewSettings: DocumentViewSettings,
  isDarkMode: boolean,
): TextRun[] {
  const explicitRuns = atom.labelRuns;
  if (explicitRuns?.length) {
    const explicitText = explicitRuns.map((run) => run.text).join('');
    if (explicitText === displayText) return explicitRuns;
  }
  const defaultFaceStyle = resolveDocumentLabelFaceStyle(documentStyleSettings);
  if (atom.labelColor) return [{ text: displayText, color: atom.labelColor, ...defaultFaceStyle }];
  const shorthandColorMode = getAtomLabelColorMode(atom);
  if (shorthandColorMode === 'monochrome') {
    return [
      {
        text: displayText,
        ...defaultFaceStyle,
        color: resolveBondColor(undefined, documentStyleSettings, isDarkMode),
      },
    ];
  }
  if (shorthandColorMode === 'attached-element') {
    return [
      {
        text: displayText,
        ...defaultFaceStyle,
        color: resolveAtomLabelColor(
          undefined,
          getAtomLeadElement(atom),
          documentStyleSettings,
          isDarkMode,
          documentViewSettings,
        ),
      },
    ];
  }
  return getColoredAtomDisplaySegments(atom, displayText).map((segment) => ({
    text: segment.text,
    ...defaultFaceStyle,
    ...(segment.element
      ? {
          color: resolveAtomLabelColor(
            undefined,
            segment.element,
            documentStyleSettings,
            isDarkMode,
            documentViewSettings,
          ),
        }
      : { color: baseColor }),
  }));
}

export function getLeadElementAnchorOffset(
  runs: TextRun[],
  labelText: string,
  leadElement: string,
  fontSize: number,
  getLabelWidth: (fontSize: number, textWidth: number) => number,
  measureWidth: (run: TextRun) => number,
): { offset: number; width: number; padding: number } {
  const textWidth = runs.reduce((sum, run) => sum + measureWidth(run), 0);
  const width = getLabelWidth(fontSize, textWidth);
  const padding = (width - textWidth) / 2;
  const leadRange = findLeadElementDisplayRange(labelText, leadElement);
  if (!leadRange) return { offset: width / 2, width, padding };

  let textCursor = 0;
  let widthCursor = 0;
  let startPx: number | null = null;
  let endPx = 0;

  for (const run of runs) {
    const runWidth = measureWidth(run);
    const runLength = run.text.length;
    const runStart = textCursor;
    const runEnd = textCursor + runLength;
    if (runLength > 0) {
      const overlapStart = Math.max(runStart, leadRange.start);
      const overlapEnd = Math.min(runEnd, leadRange.end);
      if (overlapStart < overlapEnd) {
        const charWidth = runWidth / runLength;
        const overlapStartPx = widthCursor + (overlapStart - runStart) * charWidth;
        const overlapEndPx = widthCursor + (overlapEnd - runStart) * charWidth;
        if (startPx === null) startPx = overlapStartPx;
        endPx = overlapEndPx;
      }
    }
    textCursor = runEnd;
    widthCursor += runWidth;
  }

  if (startPx === null) return { offset: width / 2, width, padding };
  return { offset: padding + (startPx + endPx) / 2, width, padding };
}

export function getOrientationPreviewLabel(
  atom: Atom,
  value: string,
  orientation: AtomLabelOrientation,
  atoms: Atom[],
  bonds: Bond[],
  showHydrogens: boolean,
): string {
  const previewAtom = setAtomValue({ ...atom, labelOrientation: orientation }, value.trim() || 'C');
  previewAtom.labelOrientation = orientation;
  const leadElement = getAtomLeadElement(previewAtom);
  const knownValence = VALENCIES[leadElement] ?? null;
  const alias = getAtomAlias(previewAtom);
  const canShowImplicitHydrogens = !alias || Boolean(SHORTHAND_DATA[alias]);
  const hydrogenCount =
    showHydrogens && knownValence !== null && canShowImplicitHydrogens
      ? getAtomHydrogenCount(previewAtom, bonds, knownValence)
      : 0;
  return getAtomDisplayText(previewAtom, atoms, bonds, hydrogenCount).text;
}
