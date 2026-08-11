import { convertNativeToCanvas } from '../../../lib/chemdrawMetrics';
import { getTextBlockPlainText } from '../../../lib/objectTags';
import { adaptColor, setStroke } from '../drawPrimitives';
import { pointInExpandedBounds } from '../geometry';
import { drawObjectTags } from './objectTagHelpers';
import type { ObjectModule } from '../types';
import { getPaintFontFamily } from '../../../lib/textMetrics';

const IMAGE_CACHE = new Map<string, HTMLImageElement | null>();

function getPreviewImage(dataUrl: string | undefined): HTMLImageElement | null {
  if (!dataUrl || typeof Image === 'undefined') return null;
  const cached = IMAGE_CACHE.get(dataUrl);
  if (cached) return cached.complete ? cached : null;
  const image = new Image();
  image.src = dataUrl;
  IMAGE_CACHE.set(dataUrl, image);
  return image.complete ? image : null;
}

export const EMBEDDED_OBJECT_MODULE: ObjectModule = {
  type: 'embedded-object',
  draw(object, context) {
    if (object.type !== 'embedded-object') return;
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
        : 1.5;
    const width = object.bounds.right - object.bounds.left;
    const height = object.bounds.bottom - object.bounds.top;
    ctx.save();
    ctx.fillStyle = fillColor;
    ctx.fillRect(object.bounds.left, object.bounds.top, width, height);
    setStroke(
      ctx,
      strokeColor,
      strokeWidth,
      object.style?.lineType === 'dashed' ? [6, 4] : undefined,
    );
    ctx.strokeRect(object.bounds.left, object.bounds.top, width, height);
    const previewImage = getPreviewImage(object.previewDataUrl);
    if (previewImage) {
      ctx.drawImage(previewImage, object.bounds.left, object.bounds.top, width, height);
      setStroke(ctx, strokeColor, strokeWidth);
      ctx.strokeRect(object.bounds.left, object.bounds.top, width, height);
    } else {
      const label = getTextBlockPlainText({
        runs: [{ text: object.payloadKind === 'pdf' ? 'Embedded PDF' : 'Embedded Image' }],
      });
      ctx.fillStyle = strokeColor;
      ctx.font = `12px ${getPaintFontFamily(scene.documentStyleSettings.nativeMetrics.captionFontFamily)}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, object.bounds.left + width / 2, object.bounds.top + height / 2);
    }
    drawObjectTags(ctx, scene, object.objectTags, {
      fallbackAnchor: {
        x: object.bounds.left + width / 2,
        y: object.bounds.bottom + 12,
      },
      fallbackColor: strokeColor,
    });
    ctx.restore();
  },
  hitTest(object, point, _context, options) {
    if (object.type !== 'embedded-object') return false;
    return pointInExpandedBounds(object.bounds, point, 8 / options.stageScale);
  },
  editCapabilities: () => ['move', 'style'],
};
