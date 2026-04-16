import { convertNativeToCanvas } from '../../../lib/chemdrawMetrics';
import { adaptColor, setStroke } from '../drawPrimitives';
import { pointInExpandedBounds } from '../geometry';
import { drawObjectTags } from './objectTagHelpers';
import type { ObjectModule } from '../types';

export const TABLE_MODULE: ObjectModule = {
  type: 'table',
  draw(object, context) {
    if (object.type !== 'table') return;
    const { scene, ctx } = context;
    const isSelected = scene.selectedObjectIds.has(object.id);
    const isHovered = scene.hoveredNativeObjectId === object.id;
    const strokeColor =
      isSelected || isHovered
        ? '#2196F3'
        : adaptColor(object.style?.color ?? '#666666', scene.isDarkMode);
    const fillColor = adaptColor(object.style?.fillColor ?? '#ffffff', scene.isDarkMode);
    const strokeWidth =
      object.style?.lineWidth != null
        ? convertNativeToCanvas(object.style.lineWidth, scene.documentStyleSettings)
        : 1.2;
    const width = object.bounds.right - object.bounds.left;
    const height = object.bounds.bottom - object.bounds.top;

    ctx.save();
    ctx.fillStyle = fillColor;
    ctx.fillRect(object.bounds.left, object.bounds.top, width, height);
    setStroke(ctx, strokeColor, strokeWidth);
    ctx.strokeRect(object.bounds.left, object.bounds.top, width, height);

    for (const cell of object.cells) {
      const cellWidth = cell.boundsInParent.right - cell.boundsInParent.left;
      const cellHeight = cell.boundsInParent.bottom - cell.boundsInParent.top;
      ctx.strokeRect(cell.boundsInParent.left, cell.boundsInParent.top, cellWidth, cellHeight);
      if (cell.text) {
        ctx.fillStyle = strokeColor;
        ctx.font = `11px ${scene.documentStyleSettings.nativeMetrics.captionFontFamily}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(
          cell.text.runs.map((run) => run.text).join(''),
          cell.boundsInParent.left + cellWidth / 2,
          cell.boundsInParent.top + cellHeight / 2,
          Math.max(16, cellWidth - 8),
        );
      }
    }

    drawObjectTags(ctx, scene, object.objectTags, {
      fallbackAnchor: {
        x: object.bounds.left + width / 2,
        y: object.bounds.top - 10,
      },
      fallbackColor: strokeColor,
    });
    ctx.restore();
  },
  hitTest(object, point, _context, options) {
    if (object.type !== 'table') return false;
    return pointInExpandedBounds(object.bounds, point, 8 / options.stageScale);
  },
  editCapabilities: () => ['move', 'style'],
};
