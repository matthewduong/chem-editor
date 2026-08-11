import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeAtom,
  setAliasAtomValue,
  setAtomValue,
} from '../.unit-test-dist/src/lib/atomIdentity.js';
import { measureAdvance } from '../.unit-test-dist/src/lib/textMetrics.js';
import {
  buildAliasResolutionSnapshot,
  expandAliasSmiles,
  getAliasChemistry,
  resolveAliasChemistry,
} from '../.unit-test-dist/src/lib/aliasChemistry.js';
import { expandSupportedAliasGraph } from '../.unit-test-dist/src/lib/aliasGraphExpansion.js';
import {
  findLeadElementDisplayRange,
  getAtomDisplayText,
  getColoredAtomDisplaySegments,
  inferAttachedElementFromSubsSmiles,
  segmentAtomDisplayText,
} from '../.unit-test-dist/src/lib/atomLabels.js';
import { graphToMolblock } from '../.unit-test-dist/src/lib/graph.js';
import {
  getAtomBondClipOffset,
  getAtomLabelLayoutMetrics,
  getBondVisualMetrics,
} from '../.unit-test-dist/src/lib/renderGeometry.js';
import {
  applyNodeValueEdit,
  canvasStateToChemDrawDocument,
  chemDrawDocumentToCanvasState,
} from '../.unit-test-dist/src/lib/chemdrawModel.js';
import { stateToCDXML } from '../.unit-test-dist/src/utils/cdxml.js';

function baseAtom(partial = {}) {
  return {
    id: 'a1',
    x: 10,
    y: 20,
    kind: 'element',
    element: 'C',
    ...partial,
  };
}

function baseState(atom) {
  return {
    atoms: [atom],
    bonds: [],
    arrows: [],
    groups: [],
    textBoxes: [],
  };
}

function baseBond(partial = {}) {
  return {
    id: 'b1',
    from: 'a1',
    to: 'a2',
    order: 1,
    ...partial,
  };
}

function makeFragmentLoader(molblocksBySmiles) {
  return {
    get_mol(smiles) {
      const molblock = molblocksBySmiles[smiles];
      if (!molblock) return null;
      return {
        set_new_coords() {},
        get_molblock() {
          return molblock;
        },
        delete() {},
      };
    },
  };
}

function makeMolblock({ atoms, bonds, charges = [] }) {
  const atomLine = ({ x, y, element, mapNum }) => {
    const prefix =
      `${x.toFixed(4).padStart(10)}${y.toFixed(4).padStart(10)}${'0.0000'.padStart(10)} ` +
      `${element.padEnd(3)}`;
    return `${prefix.padEnd(60, ' ')}${String(mapNum ?? '').padStart(3, ' ')}`;
  };
  const bondLine = ({ from, to, order }) =>
    `${String(from).padStart(3)}${String(to).padStart(3)}${String(order).padStart(3)}  0  0  0  0`;

  const lines = [
    '',
    '  RDKit          2D',
    '',
    `${String(atoms.length).padStart(3)}${String(bonds.length).padStart(3)}  0  0  0  0  0  0  0  0999 V2000`,
    ...atoms.map(atomLine),
    ...bonds.map(bondLine),
  ];

  if (charges.length > 0) {
    lines.push(
      `M  CHG${String(charges.length).padStart(3)}${charges
        .map(
          ({ atomIndex, charge }) =>
            `${String(atomIndex).padStart(4)}${String(charge).padStart(4)}`,
        )
        .join('')}`,
    );
  }

  lines.push('M  END', '');
  return lines.join('\n');
}

const documentStyleSettings = {
  bondLength: 45,
  bondLineWidth: 2,
  textFormat: {
    fontFamily: 'Arial',
    fontSize: 14,
    color: '#000000',
    textAlign: 'center',
  },
  colors: {
    bondColor: '#000000',
    atomColors: {},
    monochrome: false,
  },
};

