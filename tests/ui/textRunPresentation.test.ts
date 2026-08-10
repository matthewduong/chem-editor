import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPlainTextEditableFragment,
  extractRunsFromDOM,
  getTextBoxDimensions,
  getTextBoxRenderLines,
  measureRunWidth,
  normalizePresentationTextRuns,
  resetTextMeasurementCaches,
  runsToHTML,
} from '../../src/lib/textRunPresentation';

describe('textRunPresentation caching', () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  const measureText = vi.fn((text: string) => ({ width: text.length * 10 }));

  beforeEach(() => {
    resetTextMeasurementCaches();
    measureText.mockClear();
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      writable: true,
      value: vi.fn(() => ({
        measureText,
      })),
    });
  });

  afterEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      writable: true,
      value: originalGetContext,
    });
    resetTextMeasurementCaches();
  });

  it('reuses cached run widths for identical measurements', () => {
    const run = { text: 'Conditions', bold: true } as const;

    expect(measureRunWidth(run, 12, 'Arial')).toBe(100);
    expect(measureRunWidth(run, 12, 'Arial')).toBe(100);

    expect(measureText).toHaveBeenCalledTimes(1);
  });

  it('wraps rendered lines and measured height consistently for a bounded text box', () => {
    // measureText is stubbed at 10px per character, so a 45px box fits 4 characters per line.
    const textBox = {
      id: 't1',
      x: 0,
      y: 0,
      runs: [{ text: 'aaa bbb ccc' }],
      fontSize: 10,
      fontFamily: 'Arial',
      color: '#000000',
      width: 45,
    };

    const lines = getTextBoxRenderLines(textBox);
    expect(lines.map((line) => line.map((run) => run.text).join(''))).toEqual([
      'aaa',
      'bbb',
      'ccc',
    ]);

    // The painted line count must drive the measured height, or the selection box and the
    // CDXML-imported bounding box disagree with what is actually drawn.
    expect(getTextBoxDimensions(textBox).textH).toBe(lines.length * textBox.fontSize);
  });

  it('invalidates cached text box dimensions when the text changes', () => {
    const baseTextBox = {
      id: 't1',
      x: 10,
      y: 20,
      runs: [{ text: 'A' }],
      fontSize: 14,
      fontFamily: 'Arial',
      color: '#000000',
    };

    const first = getTextBoxDimensions(baseTextBox);
    const second = getTextBoxDimensions({
      ...baseTextBox,
      runs: [{ text: 'ABCDE' }],
    });

    expect(second.textW).toBeGreaterThan(first.textW);
    expect(measureText).toHaveBeenCalledTimes(2);
  });
});

describe('textRunPresentation DOM conversion', () => {
  it('merges adjacent runs with the same presentation style', () => {
    const div = document.createElement('div');
    div.innerHTML = '<b>A</b><strong>B</strong>C';

    expect(extractRunsFromDOM(div)).toEqual([{ text: 'AB', bold: true }, { text: 'C' }]);
  });

  it('keeps explicit line breaks and block boundaries', () => {
    const div = document.createElement('div');
    div.innerHTML = 'A<div>B</div><br><br><div><i>C</i></div>';

    expect(extractRunsFromDOM(div)).toEqual([
      { text: 'A' },
      { text: '\n' },
      { text: 'B' },
      { text: '\n' },
      { text: '\n' },
      { text: 'C', italic: true },
    ]);
  });

  it('creates editable paste fragments from plain text only', () => {
    const div = document.createElement('div');
    div.appendChild(createPlainTextEditableFragment(document, 'A\r\n<B>&C'));

    expect(div.innerHTML).toBe('A<br>&lt;B&gt;&amp;C');
    expect(extractRunsFromDOM(div)).toEqual([{ text: 'A' }, { text: '\n' }, { text: '<B>&C' }]);
  });

  it('normalizes runs and drops unsafe inline colors', () => {
    expect(
      normalizePresentationTextRuns([
        { text: 'A', bold: true, color: '#123456' },
        { text: 'B', bold: true, color: '#123456' },
        { text: 'C', color: 'red";font-size:999px' },
      ]),
    ).toEqual([{ text: 'AB', bold: true, color: '#123456' }, { text: 'C' }]);

    expect(runsToHTML([{ text: '<C>', color: 'red";font-size:999px' }])).toBe('&lt;C&gt;');
  });
});
