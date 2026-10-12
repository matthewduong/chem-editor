import { beforeEach, expect, it } from 'vitest';
import { commitCanvasEdit, previewCanvasEdit, projectDocument, useStore } from '../../src/store';
import { cdxmlToChemDrawDocument, chemDrawDocumentToCDXML } from '../../src/utils/cdxml';
import { resetStore } from './helpers';

const XML =
  '<CDXML CustomRoot="retained"><page id="1"><group id="10"><fragment id="2"><n id="3" p="10 10" Isotope="13" CustomAtom="retained"/><n id="4" p="30 10" Element="8"/><b id="5" B="3" E="4"/></fragment><t id="11" p="10 50"><s face="1">untouched</s></t></group><opaque id="12"/></page><page id="20"><t id="21"><s>extra page</s></t></page></CDXML>';
beforeEach(() => {
  resetStore();
});
it('commits a tool edit while retaining untouched native objects, opaque content and extra pages', () => {
  const source = cdxmlToChemDrawDocument(XML).document;
  useStore.getState().replaceDocument(source, [], '/tmp/source.cdxml');
  const state = useStore.getState();
  const text = source.pages[0].objects.find((object) => object.id === '11');
  expect(text).toBeDefined();
  const group = source.pages[0].objects.find((object) => object.id === '10');
  commitCanvasEdit({
    ...projectDocument(source),
    atoms: state.atoms.map((atom) => (atom.id === '4' ? { ...atom, x: atom.x + 10 } : atom)),
  });
  const result = useStore.getState();
  expect(result.history).toHaveLength(2);
  expect(result.chemDrawDocument!.pages[0].objects.find((object) => object.id === '11')).toBe(text);
  expect(result.chemDrawDocument!.pages[0].objects.find((object) => object.id === '10')).toBe(
    group,
  );
  const saved = chemDrawDocumentToCDXML(result.chemDrawDocument!);
  expect(saved).toContain('CustomRoot="retained"');
  expect(saved).toContain('CustomAtom="retained"');
  expect(saved).toContain('Isotope="13"');
  expect(saved).toContain('extra page');
  expect(saved).toContain('<opaque');
  result.undo();
  expect(useStore.getState().chemDrawDocument).toBe(source);
  expect(useStore.getState().documentFile.dirty).toBe(false);
});
it('previews never change committed arrays, revision, dirty state, history or save output', () => {
  const source = cdxmlToChemDrawDocument(XML).document;
  useStore.getState().replaceDocument(source, [], '/tmp/source.cdxml');
  const before = useStore.getState();
  const saved = chemDrawDocumentToCDXML(source);
  previewCanvasEdit({
    ...projectDocument(source),
    atoms: before.atoms.map((atom) => ({ ...atom, x: atom.x + 10 })),
  });
  const preview = useStore.getState();
  expect(preview.previewChemDrawDocument).not.toBe(source);
  expect(preview.atoms).toBe(before.atoms);
  expect(preview.documentRevision).toBe(before.documentRevision);
  expect(preview.documentFile.dirty).toBe(false);
  expect(preview.history).toBe(before.history);
  expect(chemDrawDocumentToCDXML(preview.chemDrawDocument!)).toBe(saved);
  preview.clearPreviewChemDrawDocument();
  commitCanvasEdit(projectDocument(source));
  expect(useStore.getState().history).toBe(before.history);
});
it('keeps fragment IDs unique when a new disconnected component collides with a source ID', () => {
  const source = cdxmlToChemDrawDocument(
    '<CDXML><page id="p"><fragment id="fragment-2"><n id="n" p="0 0"/></fragment></page></CDXML>',
  ).document;
  useStore.getState().replaceDocument(source);
  const state = projectDocument(source);
  commitCanvasEdit({
    ...state,
    atoms: [...state.atoms, { id: 'new', kind: 'element', element: 'C', x: 100, y: 100 }],
  });
  const objects = useStore.getState().chemDrawDocument!.pages[0].objects;
  expect(new Set(objects.map((object) => object.id)).size).toBe(objects.length);
  expect(objects.filter((object) => object.type === 'fragment')).toHaveLength(2);
  expect(() => chemDrawDocumentToCDXML(useStore.getState().chemDrawDocument!)).not.toThrow();
});

it('cached projections and document snapshots cannot be mutated outside commands', () => {
  const document = cdxmlToChemDrawDocument(XML).document;
  useStore.getState().replaceDocument(document);
  const projection = projectDocument(document);
  expect(projectDocument(document)).toBe(projection);
  expect(() => {
    projection.atoms[0].x = 999;
  }).toThrow();
  expect(() => {
    document.pages[0].objects.length = 0;
  }).toThrow();
});

it('hydrates an untouched initial document from saved defaults without creating an edit', () => {
  const state = useStore.getState();
  state.hydrateAppPreferences({
    ...state.appPreferences,
    drawing: { ...state.appPreferences.drawing, bondLength: 60 },
  });
  const result = useStore.getState();
  expect(result.documentStyleSettings.bondLength).toBe(60);
  expect(result.chemDrawDocument!.metadata!.documentStyleSettings!.bondLength).toBe(60);
  expect(result.history).toEqual([result.chemDrawDocument]);
  expect(result.documentFile.dirty).toBe(false);
});
