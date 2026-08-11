import { measureText } from './textMetrics';

/**
 * A CanvasRenderingContext2D-shaped object that emits SVG.
 *
 * The scene modules draw onto a 2D context. Rather than rewriting all ten of them against a new
 * abstraction, this implements the context surface they actually use, so `renderDocumentScene`
 * can paint into SVG with no module changes at all. Screen, PNG and SVG then come from one draw
 * path by construction rather than from three hand-maintained implementations.
 *
 * The surface is closed and known: `scripts/lib/recording-canvas.mjs` enumerates it, and reading
 * an unmodelled member there throws, so a module reaching for something new fails the suite
 * instead of silently producing different output here.
 */

interface Matrix {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const IDENTITY: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function multiply(m: Matrix, n: Matrix): Matrix {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

function applyMatrix(m: Matrix, x: number, y: number): [number, number] {
  return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
}

/** Uniform scale factor of a matrix, used to keep stroke widths visually correct. */
function matrixScale(m: Matrix): number {
  return Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
}

interface GraphicsState {
  transform: Matrix;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  lineDash: number[];
  globalAlpha: number;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fontKerning: string;
  shadowColor: string;
  shadowBlur: number;
  shadowOffsetX: number;
  shadowOffsetY: number;
}

function initialState(): GraphicsState {
  return {
    transform: { ...IDENTITY },
    strokeStyle: '#000000',
    fillStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    lineDash: [],
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fontKerning: 'auto',
    shadowColor: 'rgba(0,0,0,0)',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function num(value: number): string {
  // Four decimals matches the golden recorder's rounding and keeps output compact.
  return Number.isFinite(value) ? String(Math.round(value * 1e4) / 1e4) : '0';
}

interface ParsedFont {
  sizePx: number;
  bold: boolean;
  italic: boolean;
  family: string;
}

/** Parses the CSS font shorthand the scene modules assign, e.g. `bold italic 11px 'X', sans-serif`. */
export function parseCanvasFont(font: string): ParsedFont {
  const bold = /(^|\s)bold(\s|$)/.test(font);
  const italic = /(^|\s)italic(\s|$)/.test(font);
  const sizeMatch = /(\d+(?:\.\d+)?)px/.exec(font);
  const sizePx = sizeMatch ? Number(sizeMatch[1]) : 10;
  const familyMatch = sizeMatch ? font.slice(font.indexOf(sizeMatch[0]) + sizeMatch[0].length) : '';
  return { sizePx, bold, italic, family: familyMatch.trim() || 'sans-serif' };
}

export interface SvgCanvasOptions {
  width: number;
  height: number;
  /** Emitted as a full-canvas rect before any drawing. Omit for a transparent export. */
  background?: string | null;
}

export class SvgCanvasContext {
  private state: GraphicsState = initialState();
  private stack: GraphicsState[] = [];
  private parts: string[] = [];
  private path: string[] = [];
  private pathStart: [number, number] | null = null;
  private pathCursor: [number, number] | null = null;
  private defs: string[] = [];
  private shadowSeq = 0;

  constructor(private readonly options: SvgCanvasOptions) {}

  // ── state ────────────────────────────────────────────────────────────────
  save(): void {
    this.stack.push({ ...this.state, transform: { ...this.state.transform } });
  }

  restore(): void {
    const previous = this.stack.pop();
    if (previous) this.state = previous;
  }

  translate(x: number, y: number): void {
    this.state.transform = multiply(this.state.transform, { a: 1, b: 0, c: 0, d: 1, e: x, f: y });
  }

  scale(sx: number, sy: number): void {
    this.state.transform = multiply(this.state.transform, {
      a: sx,
      b: 0,
      c: 0,
      d: sy,
      e: 0,
      f: 0,
    });
  }

  rotate(radians: number): void {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    this.state.transform = multiply(this.state.transform, {
      a: cos,
      b: sin,
      c: -sin,
      d: cos,
      e: 0,
      f: 0,
    });
  }

  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.state.transform = { a, b, c, d, e, f };
  }

  setLineDash(dash: number[]): void {
    this.state.lineDash = [...dash];
  }

  getLineDash(): number[] {
    return [...this.state.lineDash];
  }

  // Style properties are plain fields on the state object.
  get strokeStyle() {
    return this.state.strokeStyle;
  }
  set strokeStyle(value: string) {
    this.state.strokeStyle = value;
  }
  get fillStyle() {
    return this.state.fillStyle;
  }
  set fillStyle(value: string) {
    this.state.fillStyle = value;
  }
  get lineWidth() {
    return this.state.lineWidth;
  }
  set lineWidth(value: number) {
    this.state.lineWidth = value;
  }
  get lineCap() {
    return this.state.lineCap;
  }
  set lineCap(value: CanvasLineCap) {
    this.state.lineCap = value;
  }
  get lineJoin() {
    return this.state.lineJoin;
  }
  set lineJoin(value: CanvasLineJoin) {
    this.state.lineJoin = value;
  }
  get globalAlpha() {
    return this.state.globalAlpha;
  }
  set globalAlpha(value: number) {
    this.state.globalAlpha = value;
  }
  get font() {
    return this.state.font;
  }
  set font(value: string) {
    this.state.font = value;
  }
  get textAlign() {
    return this.state.textAlign;
  }
  set textAlign(value: CanvasTextAlign) {
    this.state.textAlign = value;
  }
  get textBaseline() {
    return this.state.textBaseline;
  }
  set textBaseline(value: CanvasTextBaseline) {
    this.state.textBaseline = value;
  }
  get fontKerning() {
    return this.state.fontKerning;
  }
  set fontKerning(value: string) {
    this.state.fontKerning = value;
  }
  get shadowColor() {
    return this.state.shadowColor;
  }
  set shadowColor(value: string) {
    this.state.shadowColor = value;
  }
  get shadowBlur() {
    return this.state.shadowBlur;
  }
  set shadowBlur(value: number) {
    this.state.shadowBlur = value;
  }
  get shadowOffsetX() {
    return this.state.shadowOffsetX;
  }
  set shadowOffsetX(value: number) {
    this.state.shadowOffsetX = value;
  }
  get shadowOffsetY() {
    return this.state.shadowOffsetY;
  }
  set shadowOffsetY(value: number) {
    this.state.shadowOffsetY = value;
  }

  // ── path building ────────────────────────────────────────────────────────
  // Points are transformed as they are added, so the emitted SVG is flat: no nested transform
  // groups to keep in sync with the canvas state stack.
  beginPath(): void {
    this.path = [];
    this.pathStart = null;
    this.pathCursor = null;
  }

  moveTo(x: number, y: number): void {
    const point = applyMatrix(this.state.transform, x, y);
    this.path.push(`M${num(point[0])} ${num(point[1])}`);
    this.pathStart = point;
    this.pathCursor = point;
  }

  lineTo(x: number, y: number): void {
    const point = applyMatrix(this.state.transform, x, y);
    if (!this.pathCursor) {
      this.moveTo(x, y);
      return;
    }
    this.path.push(`L${num(point[0])} ${num(point[1])}`);
    this.pathCursor = point;
  }

  quadraticCurveTo(cx: number, cy: number, x: number, y: number): void {
    const control = applyMatrix(this.state.transform, cx, cy);
    const point = applyMatrix(this.state.transform, x, y);
    this.path.push(`Q${num(control[0])} ${num(control[1])} ${num(point[0])} ${num(point[1])}`);
    this.pathCursor = point;
  }

  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
    const c1 = applyMatrix(this.state.transform, c1x, c1y);
    const c2 = applyMatrix(this.state.transform, c2x, c2y);
    const point = applyMatrix(this.state.transform, x, y);
    this.path.push(
      `C${num(c1[0])} ${num(c1[1])} ${num(c2[0])} ${num(c2[1])} ${num(point[0])} ${num(point[1])}`,
    );
    this.pathCursor = point;
  }

  /**
   * Canvas `arcTo` draws the rounded corner between two tangent lines. Rather than reimplement
   * that geometry, approximate it the way the modules use it: as a corner rounding on a
   * rectangle path.
   */
  arcTo(x1: number, y1: number, x2: number, y2: number, radius: number): void {
    if (!this.pathCursor) {
      this.moveTo(x1, y1);
      return;
    }
    const scale = matrixScale(this.state.transform);
    const corner = applyMatrix(this.state.transform, x1, y1);
    const end = applyMatrix(this.state.transform, x2, y2);
    const r = Math.abs(radius) * scale;

    // Trim back along the incoming edge to where the arc starts.
    const [cx, cy] = this.pathCursor;
    const inLen = Math.hypot(corner[0] - cx, corner[1] - cy) || 1;
    const t = Math.max(0, 1 - Math.min(r, inLen) / inLen);
    const arcStart: [number, number] = [cx + (corner[0] - cx) * t, cy + (corner[1] - cy) * t];
    const outLen = Math.hypot(end[0] - corner[0], end[1] - corner[1]) || 1;
    const u = Math.min(r, outLen) / outLen;
    const arcEnd: [number, number] = [
      corner[0] + (end[0] - corner[0]) * u,
      corner[1] + (end[1] - corner[1]) * u,
    ];

    this.path.push(`L${num(arcStart[0])} ${num(arcStart[1])}`);
    if (r > 0) {
      // Sweep direction from the cross product of the two edge vectors.
      const cross =
        (corner[0] - cx) * (end[1] - corner[1]) - (corner[1] - cy) * (end[0] - corner[0]);
      this.path.push(
        `A${num(r)} ${num(r)} 0 0 ${cross > 0 ? 1 : 0} ${num(arcEnd[0])} ${num(arcEnd[1])}`,
      );
    }
    this.pathCursor = arcEnd;
  }

  arc(cx: number, cy: number, radius: number, start: number, end: number, ccw = false): void {
    const scale = matrixScale(this.state.transform);
    const r = radius * scale;
    const sweep = Math.abs(end - start);
    const from = applyMatrix(
      this.state.transform,
      cx + radius * Math.cos(start),
      cy + radius * Math.sin(start),
    );
    const to = applyMatrix(
      this.state.transform,
      cx + radius * Math.cos(end),
      cy + radius * Math.sin(end),
    );

    if (this.pathCursor) this.path.push(`L${num(from[0])} ${num(from[1])}`);
    else {
      this.path.push(`M${num(from[0])} ${num(from[1])}`);
      this.pathStart = from;
    }

    if (sweep >= Math.PI * 2 - 1e-9) {
      // A full circle cannot be expressed as one arc segment; use two half arcs.
      const opposite = applyMatrix(
        this.state.transform,
        cx - radius * Math.cos(start),
        cy - radius * Math.sin(start),
      );
      this.path.push(`A${num(r)} ${num(r)} 0 1 1 ${num(opposite[0])} ${num(opposite[1])}`);
      this.path.push(`A${num(r)} ${num(r)} 0 1 1 ${num(from[0])} ${num(from[1])}`);
      this.pathCursor = from;
      return;
    }

    const largeArc = sweep > Math.PI ? 1 : 0;
    this.path.push(`A${num(r)} ${num(r)} 0 ${largeArc} ${ccw ? 0 : 1} ${num(to[0])} ${num(to[1])}`);
    this.pathCursor = to;
  }

  ellipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    rotation: number,
    start: number,
    end: number,
    ccw = false,
  ): void {
    const scale = matrixScale(this.state.transform);
    const center = applyMatrix(this.state.transform, cx, cy);
    const sweep = Math.abs(end - start);
    const rotationDeg = (rotation * 180) / Math.PI;
    const point = (angle: number): [number, number] => {
      const px = rx * Math.cos(angle);
      const py = ry * Math.sin(angle);
      return [
        center[0] + (px * Math.cos(rotation) - py * Math.sin(rotation)) * scale,
        center[1] + (px * Math.sin(rotation) + py * Math.cos(rotation)) * scale,
      ];
    };
    const from = point(start);
    if (this.pathCursor) this.path.push(`L${num(from[0])} ${num(from[1])}`);
    else {
      this.path.push(`M${num(from[0])} ${num(from[1])}`);
      this.pathStart = from;
    }

    const rxs = rx * scale;
    const rys = ry * scale;
    if (sweep >= Math.PI * 2 - 1e-9) {
      const opposite = point(start + Math.PI);
      this.path.push(
        `A${num(rxs)} ${num(rys)} ${num(rotationDeg)} 1 1 ${num(opposite[0])} ${num(opposite[1])}`,
      );
      this.path.push(
        `A${num(rxs)} ${num(rys)} ${num(rotationDeg)} 1 1 ${num(from[0])} ${num(from[1])}`,
      );
      this.pathCursor = from;
      return;
    }
    const to = point(end);
    this.path.push(
      `A${num(rxs)} ${num(rys)} ${num(rotationDeg)} ${sweep > Math.PI ? 1 : 0} ${
        ccw ? 0 : 1
      } ${num(to[0])} ${num(to[1])}`,
    );
    this.pathCursor = to;
  }

