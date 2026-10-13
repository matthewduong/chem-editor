import test from 'node:test';
import assert from 'node:assert/strict';
import { checkStructure } from '../.unit-test-dist/src/lib/chemistry/diagnostics.js';
const service = { capabilities: { layout: true }, validate: async () => [] };
const doc = (objects) => ({
  schemaVersion: 1,
  source: 'canvas-state',
  pages: [{ id: 'page', objects }],
});
const node = (id, x, extra = {}) => ({
  id,
  type: 'node',
  element: 'C',
  position: { x, y: 0 },
  ...extra,
});
const bond = (id, a, b, extra = {}) => ({
  id,
  type: 'bond',
  beginNodeId: a,
  endNodeId: b,
  order: 1,
  ...extra,
});

test('diagnostics report exact duplicate, overlap, alias and reference objects without mutating', async () => {
  const source = doc([
    node('a', 0),
    node('b', 0),
    node('alias', 50, { alias: 'Unknown' }),
    bond('x', 'a', 'b'),
    bond('y', 'a', 'b'),
    bond('bad', 'a', 'missing'),
  ]);
  const before = structuredClone(source);
  const issues = await checkStructure(source, service);
  assert.deepEqual(source, before);
  assert.deepEqual(issues.find((i) => i.code === 'overlapping-atoms').objectIds, ['a', 'b']);
  assert.deepEqual(issues.find((i) => i.code === 'duplicate-bond').objectIds, ['x', 'y', 'a', 'b']);
  assert.deepEqual(issues.find((i) => i.code === 'invalid-reference').objectIds, ['bad']);
  assert.equal(issues.find((i) => i.code === 'unresolved-alias').availability, 'unavailable');
});
test('ordinary bond crossings are valid and unsupported chemistry is not labelled invalid', async () => {
  const source = doc([
    node('a', 0),
    node('b', 30),
    node('q', 60, { query: { type: 'any' } }),
    bond('x', 'a', 'b'),
  ]);
  const issues = await checkStructure(source, service);
  assert.equal(
    issues.some((i) => i.severity === 'error'),
    false,
  );
  assert.equal(issues.find((i) => i.code === 'preserved-unsupported').availability, 'unavailable');
  assert.equal(
    issues.find((i) => i.code === 'stereo-check-unavailable').availability,
    'unavailable',
  );
});
test('engine failure is explicitly unavailable, separate from local invalid valence', async () => {
  const source = doc([
    node('a', 0),
    node('b', 30),
    node('c', 60),
    bond('x', 'a', 'b', { order: 3 }),
    bond('y', 'a', 'c', { order: 3 }),
  ]);
  const issues = await checkStructure(source, {
    ...service,
    validate: async () => {
      throw new Error('offline');
    },
  });
  assert.deepEqual(issues.find((i) => i.code === 'invalid-valence').objectIds, ['a']);
  assert.equal(issues.find((i) => i.code === 'engine-unavailable').availability, 'unavailable');
});

test('hypervalent sulfur and phosphorus are not reported as invalid valence', async () => {
  const source = doc([
    node('s', 0, { element: 'S' }),
    ...['a', 'b', 'c', 'd'].map((id, i) => node(id, 100 + i * 100, { element: i < 2 ? 'O' : 'C' })),
    bond('x1', 's', 'a', { order: 2 }),
    bond('x2', 's', 'b', { order: 2 }),
    bond('x3', 's', 'c'),
    bond('x4', 's', 'd'),
  ]);
  const issues = await checkStructure(source, service);
  assert.equal(
    issues.some((i) => i.code === 'invalid-valence'),
    false,
  );
});

const wedge = (id, a, b, display) => bond(id, a, b, { display });
const codes = (issues) => issues.map((i) => i.code);

test('a wedge whose narrow end has no other bond is reported with the bond and atom', async () => {
  const source = doc([
    node('a', 0),
    node('b', 50),
    node('c', 100),
    wedge('w', 'a', 'b', 'wedge-begin'), // narrow end at a, which has no other bond
    bond('x', 'b', 'c'),
  ]);
  const issue = (await checkStructure(source, service)).find(
    (i) => i.code === 'stereo-bond-terminal-center',
  );
  assert.deepEqual(issue.objectIds, ['w', 'a']);
  assert.equal(issue.severity, 'warning');
});

test('wedge-end puts the narrow end on the end atom', async () => {
  const source = doc([
    node('a', 0),
    node('b', 50),
    node('c', 100),
    wedge('w', 'a', 'b', 'hash-end'), // narrow end at b, which also bonds to c
    bond('x', 'b', 'c'),
  ]);
  assert.equal(
    codes(await checkStructure(source, service)).includes('stereo-bond-terminal-center'),
    false,
  );
  const reversed = doc([
    node('a', 0),
    node('b', 50),
    node('c', 100),
    wedge('w', 'a', 'b', 'hash-begin'),
    bond('x', 'b', 'c'),
  ]);
  assert.equal(
    codes(await checkStructure(reversed, service)).includes('stereo-bond-terminal-center'),
    true,
  );
});

test('a wedge from a tetrahedral carbon with three bonds is not reported', async () => {
  const source = doc([
    node('c', 0),
    node('a', 40),
    node('b', 0, { position: { x: 0, y: 40 } }),
    node('d', -40),
    wedge('w', 'c', 'a', 'wedge-begin'),
    bond('x', 'c', 'b'),
    bond('y', 'c', 'd'),
  ]);
  const found = codes(await checkStructure(source, service));
  assert.equal(
    found.some((c) => c.startsWith('stereo-bond')),
    false,
  );
});

test('a wedge from a carbon with a double bond is reported as not tetrahedral', async () => {
  const source = doc([
    node('c', 0),
    node('a', 40),
    node('o', 0, { position: { x: 0, y: 40 }, element: 'O' }),
    node('d', -40),
    wedge('w', 'c', 'a', 'wedge-begin'),
    bond('x', 'c', 'o', { order: 2 }),
    bond('y', 'c', 'd'),
  ]);
  const issues = await checkStructure(source, service);
  assert.deepEqual(issues.find((i) => i.code === 'stereo-bond-sp2-center').objectIds, ['w', 'c']);
});

test('the stereo check does not edit the document', async () => {
  const source = doc([node('a', 0), node('b', 50), wedge('w', 'a', 'b', 'wedge-begin')]);
  const before = JSON.stringify(source);
  await checkStructure(source, service);
  assert.equal(JSON.stringify(source), before);
});
