import { adaptColor, setStroke } from '../drawPrimitives';
import { pointInExpandedBounds } from '../geometry';
import { drawObjectTags } from './objectTagHelpers';
import type { ObjectModule } from '../types';

export const BRACKET_MODULE: ObjectModule = {
  type: 'bracket',
  draw(object, context) {
    if (object.type !== 'bracket') return;
    const { scene, ctx } = context;
    const isSelected = scene.selectedObjectIds.has(object.id);
    const isHovered = scene.hoveredNativeObjectId === object.id;
    const color =
      isSelected || isHovered
        ? '#2196F3'
        : adaptColor(object.style?.color ?? '#888888', scene.isDarkMode);
    const width = object.bounds.right - object.bounds.left;
    const lip = Math.max(6, Math.min(12, Math.abs(width) * 0.16));
    ctx.save();
    setStroke(ctx, color, isSelected ? 2 : 1.5);
    ctx.beginPath();
    ctx.moveTo(object.bounds.left + lip, object.bounds.top);
    ctx.lineTo(object.bounds.left, object.bounds.top);
    ctx.lineTo(object.bounds.left, object.bounds.bottom);
    ctx.lineTo(object.bounds.left + lip, object.bounds.bottom);
    ctx.moveTo(object.bounds.right - lip, object.bounds.top);
    ctx.lineTo(object.bounds.right, object.bounds.top);
    ctx.lineTo(object.bounds.right, object.bounds.bottom);
    ctx.lineTo(object.bounds.right - lip, object.bounds.bottom);
    ctx.stroke();
    if (object.label) {
      ctx.font = `12px ${context.scene.documentStyleSettings.nativeMetrics.captionFontFamily}`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(object.label, object.bounds.left + width / 2, object.bounds.top - 10);
    }
    drawObjectTags(ctx, scene, object.objectTags, {
      fallbackAnchor: {
        x: object.bounds.left + width / 2,
        y: object.bounds.top - 10,
      },
      fallbackColor: color,
    });
    ctx.restore();
  },
  hitTest(object, point, _context, options) {
    if (object.type !== 'bracket') return false;
    return pointInExpandedBounds(object.bounds, point, 8 / options.stageScale);
  },
  editCapabilities: () => ['move', 'style'],
};