  closePath(): void {
    if (this.path.length === 0) return;
    this.path.push('Z');
    this.pathCursor = this.pathStart;
  }

  // ── painting ─────────────────────────────────────────────────────────────
  private strokeAttrs(): string {
    const scale = matrixScale(this.state.transform);
    const width = this.state.lineWidth * scale;
    let attrs = ` stroke="${escapeXml(this.state.strokeStyle)}" stroke-width="${num(width)}"`;
    if (this.state.lineCap !== 'butt') attrs += ` stroke-linecap="${this.state.lineCap}"`;
    if (this.state.lineJoin !== 'miter') attrs += ` stroke-linejoin="${this.state.lineJoin}"`;
    if (this.state.lineDash.length > 0) {
      attrs += ` stroke-dasharray="${this.state.lineDash.map((v) => num(v * scale)).join(' ')}"`;
    }
    if (this.state.globalAlpha < 1) attrs += ` stroke-opacity="${num(this.state.globalAlpha)}"`;
    return attrs;
  }

  private fillAttrs(): string {
    let attrs = ` fill="${escapeXml(this.state.fillStyle)}"`;
    if (this.state.globalAlpha < 1) attrs += ` fill-opacity="${num(this.state.globalAlpha)}"`;
    return attrs;
  }

  /** Emits a drop-shadow filter when one is active, returning the filter attribute to apply. */
  private shadowAttr(): string {
    const { shadowBlur, shadowOffsetX, shadowOffsetY, shadowColor } = this.state;
    if (shadowBlur === 0 && shadowOffsetX === 0 && shadowOffsetY === 0) return '';
    if (!shadowColor || shadowColor === 'transparent') return '';
    const scale = matrixScale(this.state.transform);
    const id = `shadow${this.shadowSeq++}`;
    this.defs.push(
      `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">` +
        `<feDropShadow dx="${num(shadowOffsetX * scale)}" dy="${num(shadowOffsetY * scale)}" ` +
        `stdDeviation="${num((shadowBlur * scale) / 2)}" flood-color="${escapeXml(shadowColor)}"/>` +
        `</filter>`,
    );
    return ` filter="url(#${id})"`;
  }

