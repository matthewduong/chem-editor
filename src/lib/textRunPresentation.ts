import type { TextBox, TextRun } from '../types/chemistry';
import { measureText } from './textMetrics';

const RUN_WIDTH_CACHE = new Map<string, number>();
const TEXT_BOX_DIMENSIONS_CACHE = new Map<
  string,
  { textW: number; textH: number; cx: number; cy: number }
>();
const MAX_TEXT_METRIC_CACHE_SIZE = 10000;

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

function sanitizeInlineColor(color: string | undefined): string | undefined {
  const normalized = color?.trim();
  if (!normalized || /[;"'<>]/.test(normalized)) return undefined;
  if (typeof CSS !== 'undefined' && CSS.supports && !CSS.supports('color', normalized)) {
    return undefined;
  }
  return normalized;
}

function escapeHTML(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function samePresentationStyle(left: TextRun, right: TextRun): boolean {
  return (
    Boolean(left.bold) === Boolean(right.bold) &&
    Boolean(left.italic) === Boolean(right.italic) &&
    Boolean(left.sub) === Boolean(right.sub) &&
    Boolean(left.sup) === Boolean(right.sup) &&
    sanitizeInlineColor(left.color) === sanitizeInlineColor(right.color)
  );
}

export function normalizePresentationTextRuns(runs: TextRun[]): TextRun[] {
  const normalized: TextRun[] = [];
  for (const run of runs) {
    if (run.text === '') continue;
    const color = sanitizeInlineColor(run.color);
    const next: TextRun = {
      text: run.text,
      ...(run.bold ? { bold: true } : {}),
      ...(run.italic ? { italic: true } : {}),
      ...(run.sub ? { sub: true } : {}),
      ...(run.sup ? { sup: true } : {}),
      ...(color ? { color } : {}),
    };
    const previous = normalized[normalized.length - 1];
    if (
      previous &&
      previous.text !== '\n' &&
      next.text !== '\n' &&
      samePresentationStyle(previous, next)
    ) {
      previous.text += next.text;
      continue;
    }
    normalized.push(next);
  }
  return normalized;
}

export function getTextRunFontStyle(run: Pick<TextRun, 'bold' | 'italic'>): string {
  if (run.bold && run.italic) return 'bold italic';
  if (run.bold) return 'bold';
  if (run.italic) return 'italic';
  return 'normal';
}

/** Point size a run is actually set at: sub/sup are drawn at 65% of the base size. */
export function getRunFontSize(run: Pick<TextRun, 'sub' | 'sup'>, fontSize: number): number {
  return run.sub || run.sup ? fontSize * 0.65 : fontSize;
}

/**
 * Measures a run against the vendored font metrics.
 *
 * This used to measure through a DOM canvas, which made the entire draw path unreachable from
 * `node --test` and forced a second, cruder estimator for the DOM-free callers. Both are now the
 * same computation, so hit testing, bounds, canvas rendering and SVG export can no longer
 * disagree about how wide a label is.
 */
export function measureRunWidth(run: TextRun, fontSize: number, fontFamily: string): number {
  const cacheKey = buildRunWidthCacheKey(run, fontSize, fontFamily);
  const cached = RUN_WIDTH_CACHE.get(cacheKey);
  if (cached != null) return cached;
  const width = measureText(run.text, {
    family: fontFamily,
    sizePx: getRunFontSize(run, fontSize),
    bold: run.bold,
    italic: run.italic,
  }).advance;
  return bumpCache(RUN_WIDTH_CACHE, cacheKey, width);
}

export type TextRunMeasure = (run: TextRun, fontSize: number, fontFamily: string) => number;

function trimLineTrailingWhitespace(line: TextRun[]): TextRun[] {
  const trimmed = line.map((run) => ({ ...run }));
  while (trimmed.length > 0) {
    const last = trimmed[trimmed.length - 1];
    const nextText = last.text.replace(/\s+$/g, '');
    if (nextText) {
      last.text = nextText;
      break;
    }
    trimmed.pop();
  }
  return trimmed;
}

function appendLineRun(line: TextRun[], run: TextRun): void {
  const previous = line[line.length - 1];
  if (previous && samePresentationStyle(previous, run)) {
    previous.text += run.text;
    return;
  }
  line.push({ ...run });
}

function splitWrapChunks(text: string): string[] {
  return text.match(/\S+\s*|\s+/g) ?? [];
}

function appendWrappedChunk(
  lines: TextRun[][],
  currentLine: TextRun[],
  run: TextRun,
  chunk: string,
  maxWidth: number,
  fontSize: number,
  fontFamily: string,
  measureWidth: TextRunMeasure,
): { line: TextRun[]; width: number } {
  let line = currentLine;
  let lineWidth = line.reduce(
    (sum, lineRun) => sum + measureWidth(lineRun, fontSize, fontFamily),
    0,
  );

  const pushLine = () => {
    lines.push(trimLineTrailingWhitespace(line));
    line = [];
    lineWidth = 0;
  };

  const appendChunk = (text: string) => {
    if (!text || (line.length === 0 && /^\s+$/.test(text))) return;
    const nextRun = { ...run, text };
    appendLineRun(line, nextRun);
    lineWidth += measureWidth(nextRun, fontSize, fontFamily);
  };

  const chunkRun = { ...run, text: chunk };
  const chunkWidth = measureWidth(chunkRun, fontSize, fontFamily);
  if (line.length > 0 && lineWidth + chunkWidth > maxWidth) {
    pushLine();
  }

  if (chunkWidth <= maxWidth || /^\s+$/.test(chunk)) {
    appendChunk(line.length === 0 ? chunk.replace(/^\s+/g, '') : chunk);
    return { line, width: lineWidth };
  }

  for (const char of Array.from(chunk)) {
    const charRun = { ...run, text: char };
    const charWidth = measureWidth(charRun, fontSize, fontFamily);
    if (line.length > 0 && lineWidth + charWidth > maxWidth) {
      pushLine();
    }
    appendChunk(line.length === 0 ? char.replace(/^\s+/g, '') : char);
  }

  return { line, width: lineWidth };
}

export function getTextBoxLines(
  runs: TextRun[],
  options: {
    maxWidth?: number;
    fontSize?: number;
    fontFamily?: string;
    measureWidth?: TextRunMeasure;
  } = {},
): TextRun[][] {
  const { maxWidth, fontSize, fontFamily, measureWidth = measureRunWidth } = options;
  const lines: TextRun[][] = [[]];
  const shouldWrap = Boolean(maxWidth && maxWidth > 0 && fontSize && fontFamily);
  if (shouldWrap) lines.pop();

  let currentLine: TextRun[] = [];
  const pushCurrentLine = () => {
    lines.push(shouldWrap ? trimLineTrailingWhitespace(currentLine) : currentLine);
    currentLine = [];
  };

  for (const run of runs) {
    if (run.text === '\n') {
      if (shouldWrap) pushCurrentLine();
      else lines.push([]);
      continue;
    }
    if (!shouldWrap) {
      lines[lines.length - 1].push(run);
      continue;
    }
    const textParts = run.text.split('\n');
    textParts.forEach((part, partIndex) => {
      if (partIndex > 0) pushCurrentLine();
      for (const chunk of splitWrapChunks(part)) {
        currentLine = appendWrappedChunk(
          lines,
          currentLine,
          run,
          chunk,
          maxWidth!,
          fontSize!,
          fontFamily!,
          measureWidth,
        ).line;
      }
    });
  }
  if (shouldWrap) pushCurrentLine();
  return lines.length > 0 ? lines : [[]];
}

/**
 * Wrap-aware line breaking for a text box.
 *
 * Every renderer must go through this rather than calling `getTextBoxLines` directly, so that
 * the lines that get painted are the same lines `getTextBoxDimensions` measured. Pass the same
 * `measureWidth` to both for a given call site: CDXML import sets `width` from `<t BoundingBox>`,
 * so mismatched measurement functions produce different line counts and a bounding box that
 * disagrees with the painted text.
 */
export function getTextBoxRenderLines(
  textBox: TextBox,
  measureWidth: TextRunMeasure = measureRunWidth,
): TextRun[][] {
  return getTextBoxLines(textBox.runs, {
    maxWidth: textBox.width,
    fontSize: textBox.fontSize,
    fontFamily: textBox.fontFamily,
    measureWidth,
  });
}

export function getTextBoxDimensions(
  textBox: TextBox,
  measureWidth: TextRunMeasure = measureRunWidth,
): { textW: number; textH: number; cx: number; cy: number } {
  const cacheKey =
    measureWidth === measureRunWidth ? buildTextBoxDimensionsCacheKey(textBox) : null;
  if (cacheKey) {
    const cached = TEXT_BOX_DIMENSIONS_CACHE.get(cacheKey);
    if (cached) return cached;
  }
  const lines = getTextBoxRenderLines(textBox, measureWidth);
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
      let html = escapeHTML(run.text);
      const color = sanitizeInlineColor(run.color);
      if (color) html = `<span style="color:${color}">${html}</span>`;
      if (run.sub) html = `<sub>${html}</sub>`;
      if (run.sup) html = `<sup>${html}</sup>`;
      if (run.bold) html = `<b>${html}</b>`;
      if (run.italic) html = `<i>${html}</i>`;
      return html;
    })
    .join('');
}

const BLOCK_TAGS = new Set(['div', 'p', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

export function createPlainTextEditableFragment(
  ownerDocument: Document,
  text: string,
): DocumentFragment {
  const fragment = ownerDocument.createDocumentFragment();
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  for (const [index, line] of lines.entries()) {
    if (index > 0) fragment.appendChild(ownerDocument.createElement('br'));
    if (line) fragment.appendChild(ownerDocument.createTextNode(line));
  }
  return fragment;
}

export function insertPlainTextIntoEditable(root: HTMLElement, text: string): void {
  const selection = root.ownerDocument.getSelection?.() ?? window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    root.appendChild(createPlainTextEditableFragment(root.ownerDocument, text));
    return;
  }

  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    root.appendChild(createPlainTextEditableFragment(root.ownerDocument, text));
    return;
  }

  range.deleteContents();
  const fragment = createPlainTextEditableFragment(root.ownerDocument, text);
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);
  if (lastNode) {
    range.setStartAfter(lastNode);
  }
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
}

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
      const styleColor = sanitizeInlineColor((el as HTMLElement).style?.color);
      if (styleColor && !color) color = styleColor;
      el = el.parentNode;
    }
    return { bold, italic, sub, sup, color };
  }

  function addBreak(options: { preserveConsecutive?: boolean } = {}) {
    if (runs.length > 0 && (options.preserveConsecutive || runs[runs.length - 1].text !== '\n')) {
      runs.push({ text: '\n' });
    }
  }

  function addText(text: string, style: ReturnType<typeof getStyle>) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    for (const [index, line] of lines.entries()) {
      if (index > 0) addBreak({ preserveConsecutive: true });
      if (!line) continue;
      runs.push({
        text: line,
        ...(style.bold ? { bold: true } : {}),
        ...(style.italic ? { italic: true } : {}),
        ...(style.sub ? { sub: true } : {}),
        ...(style.sup ? { sup: true } : {}),
        ...(style.color ? { color: style.color } : {}),
      });
    }
  }

  function walk(node: Node, isFirstChild: boolean): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (!text) return;
      addText(text, getStyle(node));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      addBreak({ preserveConsecutive: true });
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
  return normalizePresentationTextRuns(runs);
}

export function resetTextMeasurementCaches() {
  RUN_WIDTH_CACHE.clear();
  TEXT_BOX_DIMENSIONS_CACHE.clear();
}
