import test from 'node:test';
import assert from 'node:assert/strict';
import { SHORTHAND_DATA } from '../.unit-test-dist/src/lib/shorthand.js';
import { resolveAliasChemistry } from '../.unit-test-dist/src/lib/aliasChemistry.js';
import { checkValence } from '../.unit-test-dist/src/lib/chemistry/valence.js';

// label -> [attachment element, substituent SMILES], as ChemDraw 26.1.0.6801 expands the label
// (read back from the nested <fragment> it saves; no charges, oxyl radicals written as [O]).
// NCO, NCS, SO2H, PO3H2, Cy and C2H5 agree with Ketcher's fg.sdf; the rest differ from it.
const EXPECTED = {
  NCO: ['N', 'N=C=O'],
  NCS: ['N', 'N=C=S'],
  Cy: ['C', 'C1CCCCC1'],
  C2H5: ['C', 'C(C)'],
  SO2H: ['S', 'S(=O)O'],
  SO3: ['S', 'S(=O)(=O)[O]'],
  SO4H: ['S', 'S(=O)(=O)OO'],
  SO4: ['S', 'S(=O)(=O)O[O]'],
  PO2: ['P', 'P(=O)=O'],
  PO3: ['P', 'P(=O)([O])[O]'],
  PO3H2: ['P', 'P(=O)(O)O'],
  PO4H2: ['P', 'P(=O)(O)OO'],
  PO4: ['P', 'P(=O)([O])O[O]'],
};

test('oxo-acid and heterocumulene labels resolve to the explicit structure', () => {
  for (const [label, [lead, smiles]] of Object.entries(EXPECTED)) {
    assert.equal(SHORTHAND_DATA[label]?.subsSmiles, smiles, label);
    assert.equal(SHORTHAND_DATA[label]?.lead, lead, `${label} lead is the attachment atom`);
    const resolved = resolveAliasChemistry(label);
    assert.equal(resolved.ok, true, `${label} resolves unambiguously: ${resolved.reason}`);
    assert.equal(resolved.selected.subsSmiles, smiles, label);
  }
});

// A small SMILES reader is not needed: the substituent strings above are checked for element
// valence by counting bonds on each heavy atom of the simple, ring-free ones.
function bondOrders(smiles) {
  const atoms = [];
  const stack = [];
  let last = null;
  let pendingOrder = 1;
  for (const token of smiles.match(/\[[^\]]+\]|=|#|\(|\)|[A-Z][a-z]?|[0-9]/g)) {
    if (token === '=') pendingOrder = 2;
    else if (token === '#') pendingOrder = 3;
    else if (token === '(') stack.push(last);
    else if (token === ')') last = stack.pop();
    else if (/^[0-9]$/.test(token)) continue;
    else {
      const bracket = token.startsWith('[');
      const element = bracket ? token.slice(1).match(/^[A-Z][a-z]?/)[0] : token;
      const charge = bracket ? (token.includes('-') ? -1 : token.includes('+') ? 1 : 0) : 0;
      const atom = { element, charge, sum: 0 };
      atoms.push(atom);
      if (last) {
        last.sum += pendingOrder;
        atom.sum += pendingOrder;
      }
      pendingOrder = 1;
      last = atom;
    }
  }
  return atoms;
}

test('every explicit substituent is valence-valid with one attachment bond', () => {
  for (const [label, [, smiles]] of Object.entries(EXPECTED)) {
    if (smiles.includes('1')) continue; // ring closures are not modelled by the reader
    const atoms = bondOrders(smiles);
    atoms[0].sum += 1; // the attachment bond
    for (const a of atoms)
      assert.ok(
        checkValence(a.element, a.charge, 0, a.sum).ok,
        `${label}: ${a.element} has bond order ${a.sum}`,
      );
  }
});