  stroke(): void {
    if (this.path.length === 0) return;
    this.parts.push(
      `<path d="${this.path.join('')}" fill="none"${this.strokeAttrs()}${this.shadowAttr()}/>`,
    );
  }

  fill(): void {
    if (this.path.length === 0) return;
    this.parts.push(
      `<path d="${this.path.join('')}"${this.fillAttrs()} stroke="none"${this.shadowAttr()}/>`,
    );
  }

  private rectPath(x: number, y: number, w: number, h: number): string {
    const corners: Array<[number, number]> = [
      applyMatrix(this.state.transform, x, y),
      applyMatrix(this.state.transform, x + w, y),
      applyMatrix(this.state.transform, x + w, y + h),
      applyMatrix(this.state.transform, x, y + h),
    ];
    return `M${corners
      .map(([px, py], index) => `${index === 0 ? '' : 'L'}${num(px)} ${num(py)}`)
      .join('')}Z`;
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    this.parts.push(
      `<path d="${this.rectPath(x, y, w, h)}"${this.fillAttrs()} stroke="none"${this.shadowAttr()}/>`,
    );
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    this.parts.push(
      `<path d="${this.rectPath(x, y, w, h)}" fill="none"${this.strokeAttrs()}${this.shadowAttr()}/>`,
    );
  }

