import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCdxmlElementSummary,
  assertImportFidelity,
  buildCompatibilitySummary,
  classifyFailure,
  diffCdxmlElementSummaries,
  formatCompatibilityDiff,
  formatCompatibilityDrift,
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

test('element census counts nested markup, not just the top level', () => {
  const summary = buildCdxmlElementSummary(
    `<CDXML BondLength="14.40"><page><fragment><n id="1" NumHydrogens="2"/><n id="2"/>` +
      `<b B="1" E="2"/></fragment><group><t><s>label</s></t></group></page></CDXML>`,
  );

  assert.equal(summary.elements.n, 2);
  assert.equal(summary.elements.b, 1);
  assert.equal(summary.elements.group, 1);
  assert.equal(summary.elements.s, 1);
  assert.equal(summary.attributes.NumHydrogens, 1);
  assert.equal(summary.attributes.BondLength, 1);
});

test('import fidelity reports constructs our own CDXML fails to carry over', () => {
  // The model-level summary cannot see this: a dropped <group> is absent from both sides of a
  // before/after comparison and reads as agreement.
  const source = buildCdxmlElementSummary(
    `<CDXML><page><group><fragment><n id="1" NumHydrogens="2"/></fragment></group>` +
      `<group><fragment><n id="2"/></fragment></group></page></CDXML>`,
  );
  const exported = buildCdxmlElementSummary(
    `<CDXML><page><fragment><n id="1"/></fragment><fragment><n id="2"/></fragment>` +
      `<ChemEditorNote/></page></CDXML>`,
  );

  const delta = diffCdxmlElementSummaries(source, exported);

  assert.deepEqual(delta.elements.dropped.group, { from: 2, to: 0 });
  assert.deepEqual(delta.attributes.dropped.NumHydrogens, { from: 1, to: 0 });
  assert.equal(delta.droppedElementCount, 1);
  // Tag names are folded to lower case to match how the importer compares them; attribute names
  // are not, because CDXML attributes are case-sensitive.
  assert.deepEqual(delta.elements.added.chemeditornote, { from: 0, to: 1 });
  assert.ok(!('fragment' in delta.elements.dropped), 'unchanged counts are not reported');
});

test('container counts make a lost group visible to the summary', () => {
  const withGroup = buildCompatibilitySummary({
    pages: [
      {
        objects: [
          { id: 'g1', type: 'group', childIds: ['f1'] },
          { id: 'f1', type: 'fragment', nodeIds: ['n1'], bondIds: [] },
          { id: 'n1', type: 'node', element: 'C' },
        ],
      },
    ],
  });
  const withoutGroup = buildCompatibilitySummary({
    pages: [
      {
        objects: [
          { id: 'f1', type: 'fragment', nodeIds: ['n1'], bondIds: [] },
          { id: 'n1', type: 'node', element: 'C' },
        ],
      },
    ],
  });

  assert.notEqual(formatCompatibilityDiff(withGroup, withoutGroup), 'No differences.');
  assert.equal(withGroup.containerCounts['group:1'], 1);
  assert.equal(withoutGroup.containerCounts['group:1'], undefined);
});

test('preserved page children are recorded but do not gate', () => {
  // ChemDraw rebuilds <scheme>/<step> from structure on open, so a file exported element for
  // element still comes back regrouped. That is ChemDraw normalising, not our output drifting.
  const before = buildCompatibilitySummary({
    pages: [
      {
        objects: [{ id: 'n1', type: 'node', element: 'C' }],
        preservedPageChildren: [
          { tagName: 'scheme', xml: '<scheme/>', capability: 'render-only', reason: '' },
        ],
      },
    ],
  });
  const after = buildCompatibilitySummary({
    pages: [
      {
        objects: [{ id: 'n1', type: 'node', element: 'C' }],
        preservedPageChildren: [
          { tagName: 'scheme', xml: '<scheme/>', capability: 'render-only', reason: '' },
          { tagName: 'scheme', xml: '<scheme/>', capability: 'render-only', reason: '' },
        ],
      },
    ],
  });

  assert.match(formatCompatibilityDiff(before, after), /preservedPageChildren\.scheme: 1 -> 2/);
  assert.equal(formatCompatibilityDrift(before, after), 'No differences.');
});

test('drift still catches real content changes', () => {
  const before = buildCompatibilitySummary({
    pages: [{ objects: [{ id: 'n1', type: 'node', element: 'C' }] }],
  });
  const after = buildCompatibilitySummary({
    pages: [{ objects: [{ id: 'n1', type: 'node', element: 'N' }] }],
  });

  assert.notEqual(formatCompatibilityDrift(before, after), 'No differences.');
});

