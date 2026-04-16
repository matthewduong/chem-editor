import test from 'node:test';
import assert from 'node:assert/strict';

import { createMoveSelectionCommand } from '../.unit-test-dist/src/editor/commands/index.js';
import {
  DEFAULT_DOCUMENT_STYLE_SETTINGS,
  DEFAULT_PAGE_SETUP,
} from '../.unit-test-dist/src/lib/settings.js';
import { selectEditorSessionState, useStore } from '../.unit-test-dist/src/store/index.js';

function createNodeAtom(id, x, y, element = 'C') {
  return { id, x, y, kind: 'element', element };
}

function createDocument(x = 10, y = 10) {
  return {
    schemaVersion: 1,
    source: 'test',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'n1',
            type: 'node',
            position: { x, y },
            element: 'C',
          },
        ],
      },
    ],
  };
}

function createAppState(overrides = {}) {
  return {
    ...useStore.getState(),
    tool: 'select',
    atoms: [createNodeAtom('n1', 10, 10)],
    bonds: [],
    arrows: [],
    groups: [],
    textBoxes: [],
    history: [],
    documentHistory: [],
    historyIndex: 1,
    selectedObjectIds: new Set(['n1']),
    selectedAtomIds: new Set(['n1']),
    selectedBondIds: new Set(),
    selectedArrowIds: new Set(),
    selectedTextBoxIds: new Set(),
    hoveredCanvasAtomId: 'n1',
    hoveredCanvasBondId: null,
    chemDrawDocument: createDocument(10, 10),
    previewChemDrawDocument: null,
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
    pageSetup: DEFAULT_PAGE_SETUP,
    documentRevision: 2,
    projectionRevision: 2,
    objectCount: 1,
    largeDocumentMode: false,
    editMenusHidden: false,
    previewMode: '2D',
    showViewer: true,
    viewerMode: 'split',
    ...overrides,
  };
}

function resetStore() {
  useStore.setState({
    ...useStore.getState(),
    atoms: [],
    bonds: [],
    arrows: [],
    groups: [],
    textBoxes: [],
    history: [],
    documentHistory: [],
    historyIndex: -1,
    selectedObjectIds: new Set(),
    selectedAtomIds: new Set(),
    selectedBondIds: new Set(),
    selectedArrowIds: new Set(),
    selectedTextBoxIds: new Set(),
    hoveredCanvasAtomId: null,
    hoveredCanvasBondId: null,
    chemDrawDocument: null,
    previewChemDrawDocument: null,
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
    pageSetup: DEFAULT_PAGE_SETUP,
    documentRevision: 0,
    projectionRevision: 0,
    objectCount: 0,
    largeDocumentMode: false,
  });
}

test.afterEach(() => {
  resetStore();
});

test('selectEditorSessionState prefers preview documents for scene consumers', () => {
  const session = selectEditorSessionState(
    createAppState({
      chemDrawDocument: createDocument(10, 10),
      previewChemDrawDocument: createDocument(40, 25),
    }),
    { width: 800, height: 600, scale: 2, x: 12, y: -8 },
  );

  const previewNode = session.document.pages[0].objects.find((object) => object.id === 'n1');
  assert.equal(previewNode.position.x, 40);
  assert.equal(previewNode.position.y, 25);
  assert.equal(session.selection.objectIds.has('n1'), true);
  assert.equal(session.selection.hoveredObjectId, 'n1');
  assert.equal(session.viewport.width, 800);
  assert.equal(session.viewport.height, 600);
  assert.equal(session.viewport.scale, 2);
  assert.equal(session.viewport.x, 12);
  assert.equal(session.viewport.y, -8);
  assert.equal(session.revision, 2);
});

test('selectEditorSessionState synthesizes a document from canvas state when needed', () => {
  const session = selectEditorSessionState(
    createAppState({
      chemDrawDocument: null,
      previewChemDrawDocument: null,
      atoms: [createNodeAtom('a1', 5, 7)],
      selectedObjectIds: new Set(['a1']),
      selectedAtomIds: new Set(['a1']),
      hoveredCanvasAtomId: 'a1',
      historyIndex: 0,
      documentRevision: 1,
    }),
    { width: 320, height: 200 },
  );

  const synthesizedNode = session.document.pages[0].objects.find((object) => object.id === 'a1');
  assert.ok(synthesizedNode);
  assert.equal(synthesizedNode.type, 'node');
  assert.deepEqual(synthesizedNode.position, { x: 5, y: 7 });
  assert.equal(session.selection.objectIds.has('a1'), true);
  assert.equal(session.selection.hoveredObjectId, 'a1');
  assert.equal(session.revision, 1);
});

test('dispatchEditorCommand commits native document changes and clears preview state', () => {
  resetStore();
  useStore.setState({
    ...useStore.getState(),
    atoms: [createNodeAtom('n1', 10, 10)],
    bonds: [],
    arrows: [],
    groups: [],
    textBoxes: [],
    history: [],
    documentHistory: [],
    historyIndex: -1,
    selectedObjectIds: new Set(['n1']),
    selectedAtomIds: new Set(['n1']),
    selectedBondIds: new Set(),
    selectedArrowIds: new Set(),
    selectedTextBoxIds: new Set(),
    chemDrawDocument: createDocument(10, 10),
    previewChemDrawDocument: createDocument(99, 99),
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
    pageSetup: DEFAULT_PAGE_SETUP,
  });

  useStore.getState().dispatchEditorCommand(createMoveSelectionCommand({ dx: 7, dy: -2 }));

  const nextState = useStore.getState();
  const movedNode = nextState.chemDrawDocument.pages[0].objects.find(
    (object) => object.id === 'n1',
  );
  assert.deepEqual(movedNode.position, { x: 17, y: 8 });
  assert.equal(nextState.previewChemDrawDocument, null);
  assert.deepEqual(
    nextState.atoms.map((atom) => ({ id: atom.id, x: atom.x, y: atom.y })),
    [{ id: 'n1', x: 17, y: 8 }],
  );
  assert.equal(nextState.historyIndex, 0);
  assert.equal(nextState.history.length, 1);
  assert.equal(nextState.documentHistory.length, 1);
});

test('pushToHistory materializes a canonical document for canvas-only states', () => {
  resetStore();
  useStore.getState().pushToHistory({
    atoms: [createNodeAtom('n1', 14, 22)],
    bonds: [],
    arrows: [],
    groups: [],
    textBoxes: [],
  });

  const nextState = useStore.getState();
  assert.ok(nextState.chemDrawDocument);
  assert.equal(nextState.documentHistory.length, 1);
  assert.equal(nextState.documentRevision, 1);
  assert.equal(nextState.projectionRevision, 1);
  const node = nextState.chemDrawDocument.pages[0].objects.find((object) => object.id === 'n1');
  assert.ok(node);
  assert.equal(node.type, 'node');
  assert.deepEqual(node.position, { x: 14, y: 22 });
});

test('largeDocumentMode turns on automatically for monolithic pages', () => {
  resetStore();
  const objects = Array.from({ length: 2000 }, (_, index) => ({
    id: `n${index}`,
    type: 'node',
    position: { x: index, y: index },
    element: 'C',
  }));
  useStore.getState().setChemDrawDocument({
    schemaVersion: 1,
    source: 'test',
    pages: [{ id: 'page-1', objects }],
  });

  const nextState = useStore.getState();
  assert.equal(nextState.objectCount, 2000);
  assert.equal(nextState.largeDocumentMode, true);
});