  clearRect(): void {
    // Export starts from a blank surface, so a clear has nothing to undo.
  }

  fillText(text: string, x: number, y: number): void {
    if (!text) return;
    const font = parseCanvasFont(this.state.font);
    const metrics = measureText(text, {
      family: font.family,
      sizePx: font.sizePx,
      bold: font.bold,
      italic: font.italic,
    });

    // Resolve alignment and baseline into an explicit pen origin rather than relying on SVG's
    // text-anchor/dominant-baseline, whose support varies between renderers.
    let penX = x;
    if (this.state.textAlign === 'center') penX -= metrics.advance / 2;
    else if (this.state.textAlign === 'right' || this.state.textAlign === 'end') {
      penX -= metrics.advance;
    }

    let baselineY = y;
    switch (this.state.textBaseline) {
      case 'top':
      case 'hanging':
        baselineY = y + metrics.ascent;
        break;
      case 'middle':
        baselineY = y + metrics.capHeight / 2;
        break;
      case 'bottom':
      case 'ideographic':
        baselineY = y - metrics.descent;
        break;
      default:
        break;
    }

    const [px, py] = applyMatrix(this.state.transform, penX, baselineY);
    const scale = matrixScale(this.state.transform);
    let attrs = `x="${num(px)}" y="${num(py)}"`;
    attrs += ` font-family="${escapeXml(font.family)}"`;
    attrs += ` font-size="${num(font.sizePx * scale)}"`;
    if (font.bold) attrs += ' font-weight="bold"';
    if (font.italic) attrs += ' font-style="italic"';
    attrs += ` fill="${escapeXml(this.state.fillStyle)}"`;
    if (this.state.globalAlpha < 1) attrs += ` fill-opacity="${num(this.state.globalAlpha)}"`;
    // Kerning is disabled on the canvas side so painted and measured advances agree; keep SVG
    // consistent with that.
    attrs += ' style="font-kerning:none"';
    this.parts.push(`<text ${attrs}>${escapeXml(text)}</text>`);
  }

  drawImage(image: { src?: string }, x: number, y: number, w: number, h: number): void {
    const href = typeof image?.src === 'string' ? image.src : '';
    if (!href) return;
    const [px, py] = applyMatrix(this.state.transform, x, y);
    const scale = matrixScale(this.state.transform);
    this.parts.push(
      `<image href="${escapeXml(href)}" x="${num(px)}" y="${num(py)}" ` +
        `width="${num(w * scale)}" height="${num(h * scale)}" preserveAspectRatio="none"/>`,
    );
  }

  /** Serializes everything drawn so far into a standalone SVG document. */
  toSVG(): string {
    const { width, height, background } = this.options;
    const defs = this.defs.length > 0 ? `<defs>${this.defs.join('')}</defs>` : '';
    const bg = background
      ? `<rect width="${num(width)}" height="${num(height)}" fill="${escapeXml(background)}"/>`
      : '';
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="${num(width)}" height="${num(height)}" ` +
      `viewBox="0 0 ${num(width)} ${num(height)}">${defs}${bg}${this.parts.join('')}</svg>`
    );
  }
}
