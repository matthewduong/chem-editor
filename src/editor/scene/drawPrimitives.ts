import type { TextRun } from '../../types/chemistry';
import { getTextRunFontStyle } from '../../lib/textRunPresentation';
import { getPaintFontFamily } from '../../lib/textMetrics';

export function adaptColor(color: string, isDarkMode: boolean): string {
  if (!isDarkMode) return color;
  const normalized = color.trim().toLowerCase();
  return normalized === '#000000' || normalized === '#000' || normalized === 'black'
    ? '#ffffff'
    : color;
}

export function setStroke(
  ctx: CanvasRenderingContext2D,
  color: string,
  lineWidth: number,
  dash?: number[],
) {
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash(dash ?? []);
}

export function drawLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  lineWidth: number,
  dash?: number[],
) {
  setStroke(ctx, color, lineWidth, dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawPolyline(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  color: string,
  lineWidth: number,
  options?: { closed?: boolean; dash?: number[]; fill?: string | null },
) {
  if (points.length < 2) return;
  setStroke(ctx, color, lineWidth, options?.dash);
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  if (options?.closed) ctx.closePath();
  if (options?.fill) {
    ctx.fillStyle = options.fill;
    ctx.fill();
  }
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawCircle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  options: { stroke?: string; fill?: string; lineWidth?: number; dash?: number[]; scaleY?: number },
) {
  ctx.save();
  if (options.scaleY != null && options.scaleY !== 1) {
    ctx.translate(x, y);
    ctx.scale(1, options.scaleY);
    x = 0;
    y = 0;
  }
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  if (options.fill) {
    ctx.fillStyle = options.fill;
    ctx.fill();
  }
  if (options.stroke) {
    setStroke(ctx, options.stroke, options.lineWidth ?? 1, options.dash);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.restore();
}

export function drawRunText(
  ctx: CanvasRenderingContext2D,
  run: TextRun,
  x: number,
  y: number,
  fontSize: number,
  fontFamily: string,
  color: string,
) {
  const actualFontSize = run.sub || run.sup ? fontSize * 0.65 : fontSize;
  // Paint with the same vendored face the metrics table was generated from, and with kerning
  // off, so the painted advance equals the measured advance by construction rather than by
  // hoping a table reproduces the host text stack's kerning.
  ctx.font = `${getTextRunFontStyle(run)} ${actualFontSize}px ${getPaintFontFamily(fontFamily)}`;
  ctx.fontKerning = 'none';
  ctx.fillStyle = color;
  ctx.textBaseline = 'top';
  const yOffset = run.sup ? -fontSize * 0.18 : run.sub ? fontSize * 0.22 : 0;
  ctx.fillText(run.text, x, y + yOffset);
}
