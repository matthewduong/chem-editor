import test from 'node:test';
import assert from 'node:assert/strict';

import {
  boxShapeGeometry,
  createBoxShapeGraphic,
  isShapeBigEnough,
  lineEnd,
  shapeForDrag,
} from '../.unit-test-dist/src/lib/shapeGesture.js';
import { arcPointAt, resolveArcArrow } from '../.unit-test-dist/src/lib/arrowArc.js';
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

test('lines snap to 15 degrees unless Shift frees them', () => {
  const snapped = lineEnd({ x: 0, y: 0 }, { x: 100, y: 3 });
  assert.ok(Math.abs(snapped.y) < 1e-9);
  assert.deepEqual(lineEnd({ x: 0, y: 0 }, { x: 100, y: 3 }, true), { x: 100, y: 3 });
});

test('a drawn line is a headless arrow, written with no ArrowheadHead or ArrowheadTail', () => {
  const { object } = shapeForDrag('dashed-line', '9', { x: 10, y: 10 }, { x: 80, y: 10 });
  assert.equal(object.type, 'arrow');
  assert.equal(object.headEnd, 'none');
  assert.equal(object.style.lineType, 'dashed');
  const { document } = cdxmlToChemDrawDocument(
    '<?xml version="1.0"?><CDXML BondLength="14.4"><page id="100"/></CDXML>',
  );
  const out = chemDrawDocumentToCDXML({
    ...document,
    pages: [{ ...document.pages[0], objects: [object] }],
  });
  const arrow = /<arrow id="9"[^>]*>/.exec(out)?.[0] ?? '';
  assert.doesNotMatch(arrow, /ArrowheadHead|ArrowheadTail/);
  assert.match(arrow, /LineType="Dashed"/);
});

for (const [kind, degrees] of [
  ['arc-90', 90],
  ['arc-120', 120],
  ['arc-180', 180],
  ['arc-270', 270],
]) {
  test(`a ${degrees} degree arc bulges left of the drag and sweeps ${degrees} degrees`, () => {
    // Dragging left to right: the arc must bulge upward (convex), as in ChemDraw.
    const { object } = shapeForDrag(kind, '9', { x: 0, y: 0 }, { x: 100, y: 0 });
    assert.equal(object.angularSize, -degrees);
    const arc = resolveArcArrow(object);
    assert.ok(arc, 'the renderer must recognise it as an arc');
    assert.ok(Math.abs(Math.abs(arc.sweep) - (degrees * Math.PI) / 180) < 1e-6);
    const top = arcPointAt(arc, 0.5);
    assert.ok(top.y < 0, `midpoint should be above the chord, got y=${top.y}`);
    assert.ok(Math.abs(top.x - 50) < 1e-6);
    const end = arcPointAt(arc, 1);
    assert.ok(Math.hypot(end.x - 100, end.y) < 1e-6);
  });
}

test('dragging right to left gives the concave arc', () => {
  const { object } = shapeForDrag('arc-180', '9', { x: 100, y: 0 }, { x: 0, y: 0 });
  const top = arcPointAt(resolveArcArrow(object), 0.5);
  assert.ok(top.y > 0);
});

test('a drawn arc round-trips as a headless arrow carrying AngularSize', () => {
  const { object } = shapeForDrag('arc-120', '9', { x: 10, y: 50 }, { x: 90, y: 50 });
  const { document } = cdxmlToChemDrawDocument(
    '<?xml version="1.0"?><CDXML BondLength="14.4"><page id="100"/></CDXML>',
  );
  const out = chemDrawDocumentToCDXML({
    ...document,
    pages: [{ ...document.pages[0], objects: [object] }],
  });
  const arrow = /<arrow id="9"[^>]*>/.exec(out)?.[0] ?? '';
  assert.match(arrow, /AngularSize="-120"/);
  assert.match(arrow, /Center3D=/);
  assert.doesNotMatch(arrow, /ArrowheadHead|ArrowheadTail/);
  const reread = cdxmlToChemDrawDocument(out).document.pages[0].objects[0];
  assert.equal(reread.headEnd, 'none');
  assert.equal(reread.angularSize, -120);
});
