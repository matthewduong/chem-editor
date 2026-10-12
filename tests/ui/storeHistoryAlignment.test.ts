import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../src/store';
import { resetStore } from './helpers';
import { cdxmlToChemDrawDocument } from '../../src/utils/cdxml';
import type { Atom } from '../../src/types/chemistry';

const XML =
  '<?xml version="1.0"?><CDXML><page id="1"><fragment id="2">' +
  '<n id="3" p="0 0"/><n id="4" p="14.4 0"/><b id="5" B="3" E="4"/></fragment></page></CDXML>';

const atom = (id: string, x: number): Atom => ({ id, x, y: 0, kind: 'element', element: 'C' });

/** The flat and document undo stacks are parallel; index N of one is index N of the other. */
function expectAligned(label: string) {
  const s = useStore.getState();
  expect(s.history.length, `${label}: stack lengths`).toBe(s.documentHistory.length);
  expect(s.historyIndex, `${label}: index in range`).toBeLessThan(s.history.length);
  if (s.historyIndex >= 0) {
    expect(s.documentHistory[s.historyIndex], `${label}: head is live`).toBe(s.chemDrawDocument);
  }
}

describe('undo stack alignment', () => {
  beforeEach(() => {
    resetStore();
  });

  it('keeps history and documentHistory index-aligned through every transition', () => {
    const { document } = cdxmlToChemDrawDocument(XML);
    useStore.getState().replaceDocument(document, [], '/tmp/a.cdxml');
    expectAligned('replaceDocument');

    const s = () => useStore.getState();
    s().pushToHistory({
      atoms: [...s().atoms, atom('n1', 50)],
      bonds: s().bonds,
      arrows: s().arrows,
      groups: [],
      textBoxes: s().textBoxes,
    });
    expectAligned('pushToHistory');

    s().commitDocument({ ...s().chemDrawDocument!, metadata: { bondLength: 20 } });
    expectAligned('commitDocument');

    s().undo();
    expectAligned('undo');
    s().undo();
    expectAligned('undo to base');
    s().redo();
    expectAligned('redo');

    // A new edit after undo truncates the redo tail in both stacks.
    s().commitDocument({ ...s().chemDrawDocument!, metadata: { bondLength: 25 } });
    expectAligned('edit after undo');
    expect(s().history).toHaveLength(s().historyIndex + 1);

    s().clearCanvas();
    expectAligned('clearCanvas');
    s().undo();
    expectAligned('undo clear');
  });

  it('stays aligned when history overflows its cap', () => {
    const { document } = cdxmlToChemDrawDocument(XML);
    useStore.getState().replaceDocument(document);
    for (let i = 0; i < 60; i++) {
      useStore.getState().commitDocument({
        ...useStore.getState().chemDrawDocument!,
        metadata: { bondLength: 10 + i },
      });
    }
    expectAligned('after 60 commits');
    expect(useStore.getState().history.length).toBeLessThanOrEqual(50);
  });
});
