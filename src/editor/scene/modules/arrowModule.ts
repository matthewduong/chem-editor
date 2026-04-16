import type { Arrow } from '../../../types/chemistry';
import type { ChemDrawArrow } from '../../../types/chemdraw';
import {
  arrowUsesControlPoint,
  getArrowGeometryMetrics,
  getArrowLabelAnchors,
  getArrowOffsetCurve,
  getArrowPointAt,
  getArrowTangentAt,
} from '../../../lib/renderGeometry';
import { getDocumentCaptionFontSize, resolveArrowHeadType } from '../../../lib/chemdrawMetrics';
import { resolveBondColor } from '../../../lib/settings';
import { adaptColor, drawLine, setStroke } from '../drawPrimitives';
import { distanceToSegment } from '../geometry';
import type { ObjectModule } from '../types';

function drawArrowShape(
  ctx: CanvasRenderingContext2D,
  arrow: Pick<
    Arrow,
    'type' | 'x1' | 'y1' | 'x2' | 'y2' | 'cpx' | 'cpy' | 'lineWidth' | 'lineStyle' | 'curveEnabled'
  >,
  color: string,
  documentStyleSettings: import('../../../types/settings').DocumentStyleSettings,
  nativeArrow?: ChemDrawArrow | null,
) {
  const geometry = getArrowGeometryMetrics(arrow, documentStyleSettings, nativeArrow);
  const headType = resolveArrowHeadType({ type: arrow.type }, nativeArrow);
  const strokeWidth = geometry.lineWidth;
  const dashPattern =
    arrow.type === 'dashed-reaction' ? [6, 4] : arrow.lineStyle === 'dashed' ? [6, 4] : null;
  const len = Math.hypot(arrow.x2 - arrow.x1, arrow.y2 - arrow.y1);
  if (len < 2) return;
  const usesControlPoint = arrowUsesControlPoint(arrow);
  const endTangent = getArrowTangentAt(arrow, 1);
  const startTangent = getArrowTangentAt(arrow, 0);
  const endAngle = Math.atan2(endTangent.dy, endTangent.dx);
  const startAngle = Math.atan2(startTangent.dy, startTangent.dx);

  const strokePath = (
    points: { x1: number; y1: number; x2: number; y2: number; cpx: number; cpy: number } = arrow,
    width = strokeWidth,
    dash = dashPattern,
    reverse = false,
  ) => {
    setStroke(ctx, color, width, dash ?? undefined);
    ctx.beginPath();
    if (reverse) {
      ctx.moveTo(points.x2, points.y2);
      if (usesControlPoint) ctx.quadraticCurveTo(points.cpx, points.cpy, points.x1, points.y1);
      else ctx.lineTo(points.x1, points.y1);
    } else {
      ctx.moveTo(points.x1, points.y1);
      if (usesControlPoint) ctx.quadraticCurveTo(points.cpx, points.cpy, points.x2, points.y2);
      else ctx.lineTo(points.x2, points.y2);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  const fillHead = (x: number, y: number, angle: number) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x - geometry.headSize * Math.cos(angle) + geometry.headWidth * Math.sin(angle),
      y - geometry.headSize * Math.sin(angle) - geometry.headWidth * Math.cos(angle),
    );
    ctx.lineTo(
      x - geometry.headSize * Math.cos(angle) - geometry.headWidth * Math.sin(angle),
      y - geometry.headSize * Math.sin(angle) + geometry.headWidth * Math.cos(angle),
    );
    ctx.closePath();
    ctx.fill();
  };

  const strokeHead = (x: number, y: number, angle: number, half = false, side: 1 | -1 = -1) => {
    setStroke(ctx, color, strokeWidth);
    ctx.beginPath();
    const headLength = half ? geometry.headCenterSize : geometry.headSize;
    const points = half
      ? [
          {
            x: x - headLength * Math.cos(angle) + side * geometry.headWidth * Math.sin(angle),
            y: y - headLength * Math.sin(angle) - side * geometry.headWidth * Math.cos(angle),
          },
        ]
      : [
          {
            x: x - headLength * Math.cos(angle) + geometry.headWidth * Math.sin(angle),
            y: y - headLength * Math.sin(angle) - geometry.headWidth * Math.cos(angle),
          },
          { x, y },
          {
            x: x - headLength * Math.cos(angle) - geometry.headWidth * Math.sin(angle),
            y: y - headLength * Math.sin(angle) + geometry.headWidth * Math.cos(angle),
          },
        ];
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(x, y);
    if (!half && points[2]) ctx.lineTo(points[2].x, points[2].y);
    ctx.stroke();
  };

  const strokeAngleHead = (x: number, y: number, angle: number) => {
    setStroke(ctx, color, strokeWidth);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(
      x - geometry.headSize * Math.cos(angle) + geometry.headWidth * Math.sin(angle),
      y - geometry.headSize * Math.sin(angle) - geometry.headWidth * Math.cos(angle),
    );
    ctx.moveTo(x, y);
    ctx.lineTo(
      x - geometry.headSize * Math.cos(angle) - geometry.headWidth * Math.sin(angle),
      y - geometry.headSize * Math.sin(angle) + geometry.headWidth * Math.cos(angle),
    );
    ctx.stroke();
  };

  const drawResolvedHead = (x: number, y: number, angle: number) => {
    if (headType === 'filled') fillHead(x, y, angle);
    else if (headType === 'angle') strokeAngleHead(x, y, angle);
    else strokeHead(x, y, angle);
  };

  if (arrow.type === 'fat') {
    strokePath(arrow, Math.max(6, strokeWidth * 1.8), null);
    fillHead(arrow.x2, arrow.y2, endAngle);
    return;
  }

  if (arrow.type === 'equilibrium') {
    const top = getArrowOffsetCurve(arrow, -geometry.shaftSpacing);
    const bottomBase = getArrowOffsetCurve(arrow, geometry.shaftSpacing);
    const bottom =
      geometry.equilibriumRatio < 0.999
        ? {
            ...bottomBase,
            x1: bottomBase.x2 + (bottomBase.x1 - bottomBase.x2) * geometry.equilibriumRatio,
            y1: bottomBase.y2 + (bottomBase.y1 - bottomBase.y2) * geometry.equilibriumRatio,
            cpx: bottomBase.x2 + (bottomBase.cpx - bottomBase.x2) * geometry.equilibriumRatio,
            cpy: bottomBase.y2 + (bottomBase.cpy - bottomBase.y2) * geometry.equilibriumRatio,
          }
        : bottomBase;
    strokePath(top);
    strokeHead(top.x2, top.y2, endAngle, true, -1);
    strokePath(bottom, strokeWidth, null, true);
    strokeHead(bottom.x1, bottom.y1, startAngle + Math.PI, true, 1);
    return;
  }

  if (arrow.type === 'retrosynthetic') {
    const top = getArrowOffsetCurve(arrow, -geometry.shaftSpacing);
    const bottom = getArrowOffsetCurve(arrow, geometry.shaftSpacing);
    strokePath(top);
    strokePath(bottom);
    drawResolvedHead(arrow.x2, arrow.y2, endAngle);
    return;
  }

  strokePath();
  if (arrow.type === 'reaction' || arrow.type === 'dashed-reaction' || arrow.type === 'curved') {
    drawResolvedHead(arrow.x2, arrow.y2, endAngle);
  } else if (arrow.type === 'no-reaction') {
    drawResolvedHead(arrow.x2, arrow.y2, endAngle);
    const mid = getArrowPointAt(arrow, 0.5);
    const tangent = getArrowTangentAt(arrow, 0.5);
    const angle = Math.atan2(tangent.dy, tangent.dx);
    const crossLen = Math.max(9, geometry.headSize * 0.9);
    const perpX = -Math.sin(angle);
    const perpY = Math.cos(angle);
    drawLine(
      ctx,
      mid.x - Math.cos(angle) * crossLen - perpX * crossLen,
      mid.y - Math.sin(angle) * crossLen - perpY * crossLen,
      mid.x + Math.cos(angle) * crossLen + perpX * crossLen,
      mid.y + Math.sin(angle) * crossLen + perpY * crossLen,
      color,
      Math.max(strokeWidth, 2.5),
    );
    drawLine(
      ctx,
      mid.x + Math.cos(angle) * crossLen - perpX * crossLen,
      mid.y + Math.sin(angle) * crossLen - perpY * crossLen,
      mid.x - Math.cos(angle) * crossLen + perpX * crossLen,
      mid.y - Math.sin(angle) * crossLen + perpY * crossLen,
      color,
      Math.max(strokeWidth, 2.5),
    );
  } else if (arrow.type === 'resonance') {
    drawResolvedHead(arrow.x2, arrow.y2, endAngle);
    drawResolvedHead(arrow.x1, arrow.y1, startAngle + Math.PI);
  } else if (arrow.type === 'half-curved') {
    strokeHead(arrow.x2, arrow.y2, endAngle, true, -1);
  }
}

