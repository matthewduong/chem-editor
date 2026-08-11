import { convertNativeToCanvas } from '../../../lib/chemdrawMetrics';
import { adaptColor, drawCircle, drawLine, drawPolyline, setStroke } from '../drawPrimitives';
import { pointInExpandedBounds } from '../geometry';
import { drawObjectTags } from './objectTagHelpers';
import type { ObjectModule } from '../types';
import { getPaintFontFamily } from '../../../lib/textMetrics';

export const GRAPHIC_MODULE: ObjectModule = {
  type: 'graphic',
  draw(object, context) {
    if (object.type !== 'graphic') return;
    const { scene, ctx } = context;
    const isSelected = scene.selectedObjectIds.has(object.id);
    const isHovered = scene.hoveredNativeObjectId === object.id;
    const color =
      isSelected || isHovered
        ? '#2196F3'
        : adaptColor(
            object.style?.color ?? (scene.isDarkMode ? '#ffffff' : '#333333'),
            scene.isDarkMode,
          );
    const strokeWidth =
      object.style?.lineWidth != null
        ? convertNativeToCanvas(object.style.lineWidth, scene.documentStyleSettings)
        : 1.5;
    const dash = object.style?.lineType === 'dashed' ? [6, 4] : undefined;
    const orbitalFill = object.style?.fillColor
      ? adaptColor(object.style.fillColor, scene.isDarkMode)
      : color;

    if (object.graphicType === 'line' && object.points && object.points.length >= 2) {
      drawPolyline(ctx, object.points, color, strokeWidth, { dash });
      return;
    }
    if (object.graphicType === 'polygon' && object.points && object.points.length >= 3) {
      drawPolyline(ctx, object.points, color, strokeWidth, { dash, closed: true });
      return;
    }
    if (object.graphicType === 'rounded-rectangle' && object.bounds) {
      ctx.save();
      if (object.shadowSize) {
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = Math.max(2, object.shadowSize * 0.6);
        ctx.shadowOffsetX = Math.max(1, object.shadowSize * 0.2);
        ctx.shadowOffsetY = Math.max(1, object.shadowSize * 0.2);
      }
      if (object.style?.fillColor) {
        ctx.fillStyle = adaptColor(object.style.fillColor, scene.isDarkMode);
      }
      setStroke(ctx, color, strokeWidth, dash);
      const x = object.bounds.left;
      const y = object.bounds.top;
      const width = object.bounds.right - object.bounds.left;
      const height = object.bounds.bottom - object.bounds.top;
      const radius = object.cornerRadius ?? 10;
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + width, y, x + width, y + height, radius);
      ctx.arcTo(x + width, y + height, x, y + height, radius);
      ctx.arcTo(x, y + height, x, y, radius);
      ctx.arcTo(x, y, x + width, y, radius);
      ctx.closePath();
      if (object.style?.fillColor) ctx.fill();
      ctx.stroke();
      drawObjectTags(ctx, scene, object.objectTags, {
        fallbackAnchor: {
          x: object.bounds.left + width / 2,
          y: object.bounds.top + height / 2,
        },
        fallbackColor: color,
      });
      ctx.restore();
      return;
    }
    if (object.graphicType === 'rectangle' && object.bounds) {
      ctx.save();
      if (object.shadowSize) {
        ctx.shadowColor = 'rgba(0,0,0,0.25)';
        ctx.shadowBlur = Math.max(2, object.shadowSize * 0.6);
        ctx.shadowOffsetX = Math.max(1, object.shadowSize * 0.2);
        ctx.shadowOffsetY = Math.max(1, object.shadowSize * 0.2);
      }
      if (object.style?.fillColor) {
        ctx.fillStyle = adaptColor(object.style.fillColor, scene.isDarkMode);
        ctx.fillRect(
          object.bounds.left,
          object.bounds.top,
          object.bounds.right - object.bounds.left,
          object.bounds.bottom - object.bounds.top,
        );
      }
      setStroke(ctx, color, strokeWidth, dash);
      ctx.strokeRect(
        object.bounds.left,
        object.bounds.top,
        object.bounds.right - object.bounds.left,
        object.bounds.bottom - object.bounds.top,
      );
      drawObjectTags(ctx, scene, object.objectTags, {
        fallbackAnchor: {
          x: (object.bounds.left + object.bounds.right) / 2,
          y: (object.bounds.top + object.bounds.bottom) / 2,
        },
        fallbackColor: color,
      });
      ctx.restore();
      return;
    }
    if (object.graphicType === 'ellipse' && object.bounds) {
      const cx = (object.bounds.left + object.bounds.right) / 2;
      const cy = (object.bounds.top + object.bounds.bottom) / 2;
      const radius = Math.max(
        (object.bounds.right - object.bounds.left) / 2,
        (object.bounds.bottom - object.bounds.top) / 2,
      );
      drawCircle(ctx, cx, cy, radius, {
        stroke: color,
        fill: object.style?.fillColor
          ? adaptColor(object.style.fillColor, scene.isDarkMode)
          : undefined,
        lineWidth: strokeWidth,
        dash,
        scaleY:
          (object.bounds.bottom - object.bounds.top) /
          Math.max(object.bounds.right - object.bounds.left, 1),
      });
      drawObjectTags(ctx, scene, object.objectTags, {
        fallbackAnchor: { x: cx, y: cy },
        fallbackColor: color,
      });
      return;
    }
    if (object.graphicType === 'symbol' && object.bounds) {
      const width = Math.abs(object.bounds.right - object.bounds.left);
      const height = Math.abs(object.bounds.bottom - object.bounds.top);
      const cx = (object.bounds.left + object.bounds.right) / 2;
      const cy = (object.bounds.top + object.bounds.bottom) / 2;
      const radius = Math.max(width, height, 8) / 2;
      const arm = radius * 0.48;
      if (object.symbolType === 'CirclePlus' || object.symbolType === 'CircleMinus') {
        drawCircle(ctx, cx, cy, radius, { stroke: color, lineWidth: strokeWidth });
        drawLine(ctx, cx - arm, cy, cx + arm, cy, color, strokeWidth);
        if (object.symbolType === 'CirclePlus') {
          drawLine(ctx, cx, cy - arm, cx, cy + arm, color, strokeWidth);
        }
        drawObjectTags(ctx, scene, object.objectTags, {
          fallbackAnchor: { x: cx, y: cy + radius + 10 },
          fallbackColor: color,
        });
        return;
      }
      if (object.symbolType === 'LonePair') {
        drawCircle(ctx, cx - radius * 0.28, cy, strokeWidth * 0.95, { fill: color });
        drawCircle(ctx, cx + radius * 0.28, cy, strokeWidth * 0.95, { fill: color });
        return;
      }
      if (object.symbolType === 'Electron') {
        drawCircle(ctx, cx, cy, strokeWidth, { fill: color });
        return;
      }
    }
    if (object.graphicType === 'bracket' && object.points && object.points.length >= 2) {
      const [start, end] = object.points;
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy);
      if (length < 1) return;
      const px = -dy / length;
      const py = dx / length;
      const lip = object.lipSize ?? Math.max(8, length * 0.35);
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;
      ctx.save();
      setStroke(ctx, color, strokeWidth);
      ctx.beginPath();
      if ((object.bracketType ?? '').toLowerCase() === 'square') {
        ctx.moveTo(start.x + px * lip, start.y + py * lip);
        ctx.lineTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.lineTo(end.x + px * lip, end.y + py * lip);
      } else {
        ctx.moveTo(start.x + px * lip, start.y + py * lip);
        ctx.quadraticCurveTo(start.x, start.y, midX, midY);
        ctx.quadraticCurveTo(end.x, end.y, end.x + px * lip, end.y + py * lip);
      }
      ctx.stroke();
      if (object.label) {
        ctx.font = `11px ${getPaintFontFamily(context.scene.documentStyleSettings.nativeMetrics.captionFontFamily)}`;
        ctx.fillStyle = color;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(object.label, midX - px * (lip + 10), midY - py * (lip + 10));
      }
      drawObjectTags(ctx, scene, object.objectTags, {
        fallbackAnchor: { x: midX, y: midY },
        fallbackColor: color,
      });
      ctx.restore();
      return;
    }
    if (object.graphicType === 'orbital') {
      const orbitalType = (object.orbitalType ?? '').toLowerCase();
      if (
        orbitalType.startsWith('s') &&
        object.center &&
        object.majorAxisEnd &&
        object.minorAxisEnd
      ) {
        const rx = Math.hypot(
          object.majorAxisEnd.x - object.center.x,
          object.majorAxisEnd.y - object.center.y,
        );
        const ry = Math.hypot(
          object.minorAxisEnd.x - object.center.x,
          object.minorAxisEnd.y - object.center.y,
        );
        const rotation = Math.atan2(
          object.majorAxisEnd.y - object.center.y,
          object.majorAxisEnd.x - object.center.x,
        );
        ctx.save();
        ctx.translate(object.center.x, object.center.y);
        ctx.rotate(rotation);
        ctx.beginPath();
        ctx.ellipse(0, 0, Math.max(rx, 1), Math.max(ry, 1), 0, 0, Math.PI * 2);
        ctx.globalAlpha = (object.ovalType ?? '').toLowerCase().includes('shaded') ? 0.22 : 0;
        ctx.fillStyle = orbitalFill;
        ctx.fill();
        ctx.globalAlpha = 1;
        setStroke(ctx, color, strokeWidth);
        ctx.stroke();
        ctx.restore();
        drawObjectTags(ctx, scene, object.objectTags, {
          fallbackAnchor: object.center,
          fallbackColor: color,
        });
        return;
      }
      if (orbitalType === 'p' && object.points && object.points.length >= 2) {
        const [start, end] = object.points;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (length < 1) return;
        const angle = Math.atan2(dy, dx);
        const midX = (start.x + end.x) / 2;
        const midY = (start.y + end.y) / 2;
        const lobeRx = Math.max(length * 0.2, 4);
        const lobeRy = Math.max(length * 0.11, 3);
        const lobeOffset = length * 0.26;
        ctx.save();
        ctx.translate(midX, midY);
        ctx.rotate(angle);
        setStroke(ctx, color, strokeWidth);
        ctx.fillStyle = orbitalFill;
        for (const offset of [-lobeOffset, lobeOffset]) {
          ctx.beginPath();
          ctx.ellipse(offset, 0, lobeRx, lobeRy, 0, 0, Math.PI * 2);
          ctx.globalAlpha = 0.18;
          ctx.fill();
          ctx.globalAlpha = 1;
          ctx.stroke();
        }
        ctx.restore();
        drawObjectTags(ctx, scene, object.objectTags, {
          fallbackAnchor: { x: midX, y: midY },
          fallbackColor: color,
        });
      }
    }
  },
  hitTest(object, point, context, options) {
    if (object.type !== 'graphic') return false;
    const bounds = context.scene.index.boundsById.get(object.id);
    return bounds ? pointInExpandedBounds(bounds, point, 8 / options.stageScale) : false;
  },
  editCapabilities: () => ['move', 'style'],
};
