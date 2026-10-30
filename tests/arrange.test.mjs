import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getCenterOnPageOffset,
  reorderSelectedObjects,
} from '../.unit-test-dist/src/lib/chemdrawModel.js';
import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';

const SOURCE = `<?xml version="1.0"?><CDXML BondLength="14.4"><page id="100">
  <fragment id="2" Z="5"><n id="3" p="0 0" Z="6"/><n id="4" p="14.4 0" Z="7"/><b id="5" B="3" E="4" Z="8"/></fragment>
  <graphic id="9" GraphicType="Rectangle" BoundingBox="-5 -5 20 5" Z="9"/>
  <graphic id="10" GraphicType="Oval" BoundingBox="30 0 40 10" Z="10"/>
</page></CDXML>`;

const order = (document) => document.pages[0].objects.map((o) => o.id);
const z = (document, id) => {
  const object = document.pages[0].objects.find((o) => o.id === id);
  return object.style?.zIndex ?? Number(object.preservation?.rawAttributes?.Z);
};

test('bringing an atom to the front brings its whole fragment, and writes Z past the rest', () => {
  const { document } = cdxmlToChemDrawDocument(SOURCE);
  const front = reorderSelectedObjects(document, ['3'], 'front');
  const ids = order(front);
  assert.deepEqual(ids.slice(0, 2), ['9', '10']);
  for (const id of ['2', '3', '4', '5']) {
    assert.ok(ids.indexOf(id) > ids.indexOf('10'), `${id} should draw after the oval`);
    assert.ok(z(front, id) > 10, `${id} needs a Z above 10, got ${z(front, id)}`);
  }
  // The file keeps it: the fragment's Z beats the rectangle's after export.
  const out = chemDrawDocumentToCDXML(front);
  // Export renumbers atoms, so compare every node's Z with the rectangle's.
  const nodeZ = [...out.matchAll(/<n id="\d+"[^>]*Z="(\d+)"/g)].map((m) => Number(m[1]));
  const rectZ = Number(/<graphic id="9"[^>]*Z="(\d+)"/.exec(out)?.[1]);
  assert.equal(nodeZ.length, 2);
  assert.ok(nodeZ.every((value) => value > rectZ));
});

test('sending a graphic to the back puts it first and below every other Z', () => {
  const { document } = cdxmlToChemDrawDocument(SOURCE);
  const back = reorderSelectedObjects(document, ['10'], 'back');
  assert.equal(order(back)[0], '10');
  const others = ['2', '3', '4', '5', '9'].map((id) => z(back, id));
  assert.ok(others.every((value) => value > z(back, '10')));
});

test('a document without Z is reordered without inventing any', () => {
  const { document } = cdxmlToChemDrawDocument(SOURCE.replace(/ Z="\d+"/g, ''));
  const front = reorderSelectedObjects(document, ['9'], 'front');
  assert.equal(order(front).at(-1), '9');
  assert.equal(front.pages[0].objects.at(-1).style?.zIndex, undefined);
});

test('centre on page offsets the selection box to the page centre', () => {
  const { document } = cdxmlToChemDrawDocument(SOURCE);
  const rect = document.pages[0].objects.find((o) => o.id === '9');
  const offset = getCenterOnPageOffset(document, ['9'], { width: 600, height: 800 });
  const cx = (rect.bounds.left + rect.bounds.right) / 2;
  const cy = (rect.bounds.top + rect.bounds.bottom) / 2;
  assert.ok(Math.abs(cx + offset.dx - 300) < 1e-9);
  assert.ok(Math.abs(cy + offset.dy - 400) < 1e-9);
  assert.equal(getCenterOnPageOffset(document, ['nope'], { width: 1, height: 1 }), null);
});
