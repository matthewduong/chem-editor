import test from 'node:test';
import assert from 'node:assert/strict';

import { orbitalOutlines, parseOrbitalType } from '../.unit-test-dist/src/lib/orbitalGeometry.js';
import { shapeForDrag } from '../.unit-test-dist/src/lib/shapeGesture.js';
import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';

test('an OrbitalType names a shape, a phase and a fill', () => {
  assert.deepEqual(parseOrbitalType('dz2PlusShaded'), {
    shape: 'dz2',
    phase: 'plus',
    fill: 'shaded',
  });
  assert.deepEqual(parseOrbitalType('sFilled'), { shape: 's', phase: null, fill: 'filled' });
  assert.equal(parseOrbitalType('mystery').shape, 'unknown');
});

test('p runs through its second point, the nucleus: a shaded lobe on the first side, a white one beyond', () => {
  const p = {
    id: 'o',
    type: 'graphic',
    graphicType: 'orbital',
    orbitalType: 'p',
    points: [
      { x: 0, y: 0 },
      { x: 0, y: 20 },
    ],
  };
  const outlines = orbitalOutlines(p);
  // 32 shaded slices of the first lobe, then the second lobe in white with its outline.
  assert.equal(outlines.length, 33);
  assert.equal(outlines[0].gray, 0);
  assert.equal(outlines[0].stroke, false);
  assert.equal(outlines[32].gray, 1);
  assert.equal(outlines[32].stroke, true);
  const ys = outlines.flatMap((o) => o.points.map((q) => q.y));
  assert.ok(
    Math.abs(Math.min(...ys) - 0) < 1e-6 && Math.abs(Math.max(...ys) - 40) < 0.01,
    'spans 2L',
  );
  // The same orbital types ChemDraw's DTD names all draw something.
  for (const type of [
    's',
    'oval',
    'lobe',
    'hybridPlus',
    'hybridMinus',
    'dz2Plus',
    'dxy',
    'sFilled',
  ]) {
    assert.ok(orbitalOutlines({ ...p, orbitalType: type }).length > 0, type);
  }
  assert.equal(orbitalOutlines({ ...p, orbitalType: 'dxyPlus' }).length, 4);
});

test('orbital tools write ChemDraw orbitals: s by axes, the rest nucleus to tip', () => {
  const s = shapeForDrag('orbital-s', '7', { x: 10, y: 10 }, { x: 20, y: 10 }).object;
  const p = shapeForDrag('orbital-p', '8', { x: 50, y: 10 }, { x: 50, y: 40 }).object;
  const click = shapeForDrag('orbital-lobe', '9', { x: 80, y: 40 }, { x: 80, y: 40 }, false, {
    orbitalSize: 12,
  }).object;
  assert.deepEqual(click.points[0], { x: 80, y: 28 });
  assert.deepEqual(click.points[1], { x: 80, y: 40 });
  const { document } = cdxmlToChemDrawDocument(
    '<?xml version="1.0"?><CDXML BondLength="14.4"><page id="100"/></CDXML>',
  );
  const out = chemDrawDocumentToCDXML({
    ...document,
    pages: [{ ...document.pages[0], objects: [s, p] }],
  });
  assert.match(
    out,
    /<graphic id="7"[^>]*GraphicType="Orbital" OrbitalType="sShaded" OvalType="Circle Shaded" Center3D=/,
  );
  assert.match(out, /<graphic id="8" BoundingBox="50 40 50 10"[^>]*OrbitalType="p"/);
});
