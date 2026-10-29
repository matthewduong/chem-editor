import { ARROW_SHAFT_NOTCH_GAP_PT, convertNativeToCanvas } from '../../../lib/chemdrawMetrics';
import {
  CURVE_TYPE,
  cubicTangentAt,
  curveSegments,
  sampleCurve,
  trimCubic,
  type CubicSegment,
} from '../../../lib/curveGeometry';
import { getArrowGeometryMetrics } from '../../../lib/renderGeometry';
import type { ChemDrawArrowEnd, ChemDrawGraphic } from '../../../types/chemdraw';
import type { DocumentStyleSettings } from '../../../types/settings';
import { adaptColor, drawCircle, drawLine, drawPolyline, setStroke } from '../drawPrimitives';
import { distanceToSegment, pointInExpandedBounds } from '../geometry';
import { drawArrowHead } from './arrowModule';
import { drawObjectTags } from './objectTagHelpers';
import type { ObjectModule } from '../types';
import { getPaintFontFamily } from '../../../lib/textMetrics';

/** ChemDraw's default LipSize of 60, as import scales it. */
const DEFAULT_LIP = 10;
/** Bracket bulge as a fraction of the bracket's own length, measured against ChemDraw. */
const LIP_FRACTION_AT_DEFAULT = 0.16;

/**
 * A ChemDraw <curve>: cubic segments through its anchor triples, optionally closed, filled or
 * shaded, with arrowheads at either end (ChemDraw writes freehand curved arrows this way).
 */
function drawCurve(
  ctx: CanvasRenderingContext2D,
  object: ChemDrawGraphic,
  color: string,
  fill: string | undefined,
  settings: DocumentStyleSettings,
): void {
  const points = object.points ?? [];
  const bits = object.curveType ?? 0;
  const closed = object.closed === true || (bits & CURVE_TYPE.closed) !== 0;
  let segments = curveSegments(points, closed);
  if (segments.length === 0) return;
  const metrics = getArrowGeometryMetrics({ type: 'reaction' }, settings, {
    style: object.style,
  });
  const bold = object.style?.lineType === 'bold' || (bits & CURVE_TYPE.bold) !== 0;
  const dashed = object.style?.lineType === 'dashed' || (bits & CURVE_TYPE.dashed) !== 0;
  const width = bold
    ? convertNativeToCanvas(settings.nativeMetrics.boldWidth, settings)
    : metrics.baseLineWidth;
  // ChemDraw dashes 2.5pt on, 2.5pt off, as on an arrow shaft.
  const dashLength = convertNativeToCanvas(2.5, settings);

  const filled = fill != null || (bits & (CURVE_TYPE.filled | CURVE_TYPE.shaded)) !== 0;
  if (closed && filled) {
    ctx.save();
    ctx.beginPath();
    traceSegments(ctx, segments);
    ctx.closePath();
    ctx.fillStyle = fill ?? color;
    if (fill == null && (bits & CURVE_TYPE.shaded) !== 0) ctx.globalAlpha = 0.3;
    ctx.fill();
    ctx.restore();
  }

  const headEnd = closed ? 'none' : (object.headEnd ?? 'none');
  const tailEnd = closed ? 'none' : (object.tailEnd ?? 'none');
  const headKind =
    object.headType === 'angle' ? 'angle' : object.headType === 'hollow' ? 'hollow' : 'solid';
  const notchGap = convertNativeToCanvas(ARROW_SHAFT_NOTCH_GAP_PT, settings);
  const inset = headKind === 'angle' ? 0 : Math.max(0, metrics.headCenterSize - notchGap);
  const first = segments[0]!;
  const last = segments[segments.length - 1]!;
  if (tailEnd !== 'none' || headEnd !== 'none') {
    segments = segments.slice();
    if (headEnd !== 'none') segments[segments.length - 1] = trimCubic(last, true, inset);
    if (tailEnd !== 'none') segments[0] = trimCubic(segments[0]!, false, inset);
  }
  ctx.save();
  setStroke(ctx, color, width, dashed ? [dashLength, dashLength] : undefined);
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  traceSegments(ctx, segments);
  if (closed) ctx.closePath();
  ctx.stroke();
  ctx.setLineDash([]);
  const half = (end: ChemDrawArrowEnd): -1 | 0 | 1 =>
    end === 'half-left' ? -1 : end === 'half-right' ? 1 : 0;
  if (headEnd !== 'none') {
    const direction = cubicTangentAt(last, 1);
    drawArrowHead(
      ctx,
      color,
      metrics,
      last.p3.x,
      last.p3.y,
      Math.atan2(direction.y, direction.x),
      headKind,
      half(headEnd),
    );
  }
  if (tailEnd !== 'none') {
    const direction = cubicTangentAt(first, 0);
    drawArrowHead(
      ctx,
      color,
      metrics,
      first.p0.x,
      first.p0.y,
      Math.atan2(direction.y, direction.x) + Math.PI,
      headKind,
      half(tailEnd),
    );
  }
  ctx.restore();
}

function traceSegments(ctx: CanvasRenderingContext2D, segments: readonly CubicSegment[]): void {
  ctx.moveTo(segments[0]!.p0.x, segments[0]!.p0.y);
  for (const segment of segments) {
    ctx.bezierCurveTo(
      segment.c1.x,
      segment.c1.y,
      segment.c2.x,
      segment.c2.y,
      segment.p3.x,
      segment.p3.y,
    );
  }
}

/** Whether `point` lies within `tolerance` of a curve's stroke (or inside it, when filled). */
function hitTestCurve(
  object: ChemDrawGraphic,
  point: { x: number; y: number },
  tolerance: number,
): boolean {
  const closed = object.closed === true || ((object.curveType ?? 0) & CURVE_TYPE.closed) !== 0;
  const samples = sampleCurve(curveSegments(object.points ?? [], closed));
  for (let index = 1; index < samples.length; index += 1) {
    const a = samples[index - 1]!;
    const b = samples[index]!;
    if (distanceToSegment(point, a, b) <= tolerance) return true;
  }
  return false;
}

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
    if (object.graphicType === 'curve' && object.points && object.points.length >= 2) {
      drawCurve(
        ctx,
        object,
        color,
        object.style?.fillColor ? adaptColor(object.style.fillColor, scene.isDarkMode) : undefined,
        scene.documentStyleSettings,
      );
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
      // A bracket's lip is a fraction of its own height, not an absolute length. Rendering
      // brackets through ChemDraw at 11, 15, 25 and 46pt with its default LipSize gave bulges of
      // 1.75, 2.5, 4 and 7pt: 0.152 to 0.167 of the height throughout. Treating LipSize as points
      // put a 10pt lip on an 11pt bracket, which drew an arc bigger than the group it enclosed.
      //
      // What LipSize's unit actually is remains unknown -- every bracket in the reference corpus
      // carries the default 60 (imported as 10), so there is nothing to separate "60 means 16%"
      // from "the default happens to be 16%". Scaling relative to the default keeps a document
      // that sets it differently proportionally different.
      const lip =
        length * LIP_FRACTION_AT_DEFAULT * ((object.lipSize ?? DEFAULT_LIP) / DEFAULT_LIP);
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
    if (object.graphicType === 'curve') return hitTestCurve(object, point, 6 / options.stageScale);
    const bounds = context.scene.index.boundsById.get(object.id);
    return bounds ? pointInExpandedBounds(bounds, point, 8 / options.stageScale) : false;
  },
  editCapabilities: () => ['move', 'style'],
};
