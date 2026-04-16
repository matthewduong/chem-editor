import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDocumentIndex,
  getVisibleObjects,
  queryObjectsInBounds,
} from '../.unit-test-dist/src/editor/document/index.js';
import {
  DEFAULT_DOCUMENT_STYLE_SETTINGS,
  DEFAULT_PAGE_SETUP,
} from '../.unit-test-dist/src/lib/settings.js';

const DOCUMENT = {
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
          order: 2,
        },
        {
          id: 'f1',
          type: 'fragment',
          nodeIds: ['n1', 'n2'],
          bondIds: ['b1'],
        },
        {
          id: 't1',
          type: 'text',
          anchor: { x: 40, y: 30 },
          text: { runs: [{ text: 'Conditions' }], justification: 'center' },
          style: { fontFamily: 'Arial', fontSize: 12, color: '#000000' },
        },
        {
          id: 'g1',
          type: 'group',
          childIds: ['n1', 'b1', 't1'],
        },
      ],
    },
  ],
  metadata: {
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
    pageSetup: DEFAULT_PAGE_SETUP,
  },
};

test('document index builds lookup, adjacency, membership, and bounds caches', () => {
  const index = buildDocumentIndex(DOCUMENT, {
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
  });

  assert.equal(index.activePageId, 'page-1');
  assert.equal(index.objectById.size, 6);
  assert.equal(index.objectOrderIndexById.get('n1'), 0);
  assert.deepEqual(index.childrenByParent.get('f1'), ['n1', 'n2', 'b1']);
  assert.deepEqual(index.childrenByParent.get('g1'), ['n1', 'b1', 't1']);
  assert.deepEqual(index.nodeAdjacency.get('n1'), [{ bondId: 'b1', otherNodeId: 'n2' }]);
  assert.deepEqual(index.fragmentMembership.get('n1'), ['f1']);
  assert.deepEqual(index.fragmentMembership.get('b1'), ['f1']);
  assert.ok(index.spatialIndex.cells.size > 0);

  const textBounds = index.boundsById.get('t1');
  assert.ok(textBounds);
  assert.ok(textBounds.right > textBounds.left);
  assert.ok(textBounds.bottom > textBounds.top);

  const groupBounds = index.boundsById.get('g1');
  assert.ok(groupBounds);
  assert.ok(groupBounds.right >= textBounds.right);
});

test('visible object queries follow viewport bounds and preserve document order', () => {
  const index = buildDocumentIndex(DOCUMENT, {
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
  });

  const nearOrigin = queryObjectsInBounds(index, {
    left: 0,
    top: 0,
    right: 22,
    bottom: 22,
  });
  assert.deepEqual(
    nearOrigin.map((entry) => entry.id),
    ['n1', 'b1', 'f1', 'g1'],
  );

  const visible = getVisibleObjects(index, {
    left: 0,
    top: 0,
    right: 50,
    bottom: 18,
  });
  assert.deepEqual(
    visible.map((object) => object.id),
    ['n1', 'n2', 'b1', 'f1', 'g1'],
  );
});

test('spatial queries deduplicate objects that span multiple cells', () => {
  const index = buildDocumentIndex(
    {
      ...DOCUMENT,
      pages: [
        {
          id: 'page-1',
          objects: [
            {
              id: 'g-wide',
              type: 'graphic',
              graphicType: 'rectangle',
              bounds: { left: 0, top: 0, right: 800, bottom: 40 },
            },
          ],
        },
      ],
      metadata: {
        documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
        pageSetup: DEFAULT_PAGE_SETUP,
      },
    },
    {
      documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
    },
  );

  const visible = queryObjectsInBounds(index, {
    left: 100,
    top: 0,
    right: 500,
    bottom: 20,
  });

  assert.deepEqual(
    visible.map((entry) => entry.id),
    ['g-wide'],
  );
});