test('setAtomValue assigns shorthand aliases their lead element', () => {
  const atom = setAtomValue(baseAtom(), 'OTBS');
  assert.equal(atom.kind, 'alias');
  assert.equal(atom.alias, 'OTBS');
  assert.equal(atom.element, 'O');
});

test('normalizeAtom repairs shorthand alias lead elements', () => {
  const atom = normalizeAtom(baseAtom({ kind: 'alias', alias: 'OTBS', element: 'C' }));
  assert.equal(atom.kind, 'alias');
  assert.equal(atom.alias, 'OTBS');
  assert.equal(atom.element, 'O');
});

test('setAtomValue infers chemistry for parseable formula aliases', () => {
  const atom = setAtomValue(baseAtom(), 'MgBr');
  assert.equal(atom.kind, 'alias');
  assert.equal(atom.alias, 'MgBr');
  assert.equal(atom.element, 'Mg');
});

test('setAliasAtomValue preserves canonical shorthand aliases that collide with element symbols', () => {
  const amyl = setAliasAtomValue(baseAtom(), 'Am');
  assert.equal(amyl.kind, 'alias');
  assert.equal(amyl.alias, 'Am');
  assert.equal(amyl.element, 'C');

  const dansyl = setAliasAtomValue(baseAtom(), 'Ds');
  assert.equal(dansyl.kind, 'alias');
  assert.equal(dansyl.alias, 'Ds');
  assert.equal(dansyl.element, 'S');
});

test('bonded shorthand aliases with withH labels render their bonded form', () => {
  const atom = { ...setAtomValue(baseAtom(), 'NTs'), labelOrientation: 'label-first' };
  const atoms = [atom, baseAtom({ id: 'a2', x: 40, element: 'C' })];
  const bonds = [baseBond({ to: 'a2' })];
  assert.equal(getAtomDisplayText(atom, atoms, bonds, 0).text, 'NHTs');
});

test('formula alias parsing is conservative', () => {
  assert.deepEqual(getAliasChemistry('MgBr'), {
    lead: 'Mg',
    valency: 1,
    subsSmiles: '[Mg](Br)',
  });
  assert.equal(getAliasChemistry('CO2'), undefined);
});

test('composite alias parser handles grouped and repeated branches', () => {
  assert.deepEqual(getAliasChemistry('SiMe3'), {
    lead: 'Si',
    valency: 1,
    subsSmiles: '[Si](C)(C)(C)',
  });
  assert.deepEqual(getAliasChemistry('P(OMe)2'), {
    lead: 'P',
    valency: 1,
    subsSmiles: 'P(O(C))(O(C))',
  });
  assert.deepEqual(getAliasChemistry('PPh3'), {
    lead: 'P',
    valency: 1,
    subsSmiles: 'P(c1ccccc1)(c1ccccc1)(c1ccccc1)',
  });
});

test('composite alias parser supports heteroatom formulas when topology is plausible', () => {
  assert.deepEqual(getAliasChemistry('SO2NH2'), {
    lead: 'S',
    valency: 1,
    subsSmiles: 'S(=O)(=O)(N([H])([H]))',
  });
  assert.deepEqual(getAliasChemistry('POCl3'), {
    lead: 'P',
    valency: 1,
    subsSmiles: 'P(=O)(Cl)(Cl)(Cl)',
  });
});

test('expanded alias smiles use parsed fragment definitions', () => {
  const expanded = expandAliasSmiles('C[Mg:1]', new Map([[1, 'MgBr']]));
  assert.equal(expanded, 'C[Mg](Br)');
});

test('mapped bracket atoms restore implicit hydrogens when preserving atom maps', () => {
  assert.equal(
    expandAliasSmiles('[C:1][C:2]', new Map(), {
      preserveAtomMaps: true,
      implicitHydrogensByMapNumber: new Map([
        [1, 3],
        [2, 3],
      ]),
    }),
    '[CH3:1][CH3:2]',
  );
});

