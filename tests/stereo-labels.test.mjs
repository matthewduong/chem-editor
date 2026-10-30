import test from 'node:test';
import assert from 'node:assert/strict';
import initRDKitModule from '@rdkit/rdkit';

import { computeStereoLabels } from '../.unit-test-dist/src/lib/stereoLabels.js';

const atom = (id, element, x, y) => ({ id, x, y, kind: 'element', element });
const noAliases = () => undefined;

test('a wedged stereocentre is labelled, and its mirror image the other way', async () => {
  const rdkit = await initRDKitModule();
  // Canvas y grows downward: N above-left on a wedge, O below-left, methyl to the right.
  const draw = (sign) => [
    [
      atom('c', 'C', 0, 0),
      atom('m', 'C', sign * 30, 0),
      atom('n', 'N', -sign * 15, -26),
      atom('o', 'O', -sign * 15, 26),
    ],
    [
      { id: 'b1', from: 'c', to: 'm', order: 1 },
      { id: 'b2', from: 'c', to: 'n', order: 1, stereo: 1 },
      { id: 'b3', from: 'c', to: 'o', order: 1 },
    ],
  ];
  const right = computeStereoLabels(rdkit, ...draw(1), noAliases);
  const left = computeStereoLabels(rdkit, ...draw(-1), noAliases);
  assert.equal(right.atoms.get('c'), '(R)');
  assert.equal(left.atoms.get('c'), '(S)');
});

test('a drawn trans double bond is labelled E', async () => {
  const rdkit = await initRDKitModule();
  const atoms = [
    atom('a', 'C', 0, 0),
    atom('b', 'C', 26, -15),
    atom('c', 'C', 52, 0),
    atom('d', 'C', 78, -15),
  ];
  const bonds = [
    { id: 'x', from: 'a', to: 'b', order: 1 },
    { id: 'y', from: 'b', to: 'c', order: 2 },
    { id: 'z', from: 'c', to: 'd', order: 1 },
  ];
  const labels = computeStereoLabels(rdkit, atoms, bonds, noAliases);
  assert.equal(labels.bonds.get('y'), '(E)');
  assert.equal(labels.atoms.size, 0);
});

test('an SVG export draws the indicators when the view shows stereochemistry', async () => {
  const { generateCanvasSVGWithContext } = await import('../.unit-test-dist/src/lib/svgExport.js');
  const { DEFAULT_DOCUMENT_STYLE_SETTINGS, DEFAULT_DOCUMENT_VIEW_SETTINGS } =
    await import('../.unit-test-dist/src/lib/settings.js');
  const atoms = [atom('c', 'C', 100, 100), atom('m', 'C', 130, 100), atom('n', 'N', 85, 74)];
  const bonds = [
    { id: 'b1', from: 'c', to: 'm', order: 1 },
    { id: 'b2', from: 'c', to: 'n', order: 1 },
  ];
  const svg = (showStereochemistry) =>
    generateCanvasSVGWithContext(atoms, bonds, [], {
      chemDrawDocument: null,
      documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
      documentViewSettings: { ...DEFAULT_DOCUMENT_VIEW_SETTINGS, showStereochemistry },
      isDarkMode: false,
      stereoLabels: { atoms: new Map([['c', '(R)']]), bonds: new Map() },
    });
  assert.ok(svg(true).includes('(R)'));
  assert.ok(!svg(false).includes('(R)'));
});
