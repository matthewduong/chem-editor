import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../src/store';
import { resetStore } from './helpers';

describe('text format sync', () => {
  beforeEach(() => {
    resetStore();
  });

  it('showing a selected text box format adds no history entry and keeps the document', () => {
    const before = useStore.getState();
    useStore.getState().syncTextFormat({ fontSize: 31, color: '#ff0000', textAlign: 'right' });
    const after = useStore.getState();
    expect(after.textFormat).toMatchObject({ fontSize: 31, color: '#ff0000', textAlign: 'right' });
    expect(after.historyIndex).toBe(before.historyIndex);
    expect(after.chemDrawDocument).toBe(before.chemDrawDocument);
    expect(after.documentStyleSettings).toBe(before.documentStyleSettings);
    expect(after.documentFile.dirty).toBe(before.documentFile.dirty);
  });

  it('is a no-op when the values already match, so an effect cannot feed back into itself', () => {
    useStore.getState().syncTextFormat({ fontSize: 31 });
    const once = useStore.getState();
    useStore.getState().syncTextFormat({ fontSize: 31 });
    expect(useStore.getState()).toBe(once);
  });

  it('changing the toolbar format still rewrites document style and records history', () => {
    const before = useStore.getState();
    useStore.getState().setTextFormat({ fontSize: 17 });
    const after = useStore.getState();
    expect(after.historyIndex).toBeGreaterThan(before.historyIndex);
    expect(after.documentStyleSettings.textFormat?.fontSize).toBe(17);
  });
});