test('mapped atom hydrogen restoration skips alias-expanded roots', () => {
  assert.equal(
    expandAliasSmiles('[C:1][CH3:2]', new Map([[2, 'CH3']]), {
      preserveAtomMaps: true,
      implicitHydrogensByMapNumber: new Map([
        [1, 3],
        [2, 3],
      ]),
    }),
    '[CH3:1][C:2]([H])([H])([H])',
  );
});

test('graphToMolblock does not treat plain element atoms as shorthand aliases', () => {
  const atoms = [
    { id: 'a1', x: 10, y: 10, kind: 'element', element: 'C' },
    { id: 'a2', x: 55, y: 10, kind: 'element', element: 'O' },
    { id: 'a3', x: 100, y: 10, kind: 'alias', element: 'C', alias: 'Me' },
  ];
  const bonds = [
    { id: 'b1', from: 'a1', to: 'a2', order: 1 },
    { id: 'b2', from: 'a2', to: 'a3', order: 1 },
  ];

  assert.deepEqual(Array.from(graphToMolblock(atoms, bonds, 200, 200).shorthandMap.entries()), [
    [3, 'Me'],
  ]);
  assert.equal(
    graphToMolblock(atoms.slice(0, 2), bonds.slice(0, 1), 200, 200, undefined, true).shorthandMap
      .size,
    0,
  );
});

test('supported alias components expand into full chemistry graphs before 3D generation', () => {
  const rdkit = makeFragmentLoader({
    '[Mg](Br)': [
      '',
      '  RDKit          2D',
      '',
      '  2  1  0  0  0  0  0  0  0  0999 V2000',
      '    0.0000    0.0000    0.0000 Mg  0  0  0  0  0  0  0  0  0  0  0  0',
      '    1.5000    0.0000    0.0000 Br  0  0  0  0  0  0  0  0  0  0  0  0',
      '  1  2  1  0  0  0  0',
      'M  END',
      '',
    ].join('\n'),
  });
  const resolveAliasEntry = (_atom, label) => resolveAliasChemistry(label).selected?.entry;
  const atoms = [
    { id: 'a1', x: 10, y: 10, kind: 'element', element: 'C' },
    { id: 'a2', x: 55, y: 10, kind: 'alias', element: 'Mg', alias: 'MgBr' },
  ];
  const bonds = [{ id: 'b1', from: 'a1', to: 'a2', order: 1 }];

  const expanded = expandSupportedAliasGraph(rdkit, atoms, bonds, resolveAliasEntry);
  assert.ok(expanded);
  assert.deepEqual(
    expanded.atoms.map((atom) => atom.element),
    ['C', 'Mg', 'Br'],
  );
  assert.deepEqual(
    expanded.bonds.map((bond) => [bond.from, bond.to, bond.order]),
    [
      ['a1', 'a2', 1],
      ['a2', 'a2::alias::1', 1],
    ],
  );
});

test('charged functional-group aliases preserve fragment charges when expanded', () => {
  const rdkit = makeFragmentLoader({
    '[N+](=O)[O-]': [
      '',
      '  RDKit          2D',
      '',
      '  3  2  0  0  0  0  0  0  0  0999 V2000',
      '    0.0000    0.0000    0.0000 N   0  0  0  0  0  0  0  0  0  0  0  0',
      '    1.2000    0.6000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
      '    1.2000   -0.6000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
      '  1  2  2  0  0  0  0',
      '  1  3  1  0  0  0  0',
      'M  CHG  2   1   1   3  -1',
      'M  END',
      '',
    ].join('\n'),
  });
  const resolveAliasEntry = (_atom, label) => resolveAliasChemistry(label).selected?.entry;
  const atoms = [{ id: 'a1', x: 20, y: 25, kind: 'alias', element: 'N', alias: 'NO2' }];

  const expanded = expandSupportedAliasGraph(rdkit, atoms, [], resolveAliasEntry);
  assert.ok(expanded);
  assert.equal(expanded.atoms[0].element, 'N');
  assert.equal(expanded.atoms[0].charge, 1);
  assert.equal(expanded.atoms[2].charge, -1);
});

