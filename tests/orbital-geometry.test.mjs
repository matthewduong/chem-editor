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

test('lobed orbitals run from the nucleus: p has a lobe on each side of it', () => {
  const p = {
    id: 'o',
    type: 'graphic',
    graphicType: 'orbital',
    orbitalType: 'pShaded',
    points: [
      { x: 0, y: 0 },
      { x: 0, y: -20 },
    ],
  };
  const [front, back] = orbitalOutlines(p);
  assert.equal(front.fill, 'shaded');
  assert.equal(back.fill, 'open');
  assert.ok(Math.min(...front.points.map((q) => q.y)) < -19);
  assert.ok(Math.max(...back.points.map((q) => q.y)) > 19);
  assert.equal(orbitalOutlines({ ...p, orbitalType: 'dxyPlus' }).length, 4);
});

test('orbital tools write ChemDraw orbitals: s by axes, the rest nucleus to tip', () => {
  const s = shapeForDrag('orbital-s', '7', { x: 10, y: 10 }, { x: 20, y: 10 }).object;
  const p = shapeForDrag('orbital-p', '8', { x: 50, y: 10 }, { x: 50, y: 40 }).object;
  const click = shapeForDrag('orbital-lobe', '9', { x: 80, y: 40 }, { x: 80, y: 40 }, false, {
    orbitalSize: 12,
  }).object;
  assert.deepEqual(click.points[1], { x: 80, y: 28 });
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
  assert.match(out, /<graphic id="8" BoundingBox="50 10 50 40"[^>]*OrbitalType="pShaded"/);
});
