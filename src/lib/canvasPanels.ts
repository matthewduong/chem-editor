import type { EditPanelLayout } from '../types/canvas';
export function getCornerPanelX(
  containerWidth: number,
  panelWidth: number,
  align: EditPanelLayout['align'],
) {
  return align === 'left' ? 12 : Math.max(12, containerWidth - panelWidth - 12);
}
