import type { Arrow } from '../../../types/chemistry';
import type { ChemDrawArrow } from '../../../types/chemdraw';
import { getPaintFontFamily } from '../../../lib/textMetrics';
import {
  arrowUsesControlPoint,
  getArrowGeometryMetrics,
  getArrowLabelAnchors,
  getArrowOffsetCurve,
  getArrowPointAt,
  getArrowTangentAt,
} from '../../../lib/renderGeometry';
import {
  ARROW_SHAFT_NOTCH_GAP_PT,
  convertNativeToCanvas,
  getDocumentCaptionFontSize,
  resolveArrowHeadType,
} from '../../../lib/chemdrawMetrics';
import {
  arcFractionAtDistance,
  arcPointAt,
  arcTangentAt,
  resolveArcArrow,
  sampleArc,
} from '../../../lib/arrowArc';
import { resolveBondColor } from '../../../lib/settings';
import { adaptColor, setStroke } from '../drawPrimitives';
import { distanceToSegment } from '../geometry';
import type { ObjectModule } from '../types';

type CurvePoints = { x1: number; y1: number; x2: number; y2: number; cpx: number; cpy: number };

/**
 * Cuts `distance` off one end of a straight or quadratic arrow path, so a shaft stops where its
 * head begins instead of running under it.
 */
