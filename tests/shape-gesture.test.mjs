import test from 'node:test';
import assert from 'node:assert/strict';

import {
  boxShapeGeometry,
  createBoxShapeGraphic,
  isShapeBigEnough,
} from '../.unit-test-dist/src/lib/shapeGesture.js';
import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';

test('a rectangle spans the drag corner to corner, in any direction', () => {
  const g = boxShapeGeometry('rectangle', { x: 40, y: 30 }, { x: 10, y: 10 });
  assert.deepEqual(g, { center: { x: 25, y: 20 }, halfWidth: 15, halfHeight: 10 });
});

test('Shift makes a rectangle square on its longer side', () => {
  const g = boxShapeGeometry('rectangle', { x: 0, y: 0 }, { x: 30, y: -10 }, true);
  assert.equal(g.halfWidth, 15);
  assert.equal(g.halfHeight, 15);
  assert.deepEqual(g.center, { x: 15, y: -15 });
});

test('ovals and circles grow outward from where the drag began', () => {
  assert.deepEqual(boxShapeGeometry('oval', { x: 50, y: 50 }, { x: 70, y: 40 }), {
    center: { x: 50, y: 50 },
    halfWidth: 20,
    halfHeight: 10,
  });
  const circle = boxShapeGeometry('circle', { x: 0, y: 0 }, { x: 30, y: 40 });
  assert.equal(circle.halfWidth, 50);
  assert.equal(circle.halfHeight, 50);
});

test('a press with no real drag is a click, not a shape', () => {
  assert.equal(
    isShapeBigEnough(boxShapeGeometry('rectangle', { x: 0, y: 0 }, { x: 1, y: 2 })),
    false,
  );
  assert.equal(isShapeBigEnough(boxShapeGeometry('oval', { x: 0, y: 0 }, { x: 3, y: 0 })), true);
});

test('created shapes are editable and written the way ChemDraw writes them', () => {
  const rounded = createBoxShapeGraphic('7', 'rounded-rectangle', {
    center: { x: 30, y: 20 },
    halfWidth: 20,
    halfHeight: 10,
  });
  const circle = createBoxShapeGraphic('8', 'circle', {
    center: { x: 100, y: 20 },
    halfWidth: 10,
    halfHeight: 10,
  });
  assert.equal(rounded.preservation.capability, 'editable');
  const { document } = cdxmlToChemDrawDocument(
    '<?xml version="1.0"?><CDXML BondLength="14.4"><page id="100"/></CDXML>',
  );
  const out = chemDrawDocumentToCDXML({
    ...document,
    pages: [{ ...document.pages[0], objects: [rounded, circle] }],
  });
  const tag = (id) => new RegExp(`<graphic id="${id}"[^>]*>`).exec(out)?.[0] ?? '';
  assert.match(tag(7), /GraphicType="Rectangle" RectangleType="RoundEdge"/);
  assert.match(tag(7), /Center3D="[^"]+" MajorAxisEnd3D="[^"]+" MinorAxisEnd3D="[^"]+"/);
  assert.match(tag(8), /GraphicType="Oval" OvalType="Circle"/);
});
