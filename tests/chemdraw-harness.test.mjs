import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCompatibilitySummary,
  classifyFailure,
  formatCompatibilityDiff,
  runCaseWithRetry,
  sanitizeCaseId,
} from '../scripts/lib/chemdraw-harness.mjs';

test('compatibility summary ignores ids, coordinates, and object order', () => {
  const leftDocument = {
    schemaVersion: 1,
    source: 'cdxml-import',
    pages: [
      {
        id: 'page-a',
        objects: [
          {
            id: 'node-a',
            type: 'node',
            position: { x: 10, y: 10 },
            element: 'C',
          },
          {
            id: 'node-b',
            type: 'node',
            position: { x: 20, y: 10 },
            alias: 'Ph',
            text: { runs: [{ text: 'Ph' }] },
          },
          {
            id: 'bond-a',
            type: 'bond',
            beginNodeId: 'node-a',
            endNodeId: 'node-b',
            order: 1,
            display: 'wedge-begin',
          },
          {
            id: 'arrow-a',
            type: 'arrow',
            arrowType: 'reaction',
            tail: { x: 0, y: 0 },
            head: { x: 10, y: 0 },
            textAbove: { runs: [{ text: 'heat' }] },
          },
          {
            id: 'text-a',
            type: 'text',
            anchor: { x: 5, y: 5 },
            text: { runs: [{ text: 'Conditions' }] },
          },
        ],
      },
    ],
  };

  const rightDocument = {
    schemaVersion: 1,
    source: 'cdxml-import',
    pages: [
      {
        id: 'page-z',
        objects: [
          {
            id: 'text-z',
            type: 'text',
            anchor: { x: 90, y: 40 },
            text: { runs: [{ text: 'Conditions' }] },
          },
          {
            id: 'arrow-z',
            type: 'arrow',
            arrowType: 'reaction',
            tail: { x: 100, y: 100 },
            head: { x: 150, y: 100 },
            textAbove: { runs: [{ text: 'heat' }] },
          },
          {
            id: 'bond-z',
            type: 'bond',
            beginNodeId: 'node-2',
            endNodeId: 'node-1',
            order: 1,
            display: 'wedge-begin',
          },
          {
            id: 'node-2',
            type: 'node',
            position: { x: 999, y: 999 },
            alias: 'Ph',
            text: { runs: [{ text: 'Ph' }] },
          },
          {
            id: 'node-1',
            type: 'node',
            position: { x: -12, y: 48 },
            element: 'C',
          },
        ],
      },
    ],
  };

  const leftSummary = buildCompatibilitySummary(leftDocument);
  const rightSummary = buildCompatibilitySummary(rightDocument);

  assert.deepEqual(leftSummary, rightSummary);
  assert.equal(formatCompatibilityDiff(leftSummary, rightSummary), 'No differences.');
});

test('compatibility summary ignores non-editable ChemDraw objects', () => {
  const leftSummary = buildCompatibilitySummary({
    schemaVersion: 1,
    source: 'cdxml-import',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'graphic-1',
            type: 'graphic',
            graphicType: 'unknown',
            preservation: { capability: 'render-only' },
          },
          {
            id: 'node-1',
            type: 'node',
            position: { x: 0, y: 0 },
            element: 'O',
          },
        ],
      },
    ],
  });

  const rightSummary = buildCompatibilitySummary({
    schemaVersion: 1,
    source: 'cdxml-import',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'node-1',
            type: 'node',
            position: { x: 10, y: 10 },
            element: 'O',
          },
        ],
      },
    ],
  });

  assert.deepEqual(leftSummary, rightSummary);
});