function trimPath(
  path: CurvePoints,
  curved: boolean,
  atEnd: boolean,
  distance: number,
): CurvePoints {
  if (distance <= 0) return path;
  const total = Math.hypot(path.x2 - path.x1, path.y2 - path.y1);
  if (total <= distance + 1e-6) return path;
  if (!curved) {
    const ux = (path.x2 - path.x1) / total;
    const uy = (path.y2 - path.y1) / total;
    return atEnd
      ? { ...path, x2: path.x2 - ux * distance, y2: path.y2 - uy * distance }
      : { ...path, x1: path.x1 + ux * distance, y1: path.y1 + uy * distance };
  }
  const at = (t: number) => ({
    x: (1 - t) ** 2 * path.x1 + 2 * (1 - t) * t * path.cpx + t ** 2 * path.x2,
    y: (1 - t) ** 2 * path.y1 + 2 * (1 - t) * t * path.cpy + t ** 2 * path.y2,
  });
  const anchor = atEnd ? { x: path.x2, y: path.y2 } : { x: path.x1, y: path.y1 };
  // distance from the end grows monotonically along these short arcs: bisect for it
  let lo = atEnd ? 0 : 0;
  let hi = 1;
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    const p = at(mid);
    const d = Math.hypot(p.x - anchor.x, p.y - anchor.y);
    if (atEnd ? d > distance : d < distance) {
      if (atEnd) lo = mid;
      else hi = mid;
    } else if (atEnd) hi = mid;
    else lo = mid;
  }
  const t = (lo + hi) / 2;
  const p = at(t);
  if (atEnd) {
    // left part of the quadratic split at t
    return {
      x1: path.x1,
      y1: path.y1,
      cpx: (1 - t) * path.x1 + t * path.cpx,
      cpy: (1 - t) * path.y1 + t * path.cpy,
      x2: p.x,
      y2: p.y,
    };
  }
  return {
    x1: p.x,
    y1: p.y,
    cpx: (1 - t) * path.cpx + t * path.x2,
    cpy: (1 - t) * path.cpy + t * path.y2,
    x2: path.x2,
    y2: path.y2,
  };
}

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
  // ChemDraw dashes a shaft 2.5pt on, 2.5pt off at any line width (50 50 at both 0.6 and 1.2).
  const dashLength = convertNativeToCanvas(2.5, documentStyleSettings);
  const dashPattern =
    arrow.type === 'dashed-reaction' || arrow.lineStyle === 'dashed'
      ? [dashLength, dashLength]
      : null;
  const len = Math.hypot(arrow.x2 - arrow.x1, arrow.y2 - arrow.y1);
  if (len < 2) return;
  const usesControlPoint = arrowUsesControlPoint(arrow);
  const endTangent = getArrowTangentAt(arrow, 1);
  const startTangent = getArrowTangentAt(arrow, 0);
  const endAngle = Math.atan2(endTangent.dy, endTangent.dx);
  const startAngle = Math.atan2(startTangent.dy, startTangent.dx);
  // How far the shaft stops short of the tip: the notch, less 0.05pt, for the closed heads; an
  // open angle head sits on a shaft that runs to the tip.
  const notchGap = convertNativeToCanvas(ARROW_SHAFT_NOTCH_GAP_PT, documentStyleSettings);
  const closedInset = Math.max(0, geometry.headCenterSize - notchGap);
  const headInset = headType === 'angle' ? 0 : closedInset;

  const strokePath = (
    points: CurvePoints = arrow as CurvePoints,
    width = strokeWidth,
    dash = dashPattern,
    reverse = false,
  ) => {
    setStroke(ctx, color, width, dash ?? undefined);
    ctx.lineCap = 'butt';
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

  /**
   * A head at (x, y) pointing along `angle`: the filled notched polygon for Solid, the same
   * polygon outlined for Hollow, two strokes for Angle. `half` -1 is ChemDraw's HalfLeft (one
   * barb, on the left of the direction of travel, the polygon standing on the shaft's edge) and
   * 1 is HalfRight.
   */
  const drawHead = (
    x: number,
    y: number,
    angle: number,
    kind: 'solid' | 'hollow' | 'angle',
    half: -1 | 0 | 1 = 0,
  ) => {
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const nx = -uy;
    const ny = ux;
    const point = (back: number, side: number) => ({
      x: x - ux * back + nx * side,
      y: y - uy * back + ny * side,
    });
    const L = geometry.headSize;
    const C = geometry.headCenterSize;
    const W = geometry.headWidth;
    const base = half === 0 ? 0 : (-half * geometry.baseLineWidth) / 2;
    const tip = point(0, base);
    const notch = point(C, base);
    const barbs = half === 0 ? [point(L, W), point(L, -W)] : [point(L, half * W)];
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    if (kind === 'angle') {
      setStroke(ctx, color, geometry.baseLineWidth);
      ctx.lineCap = 'butt';
      ctx.beginPath();
      for (const barb of barbs) {
        ctx.moveTo(barb.x, barb.y);
        ctx.lineTo(tip.x, tip.y);
      }
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    if (half === 0) {
      ctx.lineTo(barbs[0]!.x, barbs[0]!.y);
      ctx.lineTo(notch.x, notch.y);
      ctx.lineTo(barbs[1]!.x, barbs[1]!.y);
    } else {
      ctx.lineTo(notch.x, notch.y);
      ctx.lineTo(barbs[0]!.x, barbs[0]!.y);
    }
    ctx.closePath();
    if (kind === 'solid') {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      setStroke(ctx, color, geometry.baseLineWidth);
      ctx.lineJoin = 'miter';
      ctx.stroke();
    }
  };

  const drawNoGoCross = (cx: number, cy: number, angle: number) => {
    // ChemDraw's no-go cross: two diagonals, 5 line widths either side of the shaft's midpoint,
    // drawn at the plain line width.
    const half = 5 * geometry.baseLineWidth;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    setStroke(ctx, color, geometry.baseLineWidth);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (const sign of [1, -1]) {
      ctx.moveTo(cx - ux * half - -uy * half * sign, cy - uy * half - ux * half * sign);
      ctx.lineTo(cx + ux * half + -uy * half * sign, cy + uy * half + ux * half * sign);
    }
    ctx.stroke();
  };

  const resolvedKind: 'solid' | 'hollow' | 'angle' =
    headType === 'angle' ? 'angle' : headType === 'hollow' ? 'hollow' : 'solid';

  const drawResolvedHead = (x: number, y: number, angle: number, half: -1 | 0 | 1 = 0) =>
    drawHead(x, y, angle, resolvedKind, half);

  // An arrow ChemDraw describes as an arc is drawn as that arc: a circle or ellipse swept through
  // AngularSize. The quadratic the flat arrow carries cannot hold a half circle.
  const arc = nativeArrow ? resolveArcArrow(nativeArrow) : null;
  if (
    arc &&
    (arrow.type === 'reaction' ||
      arrow.type === 'dashed-reaction' ||
      arrow.type === 'curved' ||
      arrow.type === 'half-curved' ||
      arrow.type === 'resonance' ||
      arrow.type === 'no-reaction')
  ) {
    const fromFraction =
      arrow.type === 'resonance' ? arcFractionAtDistance(arc, headInset, false) : 0;
    const toFraction = arcFractionAtDistance(arc, headInset, true);
    const points = sampleArc(arc, fromFraction, Math.max(fromFraction, toFraction));
    setStroke(ctx, color, strokeWidth, dashPattern ?? undefined);
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index === 0) ctx.moveTo(point.x, point.y);
      else ctx.lineTo(point.x, point.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    const tip = arcPointAt(arc, 1);
    const end = arcTangentAt(arc, 1);
    drawResolvedHead(
      tip.x,
      tip.y,
      Math.atan2(end.y, end.x),
      arrow.type === 'half-curved' ? (nativeArrow?.headSide === 'right' ? 1 : -1) : 0,
    );
    if (arrow.type === 'resonance') {
      const base = arcPointAt(arc, 0);
      const first = arcTangentAt(arc, 0);
      drawResolvedHead(base.x, base.y, Math.atan2(first.y, first.x) + Math.PI);
    }
    if (arrow.type === 'no-reaction') {
      const mid = arcPointAt(arc, 0.5);
      const direction = arcTangentAt(arc, 0.5);
      const along = Math.atan2(direction.y, direction.x);
      drawNoGoCross(mid.x, mid.y, along);
    }
    return;
  }

  if (arrow.type === 'fat') {
    // The bold block arrow keeps its own proportions: a thick shaft and a solid head.
    const shaft = trimPath(
      arrow as CurvePoints,
      usesControlPoint,
      true,
      geometry.headCenterSize * 0.9,
    );
    strokePath(shaft, Math.max(6, strokeWidth * 1.8), null);
    ctx.fillStyle = color;
    const ux = Math.cos(endAngle);
    const uy = Math.sin(endAngle);
    ctx.beginPath();
    ctx.moveTo(arrow.x2, arrow.y2);
    ctx.lineTo(
      arrow.x2 - geometry.headSize * ux + geometry.headWidth * -uy,
      arrow.y2 - geometry.headSize * uy + geometry.headWidth * ux,
    );
    ctx.lineTo(
      arrow.x2 - geometry.headSize * ux - geometry.headWidth * -uy,
      arrow.y2 - geometry.headSize * uy - geometry.headWidth * ux,
    );
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (arrow.type === 'equilibrium') {
    const top = getArrowOffsetCurve(arrow, -geometry.shaftSpacing / 2);
    const bottomBase = getArrowOffsetCurve(arrow, geometry.shaftSpacing / 2);
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
    strokePath(trimPath(top, usesControlPoint, true, closedInset));
    drawHead(top.x2, top.y2, endAngle, 'solid', -1);
    strokePath(trimPath(bottom, usesControlPoint, false, closedInset), strokeWidth, null, true);
    drawHead(bottom.x1, bottom.y1, startAngle + Math.PI, 'solid', -1);
    return;
  }

  if (arrow.type === 'retrosynthetic') {
    const top = getArrowOffsetCurve(arrow, -geometry.shaftSpacing / 2);
    const bottom = getArrowOffsetCurve(arrow, geometry.shaftSpacing / 2);
    strokePath(top);
    strokePath(bottom);
    // The open head spans both shafts: it is drawn about the axis, from its tip on the axis.
    drawHead(arrow.x2, arrow.y2, endAngle, 'angle');
    return;
  }

  const inset = headInset;
  const shaft =
    arrow.type === 'resonance'
      ? trimPath(
          trimPath(arrow as CurvePoints, usesControlPoint, true, inset),
          usesControlPoint,
          false,
          inset,
        )
      : trimPath(
          arrow as CurvePoints,
          usesControlPoint,
          true,
          arrow.type === 'half-curved' ? inset : inset,
        );
  strokePath(shaft);

  if (arrow.type === 'half-curved') {
    drawResolvedHead(arrow.x2, arrow.y2, endAngle, -1);
    return;
  }
  drawResolvedHead(arrow.x2, arrow.y2, endAngle);
  if (arrow.type === 'resonance') {
    drawResolvedHead(arrow.x1, arrow.y1, startAngle + Math.PI);
  } else if (arrow.type === 'no-reaction') {
    const mid = getArrowPointAt(arrow, 0.5);
    const tangent = getArrowTangentAt(arrow, 0.5);
    drawNoGoCross(mid.x, mid.y, Math.atan2(tangent.dy, tangent.dx));
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
      ctx.font = `${labelFontSize}px ${getPaintFontFamily(labelFontFamily)}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = adaptColor(labelColor, scene.isDarkMode);
      ctx.fillText(labelAbove, anchors.above.x, anchors.above.y);
    }
    if (labelBelow) {
      ctx.font = `${labelFontSize}px ${getPaintFontFamily(labelFontFamily)}`;
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
