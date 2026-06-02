import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { stateToCDXML, chemDrawDocumentToCDXML } from '../.unit-test-dist/src/utils/cdxml.js';
import { canvasStateToChemDrawDocument } from '../.unit-test-dist/src/lib/chemdrawModel.js';

function resolveXmlLintPath() {
  const result = spawnSync('which', ['xmllint'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  const resolved = (result.stdout ?? '').trim().split('\n')[0];
  return resolved || null;
}

const XMLLINT = resolveXmlLintPath();

function validateXml(xml, label) {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'cdxml-roundtrip-'));
  const tmp = join(tmpRoot, 'output.cdxml');
  try {
    writeFileSync(tmp, xml, 'utf8');
    execFileSync(XMLLINT, ['--noout', tmp], { stdio: 'pipe' });
  } catch (err) {
    const stderr = err.stderr?.toString() ?? '';
    const details = stderr.trim() ? stderr : err.message;
    assert.fail(
      `${label}: xmllint rejected output\n${details}\n\nFirst 2000 chars of output:\n${xml.slice(0, 2000)}`,
    );
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

// Representative canvas state: atoms, bonds (including wedge/hash), a reaction
// arrow (no label), an equilibrium arrow (with label), a curved arrow, and a
// free-text box. This exercises the full export path including the self-closing
// <arrow .../> tag that was previously malformed (missing '>').
const REPRESENTATIVE_STATE = {
  atoms: [
    { id: 'a1', x: 10, y: 20, kind: 'element', element: 'C' },
    { id: 'a2', x: 20, y: 20, kind: 'element', element: 'O' },
    { id: 'a3', x: 30, y: 20, kind: 'element', element: 'N', charge: 1 },
    { id: 'a4', x: 50, y: 20, kind: 'alias', element: 'C', alias: 'Ph' },
    { id: 'a5', x: 60, y: 20, kind: 'element', element: 'C' },
  ],
  bonds: [
    { id: 'b1', from: 'a1', to: 'a2', order: 1 },
    { id: 'b2', from: 'a2', to: 'a3', order: 2 },
    { id: 'b3', from: 'a4', to: 'a5', order: 1, stereo: 1 }, // wedge
  ],
  arrows: [
    // Reaction arrow — no label (exercises the self-closing tag path)
    { id: 'ar1', type: 'reaction', x1: 10, y1: 50, x2: 30, y2: 50, cpx: 20, cpy: 50 },
    // Equilibrium arrow — with label (exercises the open/close tag path)
    {
      id: 'ar2',
      type: 'equilibrium',
      x1: 40,
      y1: 50,
      x2: 60,
      y2: 50,
      cpx: 50,
      cpy: 50,
      labelAbove: 'Δ',
    },
    // Curved mechanism arrow
    { id: 'ar3', type: 'curved', x1: 15, y1: 55, x2: 25, y2: 55, cpx: 20, cpy: 45 },
    // Retrosynthetic arrow — no label
    { id: 'ar4', type: 'retrosynthetic', x1: 70, y1: 50, x2: 90, y2: 50, cpx: 80, cpy: 50 },
    // Half-curved arrow
    { id: 'ar5', type: 'half-curved', x1: 15, y1: 65, x2: 25, y2: 65, cpx: 20, cpy: 55 },
  ],
  textBoxes: [
    {
      id: 'tb1',
      x: 10,
      y: 80,
      runs: [{ text: 'Condition: H' }, { text: '2', sub: true }, { text: 'O' }],
      fontSize: 12,
      fontFamily: 'Arial',
      color: '#000000',
    },
  ],
  groups: [],
};

test.describe('CDXML round-trip', { skip: !XMLLINT }, () => {
  test('stateToCDXML produces well-formed XML with arrows and text', () => {
    const xml = stateToCDXML(REPRESENTATIVE_STATE);
    validateXml(xml, 'stateToCDXML');
  });

  test('chemDrawDocumentToCDXML produces well-formed XML', () => {
    const { document } = canvasStateToChemDrawDocument(REPRESENTATIVE_STATE);
    const xml = chemDrawDocumentToCDXML(document);
    validateXml(xml, 'chemDrawDocumentToCDXML');
  });

  test('all arrow types produce valid self-closing tags when label-less', () => {
    const types = [
      'reaction',
      'equilibrium',
      'retrosynthetic',
      'curved',
      'half-curved',
      'resonance',
      'dashed-reaction',
      'no-reaction',
    ];
    const state = {
      atoms: [],
      bonds: [],
      arrows: types.map((type, i) => ({
        id: `ar${i}`,
        type,
        x1: i * 10,
        y1: 0,
        x2: i * 10 + 5,
        y2: 0,
        cpx: i * 10 + 2.5,
        cpy: -5,
      })),
      textBoxes: [],
      groups: [],
    };
    const xml = stateToCDXML(state);
    validateXml(xml, 'all-arrow-types-no-label');
    // Every arrow should be a proper self-closing tag (contains "/>")
    const arrowMatches = xml.match(/<arrow [^>]*\/>/g) ?? [];
    assert.ok(arrowMatches.length > 0, 'expected at least one self-closing <arrow/> tag');
  });
});
