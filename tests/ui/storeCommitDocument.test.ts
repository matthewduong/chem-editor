import { commitCanvasEdit } from '../../src/store';
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

describe('flat-state commits', () => {
  beforeEach(() => {
    resetStore();
  });

  for (const { name, xml } of fixtures) {
    it(`${name}: a no-op pushToHistory of the current arrays leaves the export unchanged`, () => {
      const { document } = cdxmlToChemDrawDocument(xml);
      useStore.getState().replaceDocument(document, [], '/tmp/n.cdxml');
      const baseline = chemDrawDocumentToCDXML(useStore.getState().chemDrawDocument!);
      const { atoms, bonds, arrows, groups, textBoxes } = useStore.getState();

      commitCanvasEdit({ atoms, bonds, arrows, groups, textBoxes });

      expectFlatArraysProjectDocument();
      expect(chemDrawDocumentToCDXML(useStore.getState().chemDrawDocument!)).toBe(baseline);
    });
  }

  it('keeps a group pointing at its fragments after an unrelated flat edit', () => {
    const xml =
      '<?xml version="1.0"?><CDXML><page id="1">' +
      '<fragment id="2"><n id="3" p="0 0"/><n id="4" p="14.4 0"/><b id="5" B="3" E="4"/></fragment>' +
      '<fragment id="6"><n id="7" p="60 0"/><n id="8" p="74.4 0"/><b id="9" B="7" E="8"/></fragment>' +
      '</page></CDXML>';
    useStore.getState().replaceDocument(cdxmlToChemDrawDocument(xml).document, [], '/tmp/g.cdxml');
    useStore.setState({ selectedObjectIds: new Set(['2', '6']) });
    useStore.getState().groupSelected();

    const { atoms, bonds, arrows, groups, textBoxes } = useStore.getState();
    // A flat-tool edit: nudge one atom, as a drag would.
    commitCanvasEdit({
      atoms: atoms.map((a, i) => (i === 0 ? { ...a, x: a.x + 5 } : a)),
      bonds,
      arrows,
      groups,
      textBoxes,
    });

    const objects = useStore.getState().chemDrawDocument!.pages[0].objects;
    const ids = new Set(objects.map((o) => o.id));
    const group = objects.find((o) => o.type === 'group');
    expect(group).toBeDefined();
    expect(group!.type === 'group' && group!.childIds.length).toBe(2);
    for (const child of group!.type === 'group' ? group!.childIds : []) {
      expect(ids.has(child), `group child ${child} vanished`).toBe(true);
    }
    expect(
      objects
        .filter((o) => o.type === 'fragment')
        .map((o) => o.id)
        .sort(),
    ).toEqual(['2', '6']);
  });

  for (const { name, xml } of fixtures) {
    it(`${name}: nudging one atom changes only that atom's lines in the export`, () => {
      const { document } = cdxmlToChemDrawDocument(xml);
      useStore.getState().replaceDocument(document, [], '/tmp/m.cdxml');
      const { atoms, bonds, arrows, groups, textBoxes } = useStore.getState();
      if (atoms.length === 0) return;
      const baseline = chemDrawDocumentToCDXML(useStore.getState().chemDrawDocument!).split('\n');

      commitCanvasEdit({
        atoms: atoms.map((a, i) => (i === 0 ? { ...a, x: a.x + 5 } : a)),
        bonds,
        arrows,
        groups,
        textBoxes,
      });

      const after = chemDrawDocumentToCDXML(useStore.getState().chemDrawDocument!).split('\n');
      expect(after).toHaveLength(baseline.length);
      // The atom's own position, plus at most its label/tag that travels with it.
      const changed = baseline.filter((line, i) => line !== after[i]);
      expect(changed.length).toBeGreaterThan(0);
      expect(changed.length).toBeLessThanOrEqual(2);
    });
  }
});
