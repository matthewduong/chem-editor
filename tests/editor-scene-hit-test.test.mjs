import test from 'node:test';
import assert from 'node:assert/strict';

import { buildDocumentIndex } from '../.unit-test-dist/src/editor/document/index.js';
import { hitTestDocumentScene } from '../.unit-test-dist/src/editor/scene/hitTest.js';
import {
  DEFAULT_DOCUMENT_STYLE_SETTINGS,
  DEFAULT_PAGE_SETUP,
} from '../.unit-test-dist/src/lib/settings.js';

function createScene() {
  const document = {
    schemaVersion: 1,
    source: 'test',
    pages: [
      {
        id: 'page-1',
        objects: [
          { id: 'n1', type: 'node', position: { x: 10, y: 10 }, element: 'C' },
          { id: 'n2', type: 'node', position: { x: 40, y: 10 }, element: 'O' },
          { id: 'b1', type: 'bond', beginNodeId: 'n1', endNodeId: 'n2', order: 1 },
          {
            id: 'a1',
            type: 'arrow',
            arrowType: 'reaction',
            tail: { x: 60, y: 10 },
            head: { x: 90, y: 10 },
          },
          {
            id: 't1',
            type: 'text',
            anchor: { x: 25, y: 60 },
            text: { runs: [{ text: 'note' }], justification: 'center' },
            style: { fontFamily: 'Arial', fontSize: 12, color: '#000000' },
          },
          {
            id: 'g1',
            type: 'graphic',
            graphicType: 'rectangle',
            bounds: { left: 20, top: 20, right: 40, bottom: 40 },
          },
          {
            id: 'br1',
            type: 'bracket',
            bounds: { left: 24, top: 24, right: 36, bottom: 36 },
          },
        ],
      },
    ],
  };

  const atoms = [
    { id: 'n1', x: 10, y: 10, kind: 'element', element: 'C' },
    { id: 'n2', x: 40, y: 10, kind: 'element', element: 'O' },
  ];
  const bonds = [{ id: 'b1', from: 'n1', to: 'n2', order: 1, stereo: 0 }];
  const arrows = [
    {
      id: 'a1',
      type: 'reaction',
      x1: 60,
      y1: 10,
      x2: 90,
      y2: 10,
      cpx: 75,
      cpy: 10,
    },
  ];
  const textBoxes = [
    {
      id: 't1',
      x: 25,
      y: 60,
      runs: [{ text: 'note' }],
      fontSize: 12,
      fontFamily: 'Arial',
      color: '#000000',
      textAlign: 'center',
    },
  ];

  return {
    index: buildDocumentIndex(document, {
      documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
    }),
    legacy: {
      atoms,
      bonds,
      arrows,
      groups: [],
      textBoxes,
      atomById: new Map(atoms.map((atom) => [atom.id, atom])),
      bondById: new Map(bonds.map((bond) => [bond.id, bond])),
      arrowById: new Map(arrows.map((arrow) => [arrow.id, arrow])),
      textBoxById: new Map(textBoxes.map((textBox) => [textBox.id, textBox])),
      bondsByAtomId: new Map([
        ['n1', [bonds[0]]],
        ['n2', [bonds[0]]],
      ]),
      nativeNodes: new Map(
        document.pages[0].objects.slice(0, 2).map((object) => [object.id, object]),
      ),
      nativeBonds: new Map([[document.pages[0].objects[2].id, document.pages[0].objects[2]]]),
      nativeArrows: new Map([[document.pages[0].objects[3].id, document.pages[0].objects[3]]]),
      ringCentroids: new Map(),
      bondVisibleIntervals: new Map(),
    },
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
    pageSetup: DEFAULT_PAGE_SETUP,
    isDarkMode: false,
    showHydrogens: true,
    selectedAtomIds: new Set(),
    selectedBondIds: new Set(),
    selectedArrowIds: new Set(),
    selectedTextBoxIds: new Set(),
    selectedObjectIds: new Set(),
    hiddenObjectIds: new Set(),
    hoveredAtomId: null,
    hoveredBondId: null,
    hoveredArrowId: null,
    hoveredTextBoxId: null,
    hoveredNativeObjectId: null,
    editingTextBoxId: null,
    rdkitInvalidAtomIds: new Set(),
  };
}

test('scene hit testing resolves typed hits through the document index', () => {
  const scene = createScene();

  assert.equal(hitTestDocumentScene(scene, { x: 10, y: 10 }, { stageScale: 1 })?.atomId, 'n1');
  assert.equal(hitTestDocumentScene(scene, { x: 25, y: 10 }, { stageScale: 1 })?.bondId, 'b1');
  assert.equal(hitTestDocumentScene(scene, { x: 75, y: 10 }, { stageScale: 1 })?.arrowId, 'a1');
  assert.equal(hitTestDocumentScene(scene, { x: 25, y: 60 }, { stageScale: 1 })?.textBoxId, 't1');
});

test('scene hit testing keeps reverse document order inside the native-object bucket', () => {
  const scene = createScene();

  const hit = hitTestDocumentScene(scene, { x: 30, y: 30 }, { stageScale: 1 });
  assert.equal(hit?.objectType, 'bracket');
  assert.equal(hit?.nativeObjectId, 'br1');
});

test('scene hit testing ignores hidden preview objects', () => {
  const scene = createScene();
  scene.hiddenObjectIds = new Set(['br1']);

  const hit = hitTestDocumentScene(scene, { x: 30, y: 30 }, { stageScale: 1 });
  assert.equal(hit?.objectType, 'graphic');
  assert.equal(hit?.nativeObjectId, 'g1');
});
