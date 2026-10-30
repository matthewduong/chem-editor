import test from 'node:test';
import assert from 'node:assert/strict';

import { bondJoinPairs, joinNodes } from '../.unit-test-dist/src/lib/joinStructures.js';
import {
  createEditorCommandContext,
  createJoinSelectionCommand,
  createMoveAndJoinCommand,
} from '../.unit-test-dist/src/editor/commands/index.js';
import { cdxmlToChemDrawDocument } from '../.unit-test-dist/src/utils/cdxml.js';

// Two ethanes, the second's first atom 1pt from the first's last.
const SOURCE = `<?xml version="1.0"?><CDXML BondLength="14.4"><page id="100">
  <fragment id="1"><n id="2" p="0 0"/><n id="3" p="14.4 0"/><b id="4" B="2" E="3"/></fragment>
  <fragment id="5"><n id="6" p="15.4 0" Element="7"/><n id="7" p="29.8 0"/><b id="8" B="6" E="7"/></fragment>
</page></CDXML>`;
const objects = (document) => document.pages[0].objects;
const context = (document) => createEditorCommandContext({ activePageId: document.pages[0].id });

test('joining two atoms keeps the front one and merges the fragments', () => {
  const { document } = cdxmlToChemDrawDocument(SOURCE);
  const joined = joinNodes(document, [['3', '6']]);
  const nodes = objects(joined).filter((o) => o.type === 'node');
  assert.equal(nodes.length, 3);
  const survivor = nodes.find((n) => n.id === '6');
  assert.ok(survivor, 'the atom drawn later (front) survives');
  assert.equal(survivor.element, 'N', 'with its own label');
  const fragments = objects(joined).filter((o) => o.type === 'fragment');
  assert.equal(fragments.length, 1);
  assert.deepEqual([...fragments[0].nodeIds].sort(), ['2', '6', '7']);
  const bond = objects(joined).find((o) => o.id === '4');
  assert.equal(bond.endNodeId, '6');
});

test('joining two bonds fuses both ends and keeps one bond between them', () => {
  const source = `<?xml version="1.0"?><CDXML BondLength="14.4"><page id="100">
    <fragment id="1"><n id="2" p="0 0"/><n id="3" p="14.4 0"/><b id="4" B="2" E="3"/></fragment>
    <fragment id="5"><n id="6" p="14.6 0.5"/><n id="7" p="0.3 0.2"/><b id="8" B="6" E="7"/></fragment>
  </page></CDXML>`;
  const { document } = cdxmlToChemDrawDocument(source);
  assert.deepEqual(bondJoinPairs(document, '4', '8'), [
    ['2', '7'],
    ['3', '6'],
  ]);
  const joined = createJoinSelectionCommand({ objectIds: ['4', '8'] }).apply(
    document,
    context(document),
  ).document;
  assert.equal(objects(joined).filter((o) => o.type === 'node').length, 2);
  assert.equal(objects(joined).filter((o) => o.type === 'bond').length, 1);
});

test('dropping an atom onto another snaps and joins in one command', () => {
  const { document } = cdxmlToChemDrawDocument(SOURCE);
  const result = createMoveAndJoinCommand({ dx: -0.8, dy: 0 }, 3, {
    objectIds: ['6', '7', '8'],
  }).apply(document, context(document));
  const nodes = objects(result.document).filter((o) => o.type === 'node');
  assert.equal(nodes.length, 3);
  const survivor = nodes.find((n) => n.id === '6' || n.id === '3');
  const original3 = objects(document).find((o) => o.id === '3');
  assert.ok(Math.abs(survivor.position.x - original3.position.x) < 1e-9, 'snapped onto the target');
  assert.ok(result.inversePatch);
});