test('amino acid residue aliases expand through their residue templates and reroute attachments', () => {
  const rdkit = makeFragmentLoader({
    '[N:1][C:3](C)[C:2](=O)': makeMolblock({
      atoms: [
        { x: -1.4, y: 0, element: 'N', mapNum: 1 },
        { x: 0, y: 0, element: 'C', mapNum: 3 },
        { x: 0, y: 1.2, element: 'C' },
        { x: 1.4, y: 0, element: 'C', mapNum: 2 },
        { x: 2.4, y: 0.6, element: 'O' },
      ],
      bonds: [
        { from: 1, to: 2, order: 1 },
        { from: 2, to: 3, order: 1 },
        { from: 2, to: 4, order: 1 },
        { from: 4, to: 5, order: 2 },
      ],
    }),
  });
  const resolveAliasEntry = (_atom, label) => resolveAliasChemistry(label).selected?.entry;
  const atoms = [
    { id: 'left', x: 10, y: 20, kind: 'element', element: 'N' },
    { id: 'ala', x: 55, y: 20, kind: 'alias', element: 'C', alias: 'Ala' },
    { id: 'right', x: 100, y: 20, kind: 'element', element: 'C' },
  ];
  const bonds = [
    { id: 'b-left', from: 'left', to: 'ala', order: 1 },
    { id: 'b-right', from: 'ala', to: 'right', order: 1 },
  ];

  const expanded = expandSupportedAliasGraph(rdkit, atoms, bonds, resolveAliasEntry);
  assert.ok(expanded);

  const root = expanded.atoms.find((atom) => atom.id === 'ala');
  assert.equal(root.element, 'C');
  assert.deepEqual(
    expanded.bonds.map((bond) => [bond.id, bond.from, bond.to, bond.order]),
    [
      ['b-left', 'left', 'ala::alias::0', 1],
      ['b-right', 'ala::alias::3', 'right', 1],
      ['ala::alias-bond::0', 'ala::alias::0', 'ala', 1],
      ['ala::alias-bond::1', 'ala', 'ala::alias::2', 1],
      ['ala::alias-bond::2', 'ala', 'ala::alias::3', 1],
      ['ala::alias-bond::3', 'ala::alias::3', 'ala::alias::4', 2],
    ],
  );
});

test('resolveAliasChemistry reports candidate sets and sources', () => {
  const shorthand = resolveAliasChemistry('NHBoc');
  assert.equal(shorthand.ok, true);
  assert.equal(shorthand.selected?.source, 'shorthand');

  const parsed = resolveAliasChemistry('SOCl2');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.selected?.subsSmiles, 'S(=O)(Cl)(Cl)');
  assert.equal(parsed.candidates.length >= 2, true);
});

