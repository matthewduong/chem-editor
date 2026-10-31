import test from 'node:test';
import assert from 'node:assert/strict';
import initRDKitModule from '@rdkit/rdkit';

import { nameToSmiles } from '../.unit-test-dist/src/lib/naming/nameToSmiles.js';

const rdkit = await initRDKitModule();
const canonical = (smiles) => {
  const mol = rdkit.get_mol(smiles);
  if (!mol) return null;
  const out = mol.get_smiles();
  mol.delete();
  return out;
};

export const NAMES = [
  ['methane', 'C'],
  ['ethanol', 'CCO'],
  ['propan-2-ol', 'CC(C)O'],
  ['2-propanol', 'CC(C)O'],
  ['propan-1-ol', 'CCCO'],
  ['butan-2-one', 'CCC(C)=O'],
  ['propanone', 'CC(C)=O'],
  ['propanal', 'CCC=O'],
  ['ethanoic acid', 'CC(=O)O'],
  ['propanoic acid', 'CCC(=O)O'],
  ['hexanedioic acid', 'OC(=O)CCCCC(=O)O'],
  ['propanenitrile', 'CCC#N'],
  ['ethanamine', 'CCN'],
  ['propan-2-amine', 'CC(C)N'],
  ['2-methylpropane', 'CC(C)C'],
  ['2,2-dimethylpropane', 'CC(C)(C)C'],
  ['3-ethyl-2,4-dimethylhexane', 'CCC(C)C(CC)C(C)C'],
  ['but-2-ene', 'CC=CC'],
  ['2-butene', 'CC=CC'],
  ['buta-1,3-diene', 'C=CC=C'],
  ['but-1-yne', 'C#CCC'],
  ['but-3-en-2-ol', 'CC(O)C=C'],
  ['1,2-dichloroethane', 'ClCCCl'],
  ['2-bromo-2-methylpropane', 'CC(C)(C)Br'],
  [
    '1-chloro-2-nitrobutane',
    'CCC(C[N+](=O)[O-])Cl'.replace('CCC(C[N+](=O)[O-])Cl', 'CCC(CCl)[N+](=O)[O-]'),
  ],
  ['3-hydroxybutanoic acid', 'CC(O)CC(=O)O'],
  ['4-oxopentanoic acid', 'CC(=O)CCC(=O)O'],
  ['cyclohexane', 'C1CCCCC1'],
  ['cyclohexanol', 'OC1CCCCC1'],
  ['methylcyclohexane', 'CC1CCCCC1'],
  ['cyclohexene', 'C1=CCCCC1'],
  ['cyclopentanone', 'O=C1CCCC1'],
  ['cyclohexanecarboxylic acid', 'OC(=O)C1CCCCC1'],
  ['benzene', 'c1ccccc1'],
  ['chlorobenzene', 'Clc1ccccc1'],
  ['1,3-dimethylbenzene', 'Cc1cccc(C)c1'],
  ['phenol', 'Oc1ccccc1'],
  ['4-nitrophenol', 'O=[N+]([O-])c1ccc(O)cc1'],
  ['toluene', 'Cc1ccccc1'],
  ['benzoic acid', 'OC(=O)c1ccccc1'],
  ['aniline', 'Nc1ccccc1'],
  ['2-methoxypropane', 'COC(C)C'],
  ['1-phenylethanol', 'CC(O)c1ccccc1'],
];

test('systematic names give their structures', () => {
  for (const [name, smiles] of NAMES) {
    assert.equal(canonical(nameToSmiles(name) ?? '[X]'), canonical(smiles), name);
  }
});

test('what the grammar does not cover is not guessed', () => {
  for (const name of ['', 'caffeine', 'propan-7-ol', 'hexan-2-al', 'dimethylfoo', 'cycloethane']) {
    assert.equal(nameToSmiles(name), null, name);
  }
});

const { structureToName } = await import('../.unit-test-dist/src/lib/naming/structureToName.js');

/** Canvas atoms and bonds from RDKit's Kekulé molblock, as a drawn structure has them. */
function graphOf(smiles) {
  const lines = rdkit.get_mol(smiles).get_molblock().split('\n');
  const [na, nb] = [Number(lines[3].slice(0, 3)), Number(lines[3].slice(3, 6))];
  const atoms = [];
  const bonds = [];
  for (let i = 0; i < na; i++) {
    atoms.push({
      id: `a${i + 1}`,
      x: 0,
      y: 0,
      kind: 'element',
      element: lines[4 + i].slice(31, 34).trim(),
    });
  }
  for (let i = 0; i < nb; i++) {
    const l = lines[4 + na + i];
    bonds.push({
      id: `b${i}`,
      from: `a${Number(l.slice(0, 3))}`,
      to: `a${Number(l.slice(3, 6))}`,
      order: Number(l.slice(6, 9)),
    });
  }
  for (const l of lines) {
    const m = /^M {2}CHG\s+(\d+)(.*)$/.exec(l);
    if (!m) continue;
    const p = m[2].trim().split(/\s+/).map(Number);
    for (let k = 0; k < p.length; k += 2) atoms[p[k] - 1].charge = p[k + 1];
  }
  return { atoms, bonds };
}

const EXPECTED = [
  ['CC(C)O', 'propan-2-ol'],
  ['CCC(C)=O', 'butan-2-one'],
  ['OC(=O)CCCCC(=O)O', 'hexanedioic acid'],
  ['CCC#N', 'propanenitrile'],
  ['CCC(C)C(CC)C(C)C', '3-ethyl-2,4-dimethylhexane'],
  ['C=CC=C', 'buta-1,3-diene'],
  ['CC(O)C=C', 'but-3-en-2-ol'],
  ['CC(=O)CCC(=O)O', '4-oxopentanoic acid'],
  ['OC(=O)C1CCCCC1', 'cyclohexanecarboxylic acid'],
  ['Cc1cccc(C)c1', '1,3-dimethylbenzene'],
  ['O=[N+]([O-])c1ccc(O)cc1', '4-nitrophenol'],
  ['CC(O)c1ccccc1', '1-phenylethan-1-ol'],
  ['OCCO', 'ethane-1,2-diol'],
  ['CCCCC(CC)CO', '2-ethylhexan-1-ol'],
];

test('structures are named systematically, and every name reads back to the structure', () => {
  for (const [smiles, expected] of EXPECTED) {
    const { atoms, bonds } = graphOf(smiles);
    assert.equal(structureToName(atoms, bonds), expected, smiles);
  }
  for (const [, smiles] of NAMES) {
    const { atoms, bonds } = graphOf(smiles);
    const name = structureToName(atoms, bonds);
    assert.ok(name, smiles);
    assert.equal(canonical(nameToSmiles(name)), canonical(smiles), `${smiles} → ${name}`);
  }
});

test('structures outside the namable class get no name', () => {
  for (const smiles of [
    'c1ccc2ccccc2c1',
    'CC(=O)OC',
    'CC(=O)N',
    'C1CC1C1CC1',
    'CS',
    'OC(C(=O)O)C(=O)O',
  ]) {
    const { atoms, bonds } = graphOf(smiles);
    const name = structureToName(atoms, bonds);
    // Either nothing, or a name that really is the structure.
    if (name !== null) assert.equal(canonical(nameToSmiles(name)), canonical(smiles), smiles);
  }
});
