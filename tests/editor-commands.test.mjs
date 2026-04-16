import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyEditorCommand,
  applyEditorTransaction,
  createDeleteSelectionCommand,
  createEditorCommandContext,
  createMoveObjectsCommand,
  createMoveSelectionCommand,
  createRemoveObjectsCommand,
  createRotateSelectionCommand,
  createScaleSelectionCommand,
  createUpsertObjectsCommand,
} from '../.unit-test-dist/src/editor/commands/index.js';
import {
  DEFAULT_DOCUMENT_STYLE_SETTINGS,
  DEFAULT_PAGE_SETUP,
} from '../.unit-test-dist/src/lib/settings.js';

function createDocument() {
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
            position: { x: 10, y: 10 },
            element: 'C',
          },
          {
            id: 'n2',
            type: 'node',
            position: { x: 40, y: 10 },
            element: 'O',
          },
          {
            id: 'b1',
            type: 'bond',
            beginNodeId: 'n1',
            endNodeId: 'n2',
            order: 1,
          },
          {
            id: 'f1',
            type: 'fragment',
            nodeIds: ['n1', 'n2'],
            bondIds: ['b1'],
          },
        ],
      },
    ],
  };
}

function createContext() {
  return createEditorCommandContext({
    activePageId: 'page-1',
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
    pageSetup: DEFAULT_PAGE_SETUP,
  });
}

function createSelectionContext(objectIds) {
  return createEditorCommandContext({
    activePageId: 'page-1',
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
    pageSetup: DEFAULT_PAGE_SETUP,
    selection: {
      objectIds: new Set(objectIds),
    },
  });
}

test('move command translates selected objects and its inverse restores the document', () => {
  const document = createDocument();
  const result = applyEditorCommand(
    document,
    createMoveObjectsCommand(['n1'], { dx: 12, dy: -4 }),
    createContext(),
  );

  const movedNode = result.document.pages[0].objects.find((object) => object.id === 'n1');
  assert.deepEqual(movedNode.position, { x: 22, y: 6 });
  assert.ok(result.changedObjectIds.has('n1'));

  const restored = result.inversePatch.apply(result.document, createContext());
  const restoredNode = restored.document.pages[0].objects.find((object) => object.id === 'n1');
  assert.deepEqual(restoredNode.position, { x: 10, y: 10 });
});

test('upsert, remove, and transaction helpers operate against the active page', () => {
  const document = createDocument();
  const addText = createUpsertObjectsCommand([
    {
      id: 't1',
      type: 'text',
      anchor: { x: 20, y: 30 },
      text: { runs: [{ text: 'note' }], justification: 'center' },
      style: { fontFamily: 'Arial', fontSize: 12 },
    },
  ]);
  const withText = applyEditorCommand(document, addText, createContext()).document;
  assert.ok(withText.pages[0].objects.some((object) => object.id === 't1'));

  const transaction = {
    id: 'tx-1',
    label: 'cleanup',
    commands: [
      createRemoveObjectsCommand(['t1']),
      createUpsertObjectsCommand([
        {
          id: 'n3',
          type: 'node',
          position: { x: 70, y: 20 },
          element: 'N',
        },
      ]),
    ],
  };
  const result = applyEditorTransaction(withText, transaction, createContext());
  assert.ok(!result.document.pages[0].objects.some((object) => object.id === 't1'));
  assert.ok(result.document.pages[0].objects.some((object) => object.id === 'n3'));
  assert.equal(result.inverseTransaction.commands.length, 2);
});

test('selection transform commands operate on the current selection context', () => {
  const document = {
    ...createDocument(),
    pages: [
      {
        ...createDocument().pages[0],
        objects: [
          ...createDocument().pages[0].objects,
          {
            id: 'a1',
            type: 'arrow',
            arrowType: 'reaction',
            tail: { x: 50, y: 20 },
            head: { x: 80, y: 20 },
          },
          {
            id: 't1',
            type: 'text',
            anchor: { x: 20, y: 40 },
            text: { runs: [{ text: 'note' }], justification: 'center' },
            style: { fontFamily: 'Arial', fontSize: 12 },
          },
        ],
      },
    ],
  };

  const moved = applyEditorCommand(
    document,
    createMoveSelectionCommand({ dx: 5, dy: -3 }),
    createSelectionContext(['n1', 'a1', 't1']),
  ).document;
  assert.deepEqual(moved.pages[0].objects.find((object) => object.id === 'n1').position, {
    x: 15,
    y: 7,
  });
  assert.deepEqual(moved.pages[0].objects.find((object) => object.id === 'a1').tail, {
    x: 55,
    y: 17,
  });

  const rotated = applyEditorCommand(
    moved,
    createRotateSelectionCommand({ x: 15, y: 7 }, Math.PI / 2, {
      objectIds: ['n1', 'a1'],
    }),
    createContext(),
  ).document;
  assert.deepEqual(rotated.pages[0].objects.find((object) => object.id === 'n1').position, {
    x: 15,
    y: 7,
  });

  const scaled = applyEditorCommand(
    rotated,
    createScaleSelectionCommand({ x: 15, y: 7 }, 2, {
      objectIds: ['t1'],
    }),
    createContext(),
  ).document;
  assert.equal(scaled.pages[0].objects.find((object) => object.id === 't1').style.fontSize, 24);

  const cleaned = applyEditorCommand(
    scaled,
    createDeleteSelectionCommand({ objectIds: ['a1'] }),
    createContext(),
  ).document;
  assert.ok(!cleaned.pages[0].objects.some((object) => object.id === 'a1'));
});