test('resolveAliasChemistry can use validation to choose and reject candidates', () => {
  const selected = resolveAliasChemistry('SOCl2', {
    validateSmiles: (smiles) => {
      if (smiles === 'S(=O)(Cl)(Cl)') return { error: 'reject preferred candidate' };
      return { canonicalSmiles: smiles };
    },
  });
  assert.equal(selected.ok, true);
  assert.equal(selected.selected?.subsSmiles, 'S(=O(Cl)(Cl))');

  const invalid = resolveAliasChemistry('MgBr', {
    validateSmiles: () => ({ error: 'reject everything' }),
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.reason, 'chemically_invalid');
});

test('resolveAliasChemistry returns structured failures for unsupported labels', () => {
  const resolution = resolveAliasChemistry('not-a-label');
  assert.equal(resolution.ok, false);
  assert.equal(resolution.reason, 'unsupported_syntax');
});

test('implied attachment rewrites support common boron labels', () => {
  const resolution = resolveAliasChemistry('Bpin');
  assert.equal(resolution.ok, true);
  assert.equal(resolution.selected?.source, 'rewrite');
  assert.equal(resolution.selected?.subsSmiles, 'B1OC(C)(C)C(C)(C)O1');

  const diboron = resolveAliasChemistry('B(pin)2');
  assert.equal(diboron.ok, true);
  assert.equal(diboron.selected?.subsSmiles, 'B(O1C(C)(C)C(C)(C)O1)(O1C(C)(C)C(C)(C)O1)');
});

test('common coordination ligands resolve as non-covalent semantics', () => {
  const resolution = resolveAliasChemistry('Cp*');
  assert.equal(resolution.ok, true);
  assert.equal(resolution.selected?.semanticKind, 'coordination');
  assert.equal(getAliasChemistry('Cp*'), undefined);
});

test('reverse shorthand labels and leading-hydrogen labels resolve through the registry', () => {
  assert.equal(getAliasChemistry('TfO')?.lead, 'O');
  assert.equal(getAliasChemistry('TfO')?.subsSmiles, 'O(S(=O)(=O)C(F)(F)F)');
  assert.equal(getAliasChemistry('BocNH')?.lead, 'N');
  assert.equal(getAliasChemistry('BocNH')?.subsSmiles, 'N(C(=O)OC(C)(C)C)');
  assert.deepEqual(getAliasChemistry('H2N'), {
    lead: 'N',
    valency: 1,
    subsSmiles: 'N([H])([H])',
  });
});

test('parseable phosphine ligands keep covalent chemistry available while offering ligand semantics', () => {
  const resolution = resolveAliasChemistry('PPh3');
  assert.equal(resolution.ok, true);
  assert.equal(resolution.selected?.semanticKind, 'covalent');
  assert.equal(
    resolution.candidates.some((candidate) => candidate.semanticKind === 'coordination'),
    true,
  );
});

test('atom display segmentation colors concatenated element labels by token', () => {
  assert.deepEqual(segmentAtomDisplayText('MgBr'), [
    { text: 'Mg', element: 'Mg' },
    { text: 'Br', element: 'Br' },
  ]);
  assert.deepEqual(segmentAtomDisplayText('SO2NH2'), [
    { text: 'S', element: 'S' },
    { text: 'O2', element: 'O' },
    { text: 'N', element: 'N' },
    { text: 'H2', element: 'H' },
  ]);
});

test('functional-group alias coloring uses the attached atom for non-lead text', () => {
  assert.equal(inferAttachedElementFromSubsSmiles('O([Si](C)(C)C(C)(C)C)'), 'Si');
  assert.equal(inferAttachedElementFromSubsSmiles('N(C(=O)OC(C)(C)C)'), 'C');

  assert.deepEqual(
    getColoredAtomDisplaySegments(baseAtom({ kind: 'alias', element: 'O', alias: 'OTBS' }), 'OTBS'),
    [
      { text: 'O', element: 'O' },
      { text: 'TBS', element: 'Si' },
    ],
  );
  assert.deepEqual(
    getColoredAtomDisplaySegments(
      baseAtom({ kind: 'alias', element: 'N', alias: 'BocNH' }),
      'BocNH',
    ),
    [
      { text: 'Boc', element: 'C' },
      { text: 'N', element: 'N' },
      { text: 'H', element: 'H' },
    ],
  );
});

test('lead element detection works whether hydrogens are leading or trailing', () => {
  assert.deepEqual(findLeadElementDisplayRange('NH2', 'N'), { start: 0, end: 1 });
  assert.deepEqual(findLeadElementDisplayRange('H2N', 'N'), { start: 2, end: 3 });
  assert.equal(findLeadElementDisplayRange('Cl', 'Cl'), null);
});

/**
 * Clip distance for a single lead element, derived rather than hardcoded.
 *
 * The label half-box is measured text width / 2 + 1, and the half-height comes from the label
 * cap height; the clip radius is the geometric mean of the two. Deriving it keeps these tests
 * meaningful when the font metrics change, while still failing if the *shape* of the geometry
 * changes.
 */
function leadElementClip(text, fontSize) {
  const halfWidth = measureAdvance(text, { family: 'Arial', sizePx: fontSize }) / 2 + 1;
  const halfHeight = Math.max(14, fontSize * 0.72) / 2 + 1;
  return Math.sqrt(halfWidth * halfHeight);
}

test('bond clipping targets the lead element for trailing hydrogens', () => {
  const atoms = [
    baseAtom({ id: 'a1', x: 0, y: 0, element: 'C' }),
    baseAtom({ id: 'a2', x: 45, y: 0, element: 'N', labelFontSize: 16 }),
  ];
  const bonds = [baseBond()];

  const clip = getAtomBondClipOffset(atoms[1], atoms, bonds, -1, 0);
  assert.ok(Math.abs(clip - leadElementClip('N', 16)) < 1e-9);
});

test('bond clipping targets the lead element for leading hydrogens', () => {
  const atoms = [
    baseAtom({ id: 'a1', x: 0, y: 0, element: 'N', labelFontSize: 16 }),
    baseAtom({ id: 'a2', x: 45, y: 0, element: 'C' }),
  ];
  const bonds = [baseBond()];

  const clip = getAtomBondClipOffset(atoms[0], atoms, bonds, 1, 0);
  assert.ok(Math.abs(clip - leadElementClip('N', 16)) < 1e-9);
});

test('bond clipping uses the lead element token for known shorthand aliases', () => {
  const atom = baseAtom({ kind: 'alias', element: 'N', alias: 'BocNH', labelFontSize: 16 });
  const clip = getAtomBondClipOffset(atom, [atom], [], 1, 0);

  assert.ok(Math.abs(clip - leadElementClip('N', 16)) < 1e-9);
});

test('bond clipping falls back to the full label box when no lead token is present', () => {
  const atom = baseAtom({ kind: 'alias', element: 'C', alias: 'foo', labelFontSize: 16 });
  const clip = getAtomBondClipOffset(atom, [atom], [], 1, 0);

  // 'foo' measures ~21px at 16px, under the 22px minimum label box, so the clip comes from the
  // minimum rather than the text. The old 0.75em-per-character estimate put it at 36px.
  assert.ok(Math.abs(clip - 12.12109375) < 1e-6, `clip was ${clip}`);
});

test('single-token element labels retain their existing bond clip width', () => {
  const atoms = [
    baseAtom({ id: 'a1', x: 0, y: 0, element: 'C' }),
    baseAtom({ id: 'a2', x: 45, y: 0, element: 'Cl', labelFontSize: 16 }),
  ];
  const bonds = [baseBond()];
  const clip = getAtomBondClipOffset(atoms[1], atoms, bonds, -1, 0);

  // 'Cl' has no lead-element sub-range, so it uses the full label box, which the 22px minimum
  // width dominates. The old estimator overstated 'Cl' as 24px wide.
  assert.equal(clip, 12);
});

test('single-letter element labels use the lead element clip width', () => {
  const atoms = [
    baseAtom({ id: 'a1', x: 0, y: 0, element: 'C' }),
    baseAtom({ id: 'a2', x: 45, y: 0, element: 'O', labelFontSize: 16 }),
  ];
  const bonds = [baseBond({ order: 2 })];
  const clip = getAtomBondClipOffset(atoms[1], atoms, bonds, -1, 0);

  assert.ok(Math.abs(clip - leadElementClip('O', 16)) < 1e-9);
});

test('bond clipping scales with larger atom label sizes', () => {
  const atoms = [
    baseAtom({ id: 'a1', x: 0, y: 0, element: 'C' }),
    baseAtom({ id: 'a2', x: 45, y: 0, element: 'O', labelFontSize: 20 }),
  ];
  const bonds = [baseBond({ order: 2 })];
  const clip = getAtomBondClipOffset(atoms[1], atoms, bonds, -1, 0);

  assert.ok(Math.abs(clip - leadElementClip('O', 20)) < 1e-9);
});

test('atom label layout metrics scale atom adornments with font size', () => {
  const small = getAtomLabelLayoutMetrics(16, 22);
  const large = getAtomLabelLayoutMetrics(24, 33);

  assert.ok(large.hoverRadius > small.hoverRadius);
  assert.ok(small.hoverRadius < small.boxWidth / 2);
  assert.ok(large.chargeFontSize > small.chargeFontSize);
  assert.ok(large.electronDistance > small.electronDistance);
  assert.ok(large.queryPadX >= small.queryPadX);
});

test('bond visual metrics scale with line width', () => {
  const thin = getBondVisualMetrics(2, 45);
  const thick = getBondVisualMetrics(4, 45);

  assert.ok(thick.parallelOffset > thin.parallelOffset);
  assert.ok(thick.boldWidth > thin.boldWidth);
  assert.ok(thick.dativeHeadSize > thin.dativeHeadSize);
});

test('atom label layout metrics scale charge and lone-pair geometry with font size', () => {
  const metrics = getAtomLabelLayoutMetrics(20, 27.5);

  assert.equal(metrics.chargeFontSize, 11);
  assert.equal(metrics.electronDotRadius, 2.2);
  assert.equal(metrics.electronDistance, 15);
});

test('resolution snapshots preserve chosen candidates', () => {
  const resolution = resolveAliasChemistry('SOCl2', {
    preferredCandidateId: 'SOCl2::parsed::covalent::S(=O(Cl)(Cl))',
  });
  const snapshot = buildAliasResolutionSnapshot(resolution);
  assert.equal(snapshot?.selectedCandidateId, 'SOCl2::parsed::covalent::S(=O(Cl)(Cl))');
});

test('ChemDraw document round-trip preserves alias nodes', () => {
  const initialState = baseState(
    baseAtom({
      kind: 'alias',
      element: 'O',
      alias: 'OTBS',
      labelRuns: [
        { text: 'O', color: '#ff0000' },
        { text: 'TBS', color: '#0000ff' },
      ],
      aliasResolution: {
        status: 'resolved',
        selectedCandidateId: 'OTBS::shorthand::covalent::O([Si](C)(C)C(C)(C)C)',
        semanticKind: 'covalent',
      },
    }),
  );
  const document = canvasStateToChemDrawDocument(initialState).document;
  const roundTrip = chemDrawDocumentToCanvasState(document).state.atoms[0];

  assert.equal(roundTrip.kind, 'alias');
  assert.equal(roundTrip.alias, 'OTBS');
  assert.equal(roundTrip.element, 'O');
  assert.deepEqual(roundTrip.labelRuns, [
    { text: 'O', color: '#ff0000' },
    { text: 'TBS', color: '#0000ff' },
  ]);
  assert.equal(
    roundTrip.aliasResolution?.selectedCandidateId,
    'OTBS::shorthand::covalent::O([Si](C)(C)C(C)(C)C)',
  );
});

test('native node value edits compute alias resolution snapshots automatically', () => {
  const initialState = baseState(baseAtom());
  const initialDocument = canvasStateToChemDrawDocument(initialState).document;
  const nextDocument = applyNodeValueEdit(initialDocument, 'a1', 'BocNH');
  const roundTrip = chemDrawDocumentToCanvasState(nextDocument).state.atoms[0];

  assert.equal(roundTrip.alias, 'BocNH');
  assert.equal(roundTrip.aliasResolution?.status, 'resolved');
  assert.equal(roundTrip.aliasResolution?.selectedLabel, 'BocNH');
});

test('CDXML export preserves custom alias text without inventing chemistry', () => {
  const initialState = baseState(baseAtom({ kind: 'alias', element: 'C', alias: 'MgBr' }));
  const cdxml = stateToCDXML(initialState, { documentStyleSettings });
  assert.match(cdxml, />MgBr</);
  assert.doesNotMatch(cdxml, /Element="/);
});
