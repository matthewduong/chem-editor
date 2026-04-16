import test from 'node:test';
import assert from 'node:assert/strict';

import { generateDocumentSVG } from '../.unit-test-dist/src/lib/svgExport.js';
import {
  DEFAULT_DOCUMENT_STYLE_SETTINGS,
  DEFAULT_DOCUMENT_VIEW_SETTINGS,
} from '../.unit-test-dist/src/lib/settings.js';

const ONE_PIXEL_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4//8/AwAI/AL+J5P56QAAAABJRU5ErkJggg==';

test('generateDocumentSVG renders native non-structure objects and object tags', () => {
  const svg = generateDocumentSVG({
    schemaVersion: 1,
    source: 'manual',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'g1',
            type: 'graphic',
            graphicType: 'rounded-rectangle',
            bounds: { left: 12, top: 10, right: 92, bottom: 54 },
            cornerRadius: 12,
            rectangleType: 'RoundEdge Shadow',
            shadowSize: 4,
            style: {
              color: '#224466',
              fillColor: '#ffee88',
            },
            objectTags: [
              {
                name: 'graphic-tag',
                text: {
                  runs: [{ text: 'endo' }],
                  justification: 'center',
                },
                textAnchor: { x: 52, y: 4 },
              },
            ],
          },
          {
            id: 'e1',
            type: 'embedded-object',
            bounds: { left: 100, top: 12, right: 148, bottom: 60 },
            payloadKind: 'pdf',
            payloadHex: '00',
            previewDataUrl: ONE_PIXEL_PNG,
            sourceFileName: 'figure.png',
          },
          {
            id: 'tbl-1',
            type: 'table',
            bounds: { left: 20, top: 72, right: 150, bottom: 122 },
            cells: [
              {
                id: 'cell-1',
                boundsInParent: { left: 20, top: 72, right: 85, bottom: 97 },
                text: {
                  runs: [{ text: 'Yield' }],
                  justification: 'center',
                },
              },
              {
                id: 'cell-2',
                boundsInParent: { left: 85, top: 72, right: 150, bottom: 97 },
                text: {
                  runs: [{ text: '83%' }],
                  justification: 'center',
                },
              },
            ],
            objectTags: [
              {
                name: 'table-tag',
                text: {
                  runs: [{ text: 'n=3' }],
                  justification: 'center',
                },
                textAnchor: { x: 85, y: 126 },
              },
            ],
          },
          {
            id: 'bkt-1',
            type: 'bracket',
            bounds: { left: 160, top: 18, right: 190, bottom: 78 },
            label: 'n',
          },
          {
            id: 'n1',
            type: 'node',
            position: { x: 180, y: 110 },
            element: 'N',
            objectTags: [
              {
                name: 'node-tag',
                positioningOffset: { x: 12, y: -18 },
                text: {
                  runs: [{ text: 'tagged' }],
                  justification: 'center',
                },
              },
            ],
          },
          {
            id: 'frag-1',
            type: 'fragment',
            nodeIds: ['n1'],
            bondIds: [],
          },
        ],
      },
    ],
  });

  assert.match(svg, /data-native-object="graphic"/);
  assert.match(svg, /data-native-object="embedded-object"/);
  assert.match(svg, /data-native-object="table"/);
  assert.match(svg, /data-native-object="bracket"/);
  assert.match(svg, /endo/);
  assert.match(svg, /Yield/);
  assert.match(svg, /83%/);
  assert.match(svg, /n=3/);
  assert.match(svg, /tagged/);
  assert.match(svg, /data:image\/png;base64/);
  assert.match(svg, /filter="drop-shadow/);
});

test('generateDocumentSVG keeps implicit atom labels plain-weight by default', () => {
  const svg = generateDocumentSVG(
    {
      schemaVersion: 1,
      source: 'manual',
      pages: [
        {
          id: 'page-1',
          objects: [
            {
              id: 'n1',
              type: 'node',
              position: { x: 24, y: 24 },
              element: 'O',
            },
            {
              id: 'frag-1',
              type: 'fragment',
              nodeIds: ['n1'],
              bondIds: [],
            },
          ],
        },
      ],
      metadata: {
        documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
        documentViewSettings: DEFAULT_DOCUMENT_VIEW_SETTINGS,
      },
    },
    {
      documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
      documentViewSettings: DEFAULT_DOCUMENT_VIEW_SETTINGS,
    },
  );

  assert.match(svg, /font-weight="normal" font-style="normal"[^>]*>O<\/text>/);
});
