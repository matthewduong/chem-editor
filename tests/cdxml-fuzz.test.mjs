import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';

import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';

// Seeded so any failure reproduces: the failing seed and mutation are in the assertion message.
function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const FIXTURE_DIR = new URL('./fixtures/cdxml/', import.meta.url).pathname;
const fixtures = readdirSync(FIXTURE_DIR)
  .filter((name) => name.endsWith('.cdxml'))
  .map((name) => ({ name, xml: readFileSync(FIXTURE_DIR + name, 'utf8') }));

const BAD_VALUES = ['', 'NaN', 'Infinity', '-Infinity', '1e999', 'x y', '-1', '0', '99999999999'];

const mutations = [
  function corruptAttribute(xml, random) {
    const matches = [...xml.matchAll(/ ([A-Za-z]+)="([^"]*)"/g)];
    if (!matches.length) return xml;
    const m = matches[Math.floor(random() * matches.length)];
    const value = BAD_VALUES[Math.floor(random() * BAD_VALUES.length)];
    return xml.slice(0, m.index) + ` ${m[1]}="${value}"` + xml.slice(m.index + m[0].length);
  },
  function dropAttribute(xml, random) {
    const matches = [...xml.matchAll(/ [A-Za-z]+="[^"]*"/g)];
    if (!matches.length) return xml;
    const m = matches[Math.floor(random() * matches.length)];
    return xml.slice(0, m.index) + xml.slice(m.index + m[0].length);
  },
  function dropElement(xml, random) {
    const matches = [...xml.matchAll(/<(n|b|t|s|arrow|graphic|bracket)\b[^>]*\/>/g)];
    if (!matches.length) return xml;
    const m = matches[Math.floor(random() * matches.length)];
    return xml.slice(0, m.index) + xml.slice(m.index + m[0].length);
  },
  function duplicateElement(xml, random) {
    const matches = [...xml.matchAll(/<(n|b|arrow|graphic)\b[^>]*\/>/g)];
    if (!matches.length) return xml;
    const m = matches[Math.floor(random() * matches.length)];
    return xml.slice(0, m.index) + m[0] + m[0] + xml.slice(m.index + m[0].length);
  },
  function redirectReference(xml, random) {
    const ids = [...xml.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    const refs = [...xml.matchAll(/ (B|E)="([^"]+)"/g)];
    if (!ids.length || !refs.length) return xml;
    const m = refs[Math.floor(random() * refs.length)];
    const target = random() < 0.5 ? 'does-not-exist' : ids[Math.floor(random() * ids.length)];
    return xml.slice(0, m.index) + ` ${m[1]}="${target}"` + xml.slice(m.index + m[0].length);
  },
  function truncate(xml, random) {
    return xml.slice(0, Math.floor(xml.length * (0.1 + random() * 0.85)));
  },
  function flipByte(xml, random) {
    const at = Math.floor(random() * xml.length);
    const replacement = String.fromCharCode(32 + Math.floor(random() * 95));
    return xml.slice(0, at) + replacement + xml.slice(at + 1);
  },
];

// Set CDXML_FUZZ_TRACE=<file> to log each case before it runs; after a hang the last line names it.
const TRACE = process.env.CDXML_FUZZ_TRACE;
if (TRACE) writeFileSync(TRACE, '');

const ITERATIONS = Number(process.env.CDXML_FUZZ_ITERATIONS ?? 60);

for (const { name, xml } of fixtures) {
  test(`${name}: ${ITERATIONS} seeded mutations either import cleanly or fail with a named Error`, () => {
    for (let seed = 1; seed <= ITERATIONS; seed++) {
      const random = rng(seed * 7919 + name.length);
      let mutated = xml;
      const applied = [];
      for (let n = 0; n < 1 + Math.floor(random() * 3); n++) {
        const mutate = mutations[Math.floor(random() * mutations.length)];
        mutated = mutate(mutated, random);
        applied.push(mutate.name);
      }
      const label = `${name} seed=${seed} [${applied.join(', ')}]`;
      if (TRACE) appendFileSync(TRACE, `${label}\n`);
      let imported;
      try {
        imported = cdxmlToChemDrawDocument(mutated);
      } catch (error) {
        assert.ok(error instanceof Error, `${label}: threw a non-Error`);
        assert.ok(
          !(error instanceof TypeError || error instanceof RangeError),
          `${label}: leaked ${error.constructor.name}: ${error.message}`,
        );
        continue;
      }
      // Whatever imported must be exportable, finite, and re-importable: a bad file may be
      // rejected, but it must never become a document we then cannot save or reopen.
      let exported;
      try {
        exported = chemDrawDocumentToCDXML(imported.document);
      } catch (error) {
        assert.fail(`${label}: imported but could not export: ${error?.message}`);
      }
      // A preserved, unmodelled attribute may legitimately carry the source's own "NaN"; what
      // must never happen is the exporter minting non-finite numbers the input did not have.
      const nonFinite = (text) => (text.match(/NaN|Infinity/g) ?? []).length;
      assert.ok(
        nonFinite(exported) <= nonFinite(mutated),
        `${label}: exporter introduced a non-finite number (mutated input lines: ${mutated
          .split('\n')
          .filter((line) => !xml.includes(line))
          .slice(0, 2)
          .join(' | ')}):\n` +
          exported
            .split('\n')
            .filter((line) => /NaN|Infinity/.test(line) && !mutated.includes(line.trim()))
            .slice(0, 3)
            .join('\n'),
      );
      try {
        cdxmlToChemDrawDocument(exported);
      } catch (error) {
        assert.fail(`${label}: our own export does not re-import: ${error?.message}`);
      }
    }
  });
}
