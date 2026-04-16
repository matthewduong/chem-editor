import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getTextBoxDimensions,
  measureRunWidth,
  resetTextMeasurementCaches,
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
