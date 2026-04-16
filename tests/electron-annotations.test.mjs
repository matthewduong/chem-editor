import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyElectronToolToAtom,
  getAtomElectronAnnotations,
  getAtomElectronMarkerGeometry,
  updateAtomElectronMarkerAngle,
} from '../.unit-test-dist/src/lib/electronAnnotations.js';
import {
  canvasStateToChemDrawDocument,
  chemDrawDocumentToCanvasState,
} from '../.unit-test-dist/src/lib/chemdrawModel.js';
import { stateToCDXML } from '../.unit-test-dist/src/utils/cdxml.js';

test('single-bond oxygen allows two lone pairs and one radical', () => {
  const oxygen = { id: 'o1', x: 0, y: 0, kind: 'element', element: 'O' };
  const bonds = [{ id: 'b1', from: 'o1', to: 'c1', order: 1 }];

  const pair1 = applyElectronToolToAtom(oxygen, bonds, 'lone-pair-add');
  const pair2 = applyElectronToolToAtom(pair1.atom, bonds, 'lone-pair-add');
  const radical = applyElectronToolToAtom(pair2.atom, bonds, 'radical');
  const extraPair = applyElectronToolToAtom(radical.atom, bonds, 'lone-pair-add');

  assert.equal(pair1.changed, true);
  assert.equal(pair2.changed, true);
  assert.equal(radical.changed, true);
  assert.deepEqual(getAtomElectronAnnotations(radical.atom), {
    lonePairs: 2,
    radicalElectrons: 1,
  });
  assert.equal(extraPair.changed, false);
});

test('three-coordinate neutral nitrogen allows one lone pair but blocks a second', () => {
  const nitrogen = { id: 'n1', x: 0, y: 0, kind: 'element', element: 'N' };
  const bonds = [
    { id: 'b1', from: 'n1', to: 'c1', order: 1 },
    { id: 'b2', from: 'n1', to: 'c2', order: 1 },
    { id: 'b3', from: 'n1', to: 'c3', order: 1 },
  ];

  const pair1 = applyElectronToolToAtom(nitrogen, bonds, 'lone-pair-add');
  const pair2 = applyElectronToolToAtom(pair1.atom, bonds, 'lone-pair-add');

  assert.equal(pair1.changed, true);
  assert.deepEqual(getAtomElectronAnnotations(pair1.atom), {
    lonePairs: 1,
    radicalElectrons: 0,
  });
  assert.equal(pair2.changed, false);
  assert.match(pair2.message ?? '', /cannot accept another lone pair/i);
});

test('changing charge sanitizes lone-pair annotations to the new electron budget', () => {
  const oxygen = {
    id: 'o1',
    x: 0,
    y: 0,
    kind: 'element',
    element: 'O',
    lonePairs: 3,
  };
  const bonds = [{ id: 'b1', from: 'o1', to: 'c1', order: 1 }];

  const charged = applyElectronToolToAtom(oxygen, bonds, 'charge-positive');

  assert.equal(charged.changed, true);
  assert.equal(charged.atom.charge, 1);
  assert.deepEqual(getAtomElectronAnnotations(charged.atom), {
    lonePairs: 2,
    radicalElectrons: 0,
  });
});

test('lone-pair angles can be rotated and removal keeps the remaining marker angles', () => {
  const oxygen = {
    id: 'o1',
    x: 0,
    y: 0,
    kind: 'element',
    element: 'O',
    lonePairs: 2,
    electronAngles: [-Math.PI / 2, 0],
  };

  const rotated = updateAtomElectronMarkerAngle(oxygen, 0, Math.PI);
  const markers = getAtomElectronMarkerGeometry(rotated, {
    centerX: 0,
    centerY: 0,
    distance: 10,
    pairSpacing: 2,
  });
  const removed = applyElectronToolToAtom(rotated, [], 'lone-pair-remove');

  assert.equal(rotated.electronAngles.length, 2);
  assert.ok(Math.abs(rotated.electronAngles[0] - Math.PI) < 1e-9);
  assert.ok(Math.abs(markers[0].center.x + 10) < 1e-9);
  assert.ok(Math.abs(markers[0].center.y) < 1e-9);
  assert.equal(removed.changed, true);
  assert.deepEqual(removed.atom.electronAngles, [Math.PI]);
});

test('removing a lone pair reports when none are present', () => {
  const nitrogen = { id: 'n1', x: 0, y: 0, kind: 'element', element: 'N' };
  const removed = applyElectronToolToAtom(nitrogen, [], 'lone-pair-remove');

  assert.equal(removed.changed, false);
  assert.match(removed.message ?? '', /does not have a lone pair to remove/i);
});

test('ChemDraw model round-trips lone pairs and radicals independently', () => {
  const state = {
    atoms: [
      {
        id: 'o1',
        x: 10,
        y: 20,
        kind: 'element',
        element: 'O',
        lonePairs: 2,
        radicalElectrons: 1,
        electronAngles: [-Math.PI / 2, Math.PI / 2, 0],
      },
    ],
    bonds: [],
    arrows: [],
    textBoxes: [],
  };

  const { document } = canvasStateToChemDrawDocument(state);
  const node = document.pages[0].objects.find((object) => object.type === 'node');
  assert.equal(node?.lonePairCount, 2);
  assert.equal(node?.radicalElectrons, 1);
  assert.deepEqual(node?.electronAngles, [-Math.PI / 2, Math.PI / 2, 0]);

  const roundTrip = chemDrawDocumentToCanvasState(document).state;
  assert.equal(roundTrip.atoms[0].lonePairs, 2);
  assert.equal(roundTrip.atoms[0].radicalElectrons, 1);
  assert.deepEqual(roundTrip.atoms[0].electronAngles, [-Math.PI / 2, Math.PI / 2, 0]);
});

test('legacy electron counts export as lone pairs instead of fake radicals', () => {
  const state = {
    atoms: [{ id: 'o1', x: 0, y: 0, kind: 'element', element: 'O', electrons: 2 }],
    bonds: [],
    arrows: [],
    textBoxes: [],
  };

  const { document } = canvasStateToChemDrawDocument(state);
  const node = document.pages[0].objects.find((object) => object.type === 'node');
  assert.equal(node?.lonePairCount, 1);
  assert.equal(node?.radicalElectrons, undefined);
});

test('CDXML export emits lone pairs separately from radicals', () => {
  const xml = stateToCDXML({
    atoms: [
      {
        id: 'o1',
        x: 10,
        y: 20,
        kind: 'element',
        element: 'O',
        lonePairs: 2,
        radicalElectrons: 1,
        electronAngles: [-Math.PI / 2, Math.PI / 2, 0],
      },
    ],
    bonds: [],
    arrows: [],
    textBoxes: [],
  });

  assert.match(xml, /LonePairCount="2"/);
  assert.match(xml, /Radical="Doublet"/);
  assert.match(xml, /ChemEditorElectronAngles="\[[^"]+\]"/);
});
