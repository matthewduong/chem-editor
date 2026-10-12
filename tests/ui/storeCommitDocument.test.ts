import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { useStore } from '../../src/store';
import { resetStore } from './helpers';
import { cdxmlToChemDrawDocument, chemDrawDocumentToCDXML } from '../../src/utils/cdxml';
import { chemDrawDocumentToCanvasState } from '../../src/lib/chemdrawModel';

const FIXTURE_DIR = join(__dirname, '..', 'fixtures', 'cdxml');
const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.cdxml'))
  .map((name) => ({ name, xml: readFileSync(join(FIXTURE_DIR, name), 'utf8') }));

const ids = (items: Array<{ id: string }>) => items.map((item) => item.id).sort();

/** The flat arrays are a projection of the document; they must never drift from it. */
function expectFlatArraysProjectDocument() {
  const state = useStore.getState();
  expect(state.chemDrawDocument).not.toBeNull();
  const projected = chemDrawDocumentToCanvasState(state.chemDrawDocument!).state;
  expect(ids(state.atoms)).toEqual(ids(projected.atoms));
  expect(ids(state.bonds)).toEqual(ids(projected.bonds));
  expect(ids(state.arrows)).toEqual(ids(projected.arrows));
  expect(ids(state.textBoxes)).toEqual(ids(projected.textBoxes ?? []));
}

describe('commitDocument', () => {
  beforeEach(() => {
    resetStore();
  });

  it('stores the given document as-is and records one undo step', () => {
    const { document } = cdxmlToChemDrawDocument(fixtures[0].xml);
    useStore.getState().replaceDocument(document, [], '/tmp/a.cdxml');
    const before = useStore.getState();
    const next = { ...document, metadata: { ...document.metadata, bondLength: 33 } };

    useStore.getState().commitDocument(next);

    const after = useStore.getState();
    expect(after.chemDrawDocument).toBe(next);
    expect(after.history).toHaveLength(before.history.length + 1);
    expect(after.documentHistory).toHaveLength(before.documentHistory.length + 1);
    expect(after.documentFile.dirty).toBe(true);
    expectFlatArraysProjectDocument();

    useStore.getState().undo();
    expect(useStore.getState().chemDrawDocument).toBe(document);
    expect(useStore.getState().documentFile.dirty).toBe(false);
  });

  for (const { name, xml } of fixtures) {
    it(`${name}: group then ungroup keeps arrays projected and the export unchanged`, () => {
      const { document } = cdxmlToChemDrawDocument(xml);
      useStore.getState().replaceDocument(document, [], '/tmp/f.cdxml');
      const page = useStore.getState().chemDrawDocument!.pages[0];
      const topLevel = page.objects.filter((o) => o.type !== 'node' && o.type !== 'bond');
      if (topLevel.length < 2) return;
      const baseline = chemDrawDocumentToCDXML(useStore.getState().chemDrawDocument!);

      useStore.setState({ selectedObjectIds: new Set(topLevel.map((o) => o.id)) });
      useStore.getState().groupSelected();
      expectFlatArraysProjectDocument();
      expect(useStore.getState().documentFile.dirty).toBe(true);

      const group = useStore
        .getState()
        .chemDrawDocument!.pages[0].objects.find((o) => o.type === 'group');
      expect(group).toBeDefined();
      useStore.setState({ selectedObjectIds: new Set([group!.id]) });
      useStore.getState().ungroupSelected();
      expectFlatArraysProjectDocument();
      const restored = chemDrawDocumentToCDXML(useStore.getState().chemDrawDocument!);
      expect(restored).toBe(baseline);
    });
  }
});
