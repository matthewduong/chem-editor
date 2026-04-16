import {
  estimateRunWidth,
  getTextBoxDimensions,
  getTextBoxLines,
  measureRunWidth,
} from '../../../lib/textRunPresentation';
import { adaptColor, drawRunText } from '../drawPrimitives';
import type { ObjectModule } from '../types';

export const TEXT_MODULE: ObjectModule = {
  type: 'text',
  draw(object, context) {
    if (object.type !== 'text') return;
    const { scene, ctx } = context;
    const textBox = scene.legacy.textBoxById.get(object.id);
    if (!textBox) return;
    const isSelected = scene.selectedTextBoxIds.has(object.id);
    const isHovered = scene.hoveredTextBoxId === object.id;
    const isEditing = scene.editingTextBoxId === object.id;
    if (isEditing) return;
    const lines = getTextBoxLines(textBox.runs);
    const { textW, textH, cx, cy } = getTextBoxDimensions(textBox);
    const align = textBox.textAlign ?? 'center';
    ctx.save();
    ctx.translate(cx, cy);
    if (textBox.rotation) ctx.rotate((textBox.rotation * Math.PI) / 180);

    if (isSelected || isHovered) {
      const pad = textBox.fontSize * 0.25;
      ctx.save();
      ctx.strokeStyle = '#2196F3';
      ctx.globalAlpha = isSelected ? 1 : 0.45;
      ctx.lineWidth = 0.4;
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(-textW / 2 - pad, -textH / 2 - pad, textW + pad * 2, textH + pad * 2);
      ctx.restore();
    }

    lines.forEach((lineRuns, lineIndex) => {
      const lineWidth = lineRuns.reduce(
        (sum, run) => sum + measureRunWidth(run, textBox.fontSize, textBox.fontFamily),
        0,
      );
      const lineStartX =
        align === 'center'
          ? -lineWidth / 2
          : align === 'right'
            ? textW / 2 - lineWidth
            : -textW / 2;
      let cursorX = lineStartX;
      const lineY = -textH / 2 + lineIndex * textBox.fontSize;
      lineRuns.forEach((run) => {
        drawRunText(
          ctx,
          run,
          cursorX,
          lineY,
          textBox.fontSize,
          textBox.fontFamily,
          isSelected ? '#2196F3' : adaptColor(run.color || textBox.color, scene.isDarkMode),
        );
        cursorX += measureRunWidth(run, textBox.fontSize, textBox.fontFamily);
      });
    });
    ctx.restore();
  },
  hitTest(object, point, context) {
    if (object.type !== 'text') return false;
    const textBox = context.scene.legacy.textBoxById.get(object.id);
    if (!textBox) return false;
    const { textW, textH, cx, cy } = getTextBoxDimensions(textBox, (run, fontSize) =>
      estimateRunWidth(run, fontSize),
    );
    const rot = -(((textBox.rotation ?? 0) * Math.PI) / 180);
    const dx = point.x - cx;
    const dy = point.y - cy;
    const localX = dx * Math.cos(rot) - dy * Math.sin(rot);
    const localY = dx * Math.sin(rot) + dy * Math.cos(rot);
    return (
      localX >= -textW / 2 - 4 &&
      localX <= textW / 2 + 4 &&
      localY >= -textH / 2 - 4 &&
      localY <= textH / 2 + 4
    );
  },
  editCapabilities: () => ['move', 'style', 'content'],
};
