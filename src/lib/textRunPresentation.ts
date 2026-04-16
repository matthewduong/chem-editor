import type { TextBox, TextRun } from '../types/chemistry';

let measureCtx: CanvasRenderingContext2D | null = null;
const RUN_WIDTH_CACHE = new Map<string, number>();
const TEXT_BOX_DIMENSIONS_CACHE = new Map<
  string,
  { textW: number; textH: number; cx: number; cy: number }
>();
const MAX_TEXT_METRIC_CACHE_SIZE = 10000;

function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

function bumpCache<K, V>(cache: Map<K, V>, key: K, value: V): V {
  if (cache.size >= MAX_TEXT_METRIC_CACHE_SIZE) cache.clear();
  cache.set(key, value);
  return value;
}

function buildRunWidthCacheKey(run: TextRun, fontSize: number, fontFamily: string): string {
  return [
    fontFamily,
    fontSize,
    run.text,
    run.bold ? '1' : '0',
    run.italic ? '1' : '0',
    run.sub ? '1' : '0',
    run.sup ? '1' : '0',
    run.color ?? '',
  ].join('|');
}

function buildTextBoxDimensionsCacheKey(textBox: TextBox): string {
  return [
    textBox.x,
    textBox.y,
    textBox.width ?? '',
    textBox.fontSize,
    textBox.fontFamily,
    textBox.textAlign ?? 'center',
    textBox.runs
      .map((run) =>
        [
          run.text,
          run.bold ? '1' : '0',
          run.italic ? '1' : '0',
          run.sub ? '1' : '0',
          run.sup ? '1' : '0',
          run.color ?? '',
        ].join(':'),
      )
      .join(';'),
  ].join('|');
}

export function getTextRunFontStyle(run: Pick<TextRun, 'bold' | 'italic'>): string {
  if (run.bold && run.italic) return 'bold italic';
  if (run.bold) return 'bold';
  if (run.italic) return 'italic';
  return 'normal';
}

export function measureRunWidth(run: TextRun, fontSize: number, fontFamily: string): number {
  const cacheKey = buildRunWidthCacheKey(run, fontSize, fontFamily);
  const cached = RUN_WIDTH_CACHE.get(cacheKey);
  if (cached != null) return cached;
  const fs = run.sub || run.sup ? fontSize * 0.65 : fontSize;
  const ctx = getMeasureCtx();
  ctx.font = `${getTextRunFontStyle(run)} ${fs}px ${fontFamily}`;
  return bumpCache(RUN_WIDTH_CACHE, cacheKey, ctx.measureText(run.text).width);
}

export function estimateRunWidth(run: TextRun, fontSize: number): number {
  return Math.max(run.text.length * (run.sub || run.sup ? fontSize * 0.42 : fontSize * 0.58), 1);
}

export function getTextBoxLines(runs: TextRun[]): TextRun[][] {
  const lines: TextRun[][] = [[]];
  for (const run of runs) {
    if (run.text === '\n') lines.push([]);
    else lines[lines.length - 1].push(run);
  }
  return lines;
}

export function getTextBoxDimensions(
  textBox: TextBox,
  measureWidth: (run: TextRun, fontSize: number, fontFamily: string) => number = measureRunWidth,
): { textW: number; textH: number; cx: number; cy: number } {
  const cacheKey =
    measureWidth === measureRunWidth ? buildTextBoxDimensionsCacheKey(textBox) : null;
  if (cacheKey) {
    const cached = TEXT_BOX_DIMENSIONS_CACHE.get(cacheKey);
    if (cached) return cached;
  }
  const lines = getTextBoxLines(textBox.runs);
  const lineWidths = lines.map((line) =>
    line.reduce((sum, run) => sum + measureWidth(run, textBox.fontSize, textBox.fontFamily), 0),
  );
  const intrinsicW = Math.max(40, ...lineWidths);
  const textW = Math.max(textBox.width ?? 0, intrinsicW);
  const textH = lines.length * textBox.fontSize;
  const align = textBox.textAlign ?? 'center';
  const startX =
    align === 'center' ? textBox.x - textW / 2 : align === 'right' ? textBox.x - textW : textBox.x;
  const dimensions = { textW, textH, cx: startX + textW / 2, cy: textBox.y + textH / 2 };
  return cacheKey ? bumpCache(TEXT_BOX_DIMENSIONS_CACHE, cacheKey, dimensions) : dimensions;
}

export function runsToHTML(runs: TextRun[]): string {
  return runs
    .map((run) => {
      if (run.text === '\n') return '<br>';
      let html = run.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (run.color) html = `<span style="color:${run.color}">${html}</span>`;
      if (run.sub) html = `<sub>${html}</sub>`;
      if (run.sup) html = `<sup>${html}</sup>`;
      if (run.bold) html = `<b>${html}</b>`;
      if (run.italic) html = `<i>${html}</i>`;
      return html;
    })
    .join('');
}

const BLOCK_TAGS = new Set(['div', 'p', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export function extractRunsFromDOM(div: HTMLDivElement): TextRun[] {
  const runs: TextRun[] = [];

  function getStyle(node: Node) {
    let bold = false;
    let italic = false;
    let sub = false;
    let sup = false;
    let color: string | undefined;
    let el: Node | null = node.parentNode;
    while (el && el !== div) {
      const tag = (el as Element).tagName?.toLowerCase();
      if (tag === 'b' || tag === 'strong') bold = true;
      if (tag === 'i' || tag === 'em') italic = true;
      if (tag === 'sub') sub = true;
      if (tag === 'sup') sup = true;
      const styleColor = (el as HTMLElement).style?.color;
      if (styleColor && !color) color = styleColor;
      el = el.parentNode;
    }
    return { bold, italic, sub, sup, color };
  }

  function addBreak() {
    if (runs.length > 0 && runs[runs.length - 1].text !== '\n') runs.push({ text: '\n' });
  }

  function walk(node: Node, isFirstChild: boolean): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (!text) return;
      const style = getStyle(node);
      runs.push({
        text,
        ...(style.bold ? { bold: true } : {}),
        ...(style.italic ? { italic: true } : {}),
        ...(style.sub ? { sub: true } : {}),
        ...(style.sup ? { sup: true } : {}),
        ...(style.color ? { color: style.color } : {}),
      });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      addBreak();
      return;
    }
    if (BLOCK_TAGS.has(tag) && !isFirstChild) addBreak();
    let firstChild = true;
    for (const child of Array.from(el.childNodes)) {
      walk(child, firstChild);
      firstChild = false;
    }
  }

  let first = true;
  for (const child of Array.from(div.childNodes)) {
    walk(child, first);
    first = false;
  }
  while (runs.length > 0 && runs[runs.length - 1].text === '\n') runs.pop();
  return runs.filter((run) => run.text !== '');
}

export function resetTextMeasurementCaches() {
  RUN_WIDTH_CACHE.clear();
  TEXT_BOX_DIMENSIONS_CACHE.clear();
}
