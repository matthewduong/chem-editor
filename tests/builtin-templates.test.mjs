import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBuiltinTemplates,
  isBuiltinTemplate,
} from '../.unit-test-dist/src/lib/builtinTemplates.js';
import { validateTemplate } from '../.unit-test-dist/src/lib/templates.js';

const BOND = 14.4;
const templates = buildBuiltinTemplates(BOND);
const bondLengths = (t) => {
  const objects = t.fragment.pages[0].objects;
  const pos = new Map(objects.filter((o) => o.type === 'node').map((o) => [o.id, o.position]));
  return objects
    .filter((o) => o.type === 'bond')
    .map((b) => {
      const a = pos.get(b.beginNodeId),
        c = pos.get(b.endNodeId);
      return Math.hypot(a.x - c.x, a.y - c.y);
    });
};

test('bundled library is non-empty with unique, namespaced ids', () => {
  assert.ok(templates.length >= 150);
  assert.equal(new Set(templates.map((t) => t.id)).size, templates.length);
  assert.ok(templates.every(isBuiltinTemplate));
  assert.ok(templates.some((t) => t.name === 'Benzene'));
  const solvents = templates.filter((t) => t.tags.includes('Salts and Solvents'));
  assert.ok(solvents.length >= 100, `solvents: ${solvents.length}`);
  assert.ok(solvents.some((t) => t.name === 'dimethyl formamide'));
  // a ring that is also a solvent is listed once, under its ring group
  assert.equal(templates.filter((t) => t.name.toLowerCase() === 'benzene').length, 1);
  assert.equal(new Set(templates.map((t) => t.name.toLowerCase())).size, templates.length);
});

test('every built-in passes the same validation as a saved user template', () => {
  for (const t of templates) assert.doesNotThrow(() => validateTemplate(t), t.id);
});

test('geometry is scaled to the document bond length with regular bonds', () => {
  for (const t of templates) {
    const lengths = bondLengths(t);
    const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    // coordinates are stored to 4 decimals, so allow 0.1% of a bond length
    assert.ok(Math.abs(mean - BOND) < 1e-3 * BOND, `${t.id} mean ${mean}`);
    assert.ok(Math.max(...lengths) / Math.min(...lengths) <= 1.15 + 1e-9, t.id);
  }
  const doubled = buildBuiltinTemplates(BOND * 2).find((t) => t.name === 'Benzene');
  const base = templates.find((t) => t.name === 'Benzene');
  assert.ok(Math.abs(bondLengths(doubled)[0] - 2 * bondLengths(base)[0]) < 1e-9);
});

test('benzene keeps three double bonds and a valid attachment point', () => {
  const benzene = templates.find((t) => t.name === 'Benzene');
  const objects = benzene.fragment.pages[0].objects;
  assert.equal(objects.filter((o) => o.type === 'node').length, 6);
  assert.equal(objects.filter((o) => o.type === 'bond' && o.order === 2).length, 3);
  assert.ok(benzene.attachment);
});

test('invalid bond length is rejected', () => {
  assert.throws(() => buildBuiltinTemplates(0), /bond length/);
  assert.throws(() => buildBuiltinTemplates(Number.NaN), /bond length/);
});