test('compatibility summary fingerprints typed non-structure content', () => {
  const summary = buildCompatibilitySummary({
    schemaVersion: 1,
    source: 'cdxml-import',
    pages: [
      {
        id: 'page-1',
        objects: [
          {
            id: 'graphic-1',
            type: 'graphic',
            graphicType: 'rounded-rectangle',
            bounds: { left: 0, top: 0, right: 10, bottom: 10 },
            style: { color: '#000000', fillColor: '#ffff00' },
            objectTags: [{ name: 'highlight', text: { runs: [{ text: 'note' }] } }],
            preservation: { capability: 'round-trip-only' },
          },
          {
            id: 'img-1',
            type: 'embedded-object',
            bounds: { left: 20, top: 0, right: 40, bottom: 20 },
            payloadKind: 'pdf',
            payloadHex: '25504446',
          },
          {
            id: 'tbl-1',
            type: 'table',
            bounds: { left: 0, top: 30, right: 40, bottom: 50 },
            cells: [
              {
                id: 'cell-1',
                boundsInParent: { left: 0, top: 30, right: 20, bottom: 40 },
                text: { runs: [{ text: 'A' }] },
              },
              {
                id: 'cell-2',
                boundsInParent: { left: 20, top: 30, right: 40, bottom: 50 },
                text: { runs: [{ text: 'B' }] },
              },
            ],
          },
        ],
      },
    ],
  });

  assert.deepEqual(summary.graphicKinds, {
    'type:rounded-rectangle|stroke:#000000|fill:#ffff00': 1,
  });
  assert.deepEqual(summary.objectTags, { highlight: 1 });
  assert.deepEqual(summary.embeddedKinds, { pdf: 1 });
  assert.deepEqual(summary.tableKinds, {
    'cells:2|signature:2000x1000,2000x2000': 1,
  });
});

test('sanitizeCaseId keeps filesystem-safe case identifiers', () => {
  assert.equal(
    sanitizeCaseId('chapter1/figures/reductive amination/table.cdxml'),
    'chapter1_figures_reductive_amination_table.cdxml',
  );
});

test('classifyFailure maps ChemDraw session stages to stable failure classes', () => {
  const openError = new Error('ChemDraw open-document failed');
  openError.stage = 'open-document';
  assert.equal(classifyFailure(openError), 'open');

  const saveError = new Error('ChemDraw save-cdxml failed');
  saveError.stage = 'save-cdxml';
  assert.equal(classifyFailure(saveError), 'save-cdxml');

  const closeError = new Error('ChemDraw close-document failed');
  closeError.stage = 'close-document';
  assert.equal(classifyFailure(closeError), 'close');
});

test('classifyFailure recognizes semantic drift and xml parse failures', () => {
  assert.equal(
    classifyFailure(new Error('Compatibility summary drift detected\nnodeTexts.Ph: 1 -> 2')),
    'semantic-drift',
  );
  assert.equal(
    classifyFailure(new Error('chemdraw-output: xmllint rejected output\ninvalid xml')),
    'xml-parse',
  );
});

test('runCaseWithRetry relaunches once and retries the current case', async () => {
  let recoveries = 0;
  const seenAttempts = [];

  const result = await runCaseWithRetry({
    async runAttempt(attempt) {
      seenAttempts.push(attempt);
      if (attempt === 1) throw new Error('first attempt failed');
      return 'ok';
    },
    async recoverSession() {
      recoveries += 1;
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.attempt, 2);
  assert.equal(result.value, 'ok');
  assert.equal(recoveries, 1);
  assert.deepEqual(seenAttempts, [1, 2]);
});

test('runCaseWithRetry passes the staged failure into recovery', async () => {
  const recoveries = [];

  const result = await runCaseWithRetry({
    async runAttempt(attempt) {
      if (attempt === 1) {
        const error = new Error('ChemDraw open-document failed');
        error.stage = 'open-document';
        throw error;
      }
      return 'ok';
    },
    async recoverSession(error, attempt) {
      recoveries.push({
        attempt,
        stage: error.stage,
        classification: classifyFailure(error),
      });
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(recoveries, [
    {
      attempt: 1,
      stage: 'open-document',
      classification: 'open',
    },
  ]);
});

test('runCaseWithRetry returns both failures when retry is exhausted', async () => {
  let recoveries = 0;

  const result = await runCaseWithRetry({
    async runAttempt(attempt) {
      throw new Error(`attempt ${attempt} failed`);
    },
    async recoverSession() {
      recoveries += 1;
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 2);
  assert.equal(recoveries, 1);
  assert.match(result.failures[0].error.message, /attempt 1 failed/);
  assert.match(result.failures[1].error.message, /attempt 2 failed/);
});
