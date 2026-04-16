import type {
  ChemDrawBounds,
  ChemDrawObjectTag,
  ChemDrawPoint,
  ChemDrawTextBlock,
} from '../types/chemdraw';

export function getTextBlockPlainText(text?: ChemDrawTextBlock): string {
  if (!text?.runs?.length) return '';
  return text.runs.map((run) => run.text ?? '').join('');
}

export function getBoundsCenter(bounds: ChemDrawBounds): ChemDrawPoint {
  return {
    x: (bounds.left + bounds.right) / 2,
    y: (bounds.top + bounds.bottom) / 2,
  };
}

export function getObjectTagAnchor(tag: ChemDrawObjectTag): ChemDrawPoint | null {
  if (tag.textAnchor) return tag.textAnchor;
  if (tag.text?.bounds) return getBoundsCenter(tag.text.bounds);
  return null;
}
