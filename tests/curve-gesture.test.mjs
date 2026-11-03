import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createFreehandCurve,
  cubicsToCurvePoints,
  fitCurve,
  toggleCurveProperty,
} from '../.unit-test-dist/src/lib/curveGesture.js';
import {
  appendCurveSegment,
  findCurveHandle,
  moveCurveHandle,
} from '../.unit-test-dist/src/lib/curveEdit.js';
import {
  CURVE_TYPE,
  cubicPointAt,
  curveSegments,
} from '../.unit-test-dist/src/lib/curveGeometry.js';
import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';

const sine = Array.from({ length: 121 }, (_, i) => ({ x: i, y: 20 * Math.sin(i / 19) }));

test('a freehand path is fitted within tolerance by a few cubic pieces', () => {
  const cubics = fitCurve(sine, 1);
  assert.ok(cubics.length >= 1 && cubics.length <= 8, `${cubics.length} pieces`);
  for (const cubic of cubics) {
    for (let t = 0; t <= 1; t += 0.1) {
      const [p0, c1, c2, p3] = cubic;
      const point = cubicPointAt({ p0, c1, c2, p3 }, t);
      const nearest = Math.min(...sine.map((s) => Math.hypot(s.x - point.x, s.y - point.y)));
      assert.ok(nearest < 2.5, `fitted point ${JSON.stringify(point)} strays ${nearest}`);
    }
  }
});

test('the fit is written as ChemDraw anchor triples that redraw the same pieces', () => {
  const cubics = fitCurve(sine, 1);
  const points = cubicsToCurvePoints(cubics);
  assert.equal(points.length, 3 * (cubics.length + 1));
  const segments = curveSegments(points, false);
  assert.equal(segments.length, cubics.length);
  segments.forEach((segment, i) => {
    assert.deepEqual([segment.p0, segment.c1, segment.c2, segment.p3], cubics[i]);
  });
});

test('a pen drag makes an editable open curve; a tiny one makes nothing', () => {
  const curve = createFreehandCurve('5', sine);
  assert.equal(curve.graphicType, 'curve');
  assert.equal(curve.preservation.capability, 'editable');
  assert.equal(
    createFreehandCurve('6', [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ]),
    null,
  );
});

test('curve menu toggles write ChemDraw CurveType bits and arrowheads', () => {
  const curve = createFreehandCurve('5', sine);
  const closed = toggleCurveProperty(curve, 'closed');
  assert.equal(closed.curveType & CURVE_TYPE.closed, CURVE_TYPE.closed);
  const filled = toggleCurveProperty(closed, 'filled');
  assert.equal(filled.curveType, CURVE_TYPE.closed | CURVE_TYPE.filled);
  assert.equal(
    toggleCurveProperty(filled, 'shaded').curveType,
    CURVE_TYPE.closed | CURVE_TYPE.shaded,
  );
  const reopened = toggleCurveProperty(filled, 'closed');
  assert.equal(reopened.curveType, 0);

  const arrowed = toggleCurveProperty(toggleCurveProperty(curve, 'arrow-end'), 'arrow-start');
  assert.equal(arrowed.curveType, CURVE_TYPE.arrowAtEnd | CURVE_TYPE.arrowAtStart);
  const { document } = cdxmlToChemDrawDocument(
    '<?xml version="1.0"?><CDXML BondLength="14.4"><page id="100"/></CDXML>',
  );
  const out = chemDrawDocumentToCDXML({
    ...document,
    pages: [{ ...document.pages[0], objects: [{ ...arrowed, id: '9' }] }],
  });
  assert.match(
    /<curve id="9"[^>]*>/.exec(out)?.[0] ?? '',
    /CurveType="24" ArrowheadHead="Full" ArrowheadTail="Full" ArrowheadType="Solid"/,
  );
});

test('Edit Curve: anchors carry their direction lines, controls stay smooth, clicks extend', () => {
  const curve = createFreehandCurve('5', sine);
  const anchor = curve.points[1];
  assert.deepEqual(findCurveHandle([curve], { x: anchor.x + 1, y: anchor.y }, 3), {
    curveId: '5',
    index: 1,
  });
  const moved = moveCurveHandle(curve, 1, { x: anchor.x + 10, y: anchor.y + 5 });
  assert.ok(Math.abs(moved.points[0].x - curve.points[0].x - 10) < 1e-9);
  assert.ok(Math.abs(moved.points[2].y - curve.points[2].y - 5) < 1e-9);

  const reshaped = moveCurveHandle(curve, 5, { x: curve.points[4].x, y: curve.points[4].y - 30 });
  const [a, c_in, c_out] = [reshaped.points[4], reshaped.points[3], reshaped.points[5]];
  const cross = (c_in.x - a.x) * (c_out.y - a.y) - (c_in.y - a.y) * (c_out.x - a.x);
  assert.ok(Math.abs(cross) < 1e-6, 'direction lines stay collinear');

  const extended = appendCurveSegment(curve, { x: 200, y: 0 });
  assert.equal(extended.points.length, curve.points.length + 3);
  assert.deepEqual(extended.points.at(-2), { x: 200, y: 0 });
});

test('faded is FadePercent 300 and not a CurveType bit, and it reads and writes back', async () => {
  const { toggleCurveProperty } = await import('../.unit-test-dist/src/lib/curveGesture.js');
  const { fadedColor, fadeKept } = await import('../.unit-test-dist/src/lib/curveGeometry.js');
  const curve = { id: '1', type: 'graphic', graphicType: 'curve', curveType: 129 };
  const faded = toggleCurveProperty(curve, 'faded');
  assert.equal(faded.fadePercent, 300);
  assert.equal(faded.curveType & 0x80, 0, 'faded clears filled');
  assert.equal(toggleCurveProperty(faded, 'faded').fadePercent, undefined);
  // The grays ChemDraw 26.1.0.6801 filled a black curve with at FadePercent 100, 300, 500, 900.
  for (const [percent, gray] of [
    [100, 235],
    [300, 192],
    [500, 147],
    [900, 36],
  ]) {
    assert.equal(fadedColor('#000000', percent), `rgb(${gray}, ${gray}, ${gray})`, String(percent));
  }
  assert.equal(fadeKept(0), 0);
  assert.equal(fadeKept(1000), 1);
});