test('known-benign drops are separated from the ones that need work', () => {
  // A real file carries one superseded <graphic> per <arrow>, and a nickname carries an expanded
  // <fragment> of nodes and bonds. Both disappear by design; a lost <group> does not.
  const source = buildCdxmlElementSummary(
    `<CDXML><page>` +
      `<arrow id="a1"/><graphic id="g1" SupersededBy="a1"/>` +
      `<fragment><n id="n1"><fragment><n id="n2"/><b id="b1"/></fragment></n></fragment>` +
      `<group><fragment><n id="n3"/></fragment></group>` +
      `<chemicalproperty id="c1"/>` +
      `</page></CDXML>`,
  );
  const exported = buildCdxmlElementSummary(
    `<CDXML><page><arrow id="a1"/>` +
      `<fragment><n id="n1"/></fragment><fragment><n id="n3"/></fragment>` +
      `</page></CDXML>`,
  );

  const delta = diffCdxmlElementSummaries(source, exported);

  assert.deepEqual(Object.keys(delta.elements.unexplained), ['group']);
  assert.equal(delta.droppedElementCount, 1);
  assert.match(delta.elements.expected.graphic.reason, /superseded/);
  assert.match(delta.elements.expected.chemicalproperty.reason, /regenerated/);
  assert.match(delta.elements.expected.n.reason, /nickname/);
});

test('a drop larger than its known cause still surfaces', () => {
  // One superseded graphic explains one disappearance, not three.
  const source = buildCdxmlElementSummary(
    `<CDXML><page><arrow id="a1"/><graphic id="g1" SupersededBy="a1"/>` +
      `<graphic id="g2"/><graphic id="g3"/></page></CDXML>`,
  );
  const exported = buildCdxmlElementSummary(`<CDXML><page><arrow id="a1"/></page></CDXML>`);

  const delta = diffCdxmlElementSummaries(source, exported);

  assert.equal(delta.elements.unexplained.graphic.unexplained, 2);
  assert.equal(delta.elements.expected.graphic.covered, 1);
});

test('an atom label loss cannot hide behind the nickname category', () => {
  // A nickname's expanded <fragment> carries labels that collapse with it, but an atom's own <t>
  // sits directly under the <n> and is exported. Only the former may be written off.
  const source = buildCdxmlElementSummary(
    `<CDXML><page><fragment>` +
      `<n id="n1"><t><s>Ph</s></t><fragment><n id="n2"><t><s>C</s></t></n></fragment></n>` +
      `<n id="n3"><t><s>OMe</s></t></n>` +
      `</fragment></page></CDXML>`,
  );

  // Only the expansion's label is gone: expected, nothing left over.
  const collapsed = buildCdxmlElementSummary(
    `<CDXML><page><fragment>` +
      `<n id="n1"><t><s>Ph</s></t></n><n id="n3"><t><s>OMe</s></t></n>` +
      `</fragment></page></CDXML>`,
  );
  const fine = diffCdxmlElementSummaries(source, collapsed);
  assert.equal(fine.elements.expected.t.covered, 1);
  assert.ok(!('t' in fine.elements.unexplained), 'a collapsed nickname label is expected');

  // A real atom label goes missing too: the extra loss must still surface.
  const lossy = buildCdxmlElementSummary(
    `<CDXML><page><fragment>` +
      `<n id="n1"><t><s>Ph</s></t></n><n id="n3"/>` +
      `</fragment></page></CDXML>`,
  );
  const bad = diffCdxmlElementSummaries(source, lossy);
  assert.equal(bad.elements.unexplained.t.unexplained, 1);
});

test('import fidelity fails on unexplained elements and attributes with its own classification', () => {
  const source = buildCdxmlElementSummary(
    '<CDXML><page><n id="1" p="0 0" Isotope="13"/><unknown Custom="keep"/></page></CDXML>',
  );
  const output = buildCdxmlElementSummary('<CDXML><page><n id="1" p="0 0"/></page></CDXML>');
  const delta = diffCdxmlElementSummaries(source, output);
  assert.throws(
    () => assertImportFidelity(delta),
    (error) => classifyFailure(error) === 'import-fidelity',
  );
  assert.equal(delta.attributes.unexplained.Isotope.unexplained, 1);
});

test('a derived group box is allowed but a lost box on another object still fails', () => {
  const summarize = (xml) => buildCdxmlElementSummary(xml);
  const source = summarize(
    '<CDXML><page><group id="g" BoundingBox="0 0 10 10"/><t id="t" BoundingBox="0 0 10 10"/></page></CDXML>',
  );
  const allowed = summarize(
    '<CDXML><page><group id="g"/><t id="t" BoundingBox="0 0 10 10"/></page></CDXML>',
  );
  const disallowed = summarize(
    '<CDXML><page><group id="g" BoundingBox="0 0 10 10"/><t id="t"/></page></CDXML>',
  );
  assert.doesNotThrow(() => assertImportFidelity(diffCdxmlElementSummaries(source, allowed)));
  assert.throws(
    () => assertImportFidelity(diffCdxmlElementSummaries(source, disallowed)),
    /Import fidelity loss/,
  );
});
