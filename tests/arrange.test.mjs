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

test('flipping mirrors positions, swaps half heads, keeps brackets facing in', async () => {
  const { flipSelectedObjects } = await import('../.unit-test-dist/src/lib/chemdrawModel.js');
  const { document } = cdxmlToChemDrawDocument(`<?xml version="1.0"?><CDXML><page id="100">
    <fragment id="2"><n id="3" p="0 0"/><n id="4" p="14.4 0"/><b id="5" B="3" E="4" Display="WedgeBegin"/></fragment>
    <arrow id="7" ArrowheadHead="HalfLeft" ArrowheadType="Solid" Head3D="80 20 0" Tail3D="10 20 0"/>
    <graphic id="8" GraphicType="Bracket" BracketType="Square" BoundingBox="0 30 0 0"/>
  </page></CDXML>`);
  const ids = new Set(['3', '4', '5', '7', '8']);
  const flipped = flipSelectedObjects(document, ids, { x: 40, y: 0 }, 'horizontal');
  const get = (id) => flipped.pages[0].objects.find((o) => o.id === id);
  const original = (id) => document.pages[0].objects.find((o) => o.id === id);
  assert.ok(Math.abs(get('3').position.x - (80 - original('3').position.x)) < 1e-9);
  assert.equal(get('5').display, document.pages[0].objects.find((o) => o.id === '5').display);
  assert.equal(get('7').headEnd, 'half-right');
  assert.ok(Math.abs(get('7').head.x - (80 - original('7').head.x)) < 1e-9);
  // Mirrored and reversed: the right-hand bracket runs top to bottom, lips inward.
  assert.ok(get('8').points[0].y < get('8').points[1].y);
});

test('Rotate 180° keeps the stereochemistry Flip inverts: wedges become hashes', async () => {
  const { flipSelectedObjects } = await import('../.unit-test-dist/src/lib/chemdrawModel.js');
  const { document } = cdxmlToChemDrawDocument(`<?xml version="1.0"?><CDXML><page id="100">
    <fragment id="2"><n id="3" p="0 0"/><n id="4" p="14.4 0"/><b id="5" B="3" E="4" Display="WedgeBegin"/></fragment>
  </page></CDXML>`);
  const ids = new Set(['3', '4', '5']);
  const display = (doc) => doc.pages[0].objects.find((o) => o.id === '5').display;
  assert.equal(
    display(flipSelectedObjects(document, ids, { x: 7, y: 0 }, 'horizontal')),
    'wedge-begin',
  );
  assert.equal(
    display(
      flipSelectedObjects(document, ids, { x: 7, y: 0 }, 'horizontal', undefined, {
        turnOver: true,
      }),
    ),
    'hash-begin',
  );
});