function hitTestArrow(arrow: Arrow, point: { x: number; y: number }, stageScale: number): boolean {
  const radius = 12 / stageScale;
  if (arrowUsesControlPoint(arrow)) {
    for (let t = 0; t <= 1; t += 0.05) {
      const sample = getArrowPointAt(arrow, t);
      if (Math.hypot(point.x - sample.x, point.y - sample.y) < radius) return true;
    }
    return false;
  }
  return (
    distanceToSegment(point, { x: arrow.x1, y: arrow.y1 }, { x: arrow.x2, y: arrow.y2 }) < radius
  );
}

export const ARROW_MODULE: ObjectModule = {
  type: 'arrow',
  draw(object, context) {
    if (object.type !== 'arrow') return;
    const { scene, ctx } = context;
    const arrow = scene.legacy.arrowById.get(object.id);
    if (!arrow) return;
    const isSelected = scene.selectedArrowIds.has(object.id);
    const isHovered = scene.hoveredArrowId === object.id;
    const defaultColor = resolveBondColor(undefined, scene.documentStyleSettings, scene.isDarkMode);
    const color =
      isSelected || isHovered
        ? '#2196F3'
        : arrow.strokeColor
          ? adaptColor(arrow.strokeColor, scene.isDarkMode)
          : defaultColor;
    ctx.save();
    ctx.globalAlpha = isHovered && !isSelected ? 0.65 : 1;
    drawArrowShape(ctx, arrow, color, scene.documentStyleSettings, object);
    const labelAbove = arrow.labelAbove || arrow.label;
    const labelBelow = arrow.labelBelow;
    const labelFontSize =
      arrow.labelFontSize ?? getDocumentCaptionFontSize(scene.documentStyleSettings);
    const labelFontFamily = scene.documentStyleSettings.nativeMetrics.captionFontFamily;
    const labelColor = arrow.labelColor
      ? isSelected || isHovered
        ? '#2196F3'
        : arrow.labelColor
      : color;
    const anchors = getArrowLabelAnchors(arrow);
    if (labelAbove) {
      ctx.font = `${labelFontSize}px ${labelFontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = adaptColor(labelColor, scene.isDarkMode);
      ctx.fillText(labelAbove, anchors.above.x, anchors.above.y);
    }
    if (labelBelow) {
      ctx.font = `${labelFontSize}px ${labelFontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = adaptColor(labelColor, scene.isDarkMode);
      ctx.fillText(labelBelow, anchors.below.x, anchors.below.y);
    }
    ctx.restore();
  },
  hitTest(object, point, context, options) {
    if (object.type !== 'arrow') return false;
    const arrow = context.scene.legacy.arrowById.get(object.id);
    if (!arrow) return false;
    return hitTestArrow(arrow, point, options.stageScale);
  },
  editCapabilities: () => ['move', 'style', 'label'],
};
