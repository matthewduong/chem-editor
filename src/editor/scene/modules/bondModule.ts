import { convertNativeToCanvas } from '../../../lib/chemdrawMetrics';
import { getPaintFontFamily } from '../../../lib/textMetrics';
import {
  collectBondNeighborVectors,
  getAtomBondClipOffset,
  getBondVisualMetrics,
  getDoubleBondLineGeometry,
  getOffsetBondLineGeometry,
  resolveDoubleBondMode,
  getTripleBondLineGeometry,
} from '../../../lib/renderGeometry';
import { resolveBondColor } from '../../../lib/settings';
import { drawLine, drawPolyline, setStroke } from '../drawPrimitives';
import { distanceToSegment } from '../geometry';
import type { ObjectModule } from '../types';
import { drawObjectTags } from './objectTagHelpers';
import { drawBondQueryIndicator, hasQueryTag } from './queryIndicators';
import { drawBondStereoIndicator, hasStereoTag } from './stereoIndicators';

export const BOND_MODULE: ObjectModule = {
  type: 'bond',
  draw(object, context) {
    if (object.type !== 'bond') return;
    const { scene, ctx } = context;
    const bond = scene.legacy.bondById.get(object.id);
    if (!bond) return;
    const fromAtom = scene.legacy.atomById.get(bond.from);
    const toAtom = scene.legacy.atomById.get(bond.to);
    if (!fromAtom || !toAtom) return;
    const dx = toAtom.x - fromAtom.x;
    const dy = toAtom.y - fromAtom.y;
    const dist = Math.hypot(dx, dy);
    if (dist === 0) return;
    const unitX = dx / dist;
    const unitY = dy / dist;
    const startClip = getAtomBondClipOffset(
      fromAtom,
      scene.legacy.atoms,
      scene.legacy.bonds,
      unitX,
      unitY,
      scene.documentStyleSettings,
      scene.legacy.labelMetricsCache,
    );
    const endClip = getAtomBondClipOffset(
      toAtom,
      scene.legacy.atoms,
      scene.legacy.bonds,
      -unitX,
      -unitY,
      scene.documentStyleSettings,
      scene.legacy.labelMetricsCache,
    );
    const startX = fromAtom.x + unitX * startClip;
    const startY = fromAtom.y + unitY * startClip;
    const endX = toAtom.x - unitX * endClip;
    const endY = toAtom.y - unitY * endClip;
    const isSelected =
      scene.selectedBondIds.has(object.id) ||
      (scene.selectedAtomIds.has(fromAtom.id) && scene.selectedAtomIds.has(toAtom.id));
    const isHovered = scene.hoveredBondId === object.id;
    const baseColor = resolveBondColor(
      bond.color ?? object.style?.color,
      scene.documentStyleSettings,
      scene.isDarkMode,
    );
    const color = isSelected || isHovered ? '#2196F3' : baseColor;
    drawObjectTags(ctx, scene, object.objectTags, {
      fallbackAnchor: { x: (fromAtom.x + toAtom.x) / 2, y: (fromAtom.y + toAtom.y) / 2 },
      fallbackColor: baseColor,
    });
    if (!hasQueryTag(object.objectTags)) {
      drawBondQueryIndicator(
        ctx,
        scene,
        object.id,
        object.query?.ringState,
        object.rxnParticipation,
        baseColor,
      );
    }
    if (scene.documentViewSettings.showStereochemistry && !hasStereoTag(object.objectTags)) {
      drawBondStereoIndicator(ctx, scene, object.id, baseColor);
    }
    const lineWidth =
      bond.lineWidth ??
      (object.style?.lineWidth != null
        ? convertNativeToCanvas(object.style.lineWidth, scene.documentStyleSettings)
        : scene.documentStyleSettings.bondLineWidth);
    const visual = getBondVisualMetrics(lineWidth, dist, {
      documentStyleSettings: scene.documentStyleSettings,
      nativeBond: object,
    });
    const normalX = -unitY * visual.parallelOffset;
    const normalY = unitX * visual.parallelOffset;
    const visibleIntervals = scene.legacy.bondVisibleIntervals.get(object.id) ?? [[0, 1]];
    const bondNeighborVectors =
      bond.order === 2 || bond.order === 3
        ? collectBondNeighborVectors({
            bond,
            fromAtom,
            toAtom,
            atomLookup: scene.legacy.atomById,
            bonds: scene.legacy.bonds,
          })
        : null;
    const drawSegmentedLine = (
      x1: number,
      y1: number,
      x2: number,
      y2: number,
      strokeWidth = lineWidth,
      dash?: number[],
    ) => {
      for (const [startT, endT] of visibleIntervals) {
        drawLine(
          ctx,
          x1 + (x2 - x1) * startT,
          y1 + (y2 - y1) * startT,
          x1 + (x2 - x1) * endT,
          y1 + (y2 - y1) * endT,
          color,
          strokeWidth,
          dash,
        );
      }
    };

    ctx.save();
    ctx.globalAlpha = isHovered && !isSelected ? 0.5 : 1;

    if (bond.displayStyle === 'wavy') {
      // ChemDraw draws it as quarter waves: ceil(length in pt) of them, each a cubic from the axis
      // to a crest (or back), every one the same width, crests 1pt off the axis. Measured from the
      // vector paths of 30 bonds on 26.1.0.6801 (2026-10-13); the control points are its own.
      const length = Math.hypot(endX - startX, endY - startY);
      const points = length / convertNativeToCanvas(1, scene.documentStyleSettings);
      let quarters = Math.max(2, Math.ceil(points - 1e-6));
      // A whole number of points that would leave an odd count gets one more (3pt and 5pt bonds
      // came back with 4 and 6 quarters); 14.4pt got 15.
      if (Math.abs(points - Math.round(points)) < 1e-3 && quarters % 2 === 1) quarters += 1;
      const width = length / quarters;
      const amplitude = visual.waveAmplitude;
      const at = (along: number, across: number) => ({
        x: startX + unitX * along + -unitY * across,
        y: startY + unitY * along + unitX * across,
      });
      setStroke(ctx, color, lineWidth);
      ctx.lineCap = 'butt';
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      const first = at(0, 0);
      ctx.moveTo(first.x, first.y);
      let side = 1;
      for (let quarter = 0; quarter < quarters; quarter += 1) {
        const x = quarter * width;
        const rising = quarter % 2 === 0;
        const c1 = rising
          ? at(x, side * 0.5508 * amplitude)
          : at(x + 0.554 * width, side * amplitude);
        const c2 = rising
          ? at(x + 0.448 * width, side * amplitude)
          : at(x + width, side * 0.5508 * amplitude);
        const end = rising ? at(x + width, side * amplitude) : at(x + width, 0);
        ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
        if (!rising) side = -side;
      }
      ctx.stroke();
      ctx.restore();
      return;
    }

    if (bond.displayStyle === 'dash') {
      drawSegmentedLine(startX, startY, endX, endY, lineWidth, [6, 4]);
      ctx.restore();
      return;
    }

    if (bond.displayStyle === 'bold') {
      drawSegmentedLine(startX, startY, endX, endY, visual.boldWidth);
      ctx.restore();
      return;
    }

    if (bond.displayStyle === 'crossed') {
      const midX = (startX + endX) / 2;
      const midY = (startY + endY) / 2;
      drawSegmentedLine(startX, startY, endX, endY);
      drawLine(
        ctx,
        midX + -unitY * visual.crossHalfLength,
        midY + unitX * visual.crossHalfLength,
        midX - -unitY * visual.crossHalfLength,
        midY - unitX * visual.crossHalfLength,
        color,
        lineWidth,
      );
      ctx.restore();
      return;
    }

    if (bond.displayStyle === 'dative') {
      const angle = Math.atan2(endY - startY, endX - startX);
      const headSize = visual.dativeHeadSize;
      drawSegmentedLine(
        startX,
        startY,
        endX - Math.cos(angle) * headSize,
        endY - Math.sin(angle) * headSize,
      );
      drawLine(
        ctx,
        endX,
        endY,
        endX - headSize * Math.cos(angle - Math.PI / 7),
        endY - headSize * Math.sin(angle - Math.PI / 7),
        color,
        lineWidth,
      );
      drawLine(
        ctx,
        endX,
        endY,
        endX - headSize * Math.cos(angle + Math.PI / 7),
        endY - headSize * Math.sin(angle + Math.PI / 7),
        color,
        lineWidth,
      );
      ctx.restore();
      return;
    }

    if (bond.stereo === 1) {
      drawPolyline(
        ctx,
        [
          { x: startX, y: startY },
          { x: endX + -unitY * visual.stereoHalfWidth, y: endY + unitX * visual.stereoHalfWidth },
          { x: endX - -unitY * visual.stereoHalfWidth, y: endY - unitX * visual.stereoHalfWidth },
        ],
        color,
        lineWidth,
        { closed: true, fill: color },
      );
      ctx.restore();
      return;
    }

    if (bond.stereo === 6) {
      for (let index = 0; index <= visual.hashStepCount; index += 1) {
        const ratio = index / visual.hashStepCount;
        const px = startX + (endX - startX) * ratio;
        const py = startY + (endY - startY) * ratio;
        const width = visual.hashStartWidth + index * visual.hashStepWidth;
        const deltaX = -unitY * width;
        const deltaY = unitX * width;
        drawLine(ctx, px - deltaX, py - deltaY, px + deltaX, py + deltaY, color, lineWidth);
      }
      ctx.restore();
      return;
    }

    if (bond.order === 1) {
      drawSegmentedLine(startX, startY, endX, endY);
      ctx.restore();
      return;
    }

    if (bond.order === 1.5) {
      let sign = 1;
      const centroid = scene.legacy.ringCentroids.get(object.id);
      if (centroid) {
        const midX = (fromAtom.x + toAtom.x) / 2;
        const midY = (fromAtom.y + toAtom.y) / 2;
        if ((centroid.cx - midX) * normalX + (centroid.cy - midY) * normalY < 0) sign = -1;
      }
      drawSegmentedLine(startX, startY, endX, endY);
      drawSegmentedLine(
        startX + sign * normalX,
        startY + sign * normalY,
        endX + sign * normalX,
        endY + sign * normalY,
        lineWidth,
        [...visual.aromaticDashPattern],
      );
      ctx.restore();
      return;
    }

    if (bond.order === 2) {
      const nativeSecondaryLine =
        object.secondaryDisplay != null
          ? getOffsetBondLineGeometry({
              startX,
              startY,
              endX,
              endY,
              unitX,
              unitY,
              offsetX: normalX,
              offsetY: normalY,
              fromAtom,
              toAtom,
              startNeighborVectors: bondNeighborVectors?.from,
              endNeighborVectors: bondNeighborVectors?.to,
            })
          : null;
      if (object.secondaryDisplay === 'dash') {
        drawSegmentedLine(startX, startY, endX, endY);
        drawSegmentedLine(
          nativeSecondaryLine!.startX,
          nativeSecondaryLine!.startY,
          nativeSecondaryLine!.endX,
          nativeSecondaryLine!.endY,
          lineWidth,
          [6, 4],
        );
        ctx.restore();
        return;
      }
      if (object.secondaryDisplay === 'bold') {
        drawSegmentedLine(startX, startY, endX, endY);
        drawSegmentedLine(
          nativeSecondaryLine!.startX,
          nativeSecondaryLine!.startY,
          nativeSecondaryLine!.endX,
          nativeSecondaryLine!.endY,
        );
        ctx.restore();
        return;
      }
      const [primaryLine, secondaryLine] = getDoubleBondLineGeometry({
        startX,
        startY,
        endX,
        endY,
        unitX,
        unitY,
        normalX,
        normalY,
        mode: resolveDoubleBondMode(bond.doubleBondMode ?? object.doubleBondMode),
        visual,
        fromAtom,
        toAtom,
        ringCentroid: scene.legacy.ringCentroids.get(object.id),
        startNeighborVectors: bondNeighborVectors?.from,
        endNeighborVectors: bondNeighborVectors?.to,
      });
      drawSegmentedLine(primaryLine.startX, primaryLine.startY, primaryLine.endX, primaryLine.endY);
      drawSegmentedLine(
        secondaryLine.startX,
        secondaryLine.startY,
        secondaryLine.endX,
        secondaryLine.endY,
      );
      ctx.restore();
      return;
    }

    if (bond.order === 3) {
      const [topLine, bottomLine] = getTripleBondLineGeometry({
        startX,
        startY,
        endX,
        endY,
        unitX,
        unitY,
        normalX,
        normalY,
        visual,
        fromAtom,
        toAtom,
        startNeighborVectors: bondNeighborVectors?.from,
        endNeighborVectors: bondNeighborVectors?.to,
      });
      drawSegmentedLine(startX, startY, endX, endY);
      drawSegmentedLine(topLine.startX, topLine.startY, topLine.endX, topLine.endY);
      drawSegmentedLine(bottomLine.startX, bottomLine.startY, bottomLine.endX, bottomLine.endY);
      ctx.restore();
      return;
    }

    if (bond.order === 4) {
      // Four evenly spaced lines, the double bond's spacing apart; the outer two are trimmed at
      // the ends as a triple bond's are.
      for (const k of [-1.5, -0.5, 0.5, 1.5]) {
        const offset = k * visual.parallelOffset;
        const inset = Math.abs(k) > 1 ? visual.tripleInlineInset : 0;
        drawSegmentedLine(
          startX + normalX * offset + unitX * inset,
          startY + normalY * offset + unitY * inset,
          endX + normalX * offset - unitX * inset,
          endY + normalY * offset - unitY * inset,
        );
      }
      ctx.restore();
      return;
    }

    if (object.query?.allowedOrders?.length) {
      drawSegmentedLine(startX, startY, endX, endY, lineWidth, [5, 5]);
      ctx.font = `10px ${getPaintFontFamily(context.scene.documentStyleSettings.nativeMetrics.captionFontFamily)}`;
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const topology = object.query.ringState ? ` ${object.query.ringState}` : '';
      ctx.fillText(
        `${object.query.allowedOrders.join('/')}${topology}`,
        (startX + endX) / 2,
        (startY + endY) / 2 - 12,
      );
      ctx.restore();
      return;
    }

    drawSegmentedLine(startX, startY, endX, endY);
    ctx.restore();
  },
  hitTest(object, point, context, options) {
    if (object.type !== 'bond') return false;
    const bond = context.scene.legacy.bondById.get(object.id);
    if (!bond) return false;
    const fromAtom = context.scene.legacy.atomById.get(bond.from);
    const toAtom = context.scene.legacy.atomById.get(bond.to);
    if (!fromAtom || !toAtom) return false;
    return (
      distanceToSegment(point, { x: fromAtom.x, y: fromAtom.y }, { x: toAtom.x, y: toAtom.y }) <
      10 / options.stageScale
    );
  },
  editCapabilities: () => ['move', 'style'],
};
