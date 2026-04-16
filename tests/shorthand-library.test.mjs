import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SUPPORTED_ALIAS_LIBRARY,
  getAliasLibraryIssues,
  getCanonicalAliasEntry,
  resolveAliasChemistry,
} from '../.unit-test-dist/src/lib/aliasChemistry.js';
import { AMINO_ACID_SHORTHANDS } from '../.unit-test-dist/src/lib/shorthand.js';

test('alias library metadata stays internally consistent', () => {
  assert.deepEqual(getAliasLibraryIssues(), []);
});

test('alias library entries resolve with the advertised support level', () => {
  assert.ok(SUPPORTED_ALIAS_LIBRARY.length > 0);

  for (const entry of SUPPORTED_ALIAS_LIBRARY) {
    const canonical = getCanonicalAliasEntry(entry.label);
    assert.ok(canonical, entry.label);
    assert.equal(canonical.lead, entry.lead, entry.label);
    assert.equal(Boolean(canonical.subsSmiles), entry.chemistryAvailable, entry.label);

    const resolution = resolveAliasChemistry(entry.label);
    if (!resolution.ok) continue;

    assert.equal(resolution.selected?.entry.lead, entry.lead, entry.label);
    assert.equal(Boolean(resolution.selected?.subsSmiles), entry.chemistryAvailable, entry.label);
    assert.equal(
      resolution.candidates.some((candidate) => candidate.semanticKind === 'coordination') &&
        resolution.selected?.semanticKind !== 'coordination',
      entry.hasCoordinationOption,
      entry.label,
    );
  }
});

test('alias library includes structure, ligand, and residue-backed structure entries', () => {
  const byLabel = new Map(SUPPORTED_ALIAS_LIBRARY.map((entry) => [entry.label, entry]));

  assert.equal(byLabel.get('OMe')?.support, 'structure');
  assert.equal(byLabel.get('py')?.support, 'coordination');
  assert.equal(byLabel.get('Ala')?.support, 'structure');
  assert.equal(byLabel.get('Ala')?.chemistryAvailable, true);
});

test('alias library support buckets stay internally consistent', () => {
  const seenLabels = new Set();

  for (const entry of SUPPORTED_ALIAS_LIBRARY) {
    assert.equal(seenLabels.has(entry.label), false, `duplicate library label: ${entry.label}`);
    seenLabels.add(entry.label);

    const resolution = resolveAliasChemistry(entry.label);
    assert.equal(resolution.ok, true, entry.label);

    if (entry.support === 'coordination') {
      assert.equal(resolution.selected?.semanticKind, 'coordination', entry.label);
      continue;
    }

    if (entry.support === 'structure') {
      assert.equal(entry.chemistryAvailable, true, entry.label);
      assert.notEqual(resolution.selected?.semanticKind, 'coordination', entry.label);
      assert.ok(resolution.selected?.subsSmiles, entry.label);
      continue;
    }

    assert.equal(entry.chemistryAvailable, false, entry.label);
    assert.equal(Boolean(resolution.selected?.subsSmiles), false, entry.label);
  }
});

test('amino acid shorthand entries remain residue-backed structure aliases', () => {
  const byLabel = new Map(SUPPORTED_ALIAS_LIBRARY.map((entry) => [entry.label, entry]));

  for (const label of AMINO_ACID_SHORTHANDS) {
    const libraryEntry = byLabel.get(label);
    assert.ok(libraryEntry, label);
    assert.equal(libraryEntry.support, 'structure', label);
    assert.equal(libraryEntry.chemistryAvailable, true, label);

    const resolution = resolveAliasChemistry(label);
    assert.equal(resolution.ok, true, label);
    assert.ok(resolution.selected?.entry.residueTemplateSmiles, label);
    assert.ok(resolution.selected?.subsSmiles, label);
  }
});
