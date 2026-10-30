import test from 'node:test';
import assert from 'node:assert/strict';

import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';
import {
  perspectiveSelectedObjects,
  perspectiveTiltForDrag,
} from '../.unit-test-dist/src/lib/structurePerspective.js';

const { document } =
  cdxmlToChemDrawDocument(`<?xml version="1.0"?><CDXML BondLength="14.4"><page id="1">
  <fragment id="2"><n id="3" p="0 0"/><n id="4" p="30 0"/><b id="5" B="3" E="4"/></fragment></page></CDXML>`);
const ids = new Set(['3', '4']);
const at = (doc, id) => doc.pages[0].objects.find((o) => o.id === id).position;
const origin = at(document, '3');
const length = at(document, '4').x - origin.x;

test('turning about the vertical axis foreshortens a horizontal bond', () => {
  const tilted = perspectiveSelectedObjects(document, ids, origin, 0, Math.PI / 3);
  assert.ok(Math.abs(at(tilted, '4').x - origin.x - length / 2) < 1e-9);
  assert.ok(Math.abs(at(tilted, '4').y - origin.y) < 1e-9);
});

test('two tilts compose as one, because each atom keeps its depth', () => {
  const twice = perspectiveSelectedObjects(
    perspectiveSelectedObjects(document, ids, origin, 0, Math.PI / 4),
    ids,
    origin,
    0,
    Math.PI / 4,
  );
  assert.ok(Math.abs(at(twice, '4').x - origin.x) < 1e-9);
});

test('depth is not written to the file', () => {
  const tilted = perspectiveSelectedObjects(document, ids, { x: 0, y: 0 }, 0.3, 0.4);
  assert.ok(!/depth/i.test(chemDrawDocumentToCDXML(tilted)));
});

test('shift keeps the tilt on one axis', () => {
  const tilt = perspectiveTiltForDrag({ x: 0, y: 0 }, { x: 30, y: 10 }, 30, true);
  assert.equal(tilt.tiltX, 0);
  assert.ok(tilt.tiltY > 0);
});
