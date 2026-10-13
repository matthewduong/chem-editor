import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCleanupCommand } from '../.unit-test-dist/src/editor/commands/cleanup.js';
import { createRDKitChemistryService } from '../.unit-test-dist/src/lib/chemistry/rdkit.js';
import { graphToMolblock, parseMolblockGeometry } from '../.unit-test-dist/src/lib/graph.js';
import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';
import initRDKitModule from '@rdkit/rdkit';

const source = () => {
  const doc = cdxmlToChemDrawDocument(
    '<CDXML><page id="1"><fragment id="f"><n id="a" p="10 20" Element="7"/><n id="b" p="70 30"/><b id="c" B="a" E="b" Order="1"/></fragment><t id="t" p="50 100"><s>caption</s></t></page></CDXML>',
  ).document;
  doc.pages[0].objects.push({ id: 'g', type: 'group', childIds: ['f'] });
  const a = doc.pages[0].objects.find((o) => o.id === 'a');
  a.style = { color: '#123456' };
  a.preservation = { capability: 'editable', rawAttributes: { test: 'retained' } };
  return doc;
};
const service = (overrides = {}) => ({
  capabilities: { layout: true, stereo: true },
  layout: async (req) => ({
    ok: true,
    value: new Map([...req.atomMap.values()].reverse().map((id, i) => [id, { x: i * 30, y: 0 }])),
  }),
  validateIdentity: () => ({ ok: true, value: true }),
  ...overrides,
});

test('cleanup retains document identity, metadata, groups and captions through reopen', async () => {
  const doc = source();
  const before = structuredClone(doc);
  const command = await prepareCleanupCommand(doc, new Set(), service(), 30);
  const next = command.apply(doc).document;
  assert.deepEqual(doc, before);
  for (const o of doc.pages[0].objects) {
    const n = next.pages[0].objects.find((n) => n.id === o.id);
    assert.deepEqual(o.type === 'node' ? { ...n, position: o.position } : n, o);
    if (o.type !== 'node') assert.equal(n, o);
  }
  const nodes = next.pages[0].objects.filter((o) => o.type === 'node');
  assert.ok(Math.abs(nodes[0].position.x - nodes[1].position.x - 30) < 1e-9);
  assert.ok(Math.abs((nodes[0].position.x + nodes[1].position.x) / 2 - 19.2) < 1e-9);
  const xml = chemDrawDocumentToCDXML(next);
  assert.equal(chemDrawDocumentToCDXML(cdxmlToChemDrawDocument(xml).document), xml);
  assert.equal(command.apply(doc).inversePatch.apply(next).document, doc);
  assert.throws(() => command.apply(structuredClone(doc)), /changed/);
});

test('partial and annotation-only selections are rejected without an engine call', async () => {
  const engine = service({
    layout: () => {
      throw new Error('should not run');
    },
  });
  await assert.rejects(prepareCleanupCommand(source(), new Set(['a']), engine, 30), /every atom/);
  await assert.rejects(
    prepareCleanupCommand(source(), new Set(['t']), engine, 30),
    /no chemical objects/,
  );
});

test('cleanup rejects restrictions, missing correspondence, non-finite coordinates, stereo failure and cancellation', async () => {
  const restricted = source();
  restricted.pages[0].objects.find((o) => o.id === 'g').preservation = {
    capability: 'round-trip-only',
  };
  await assert.rejects(
    prepareCleanupCommand(restricted, new Set(), service(), 30),
    /restricts editing/,
  );
  await assert.rejects(
    prepareCleanupCommand(
      source(),
      new Set(),
      service({ layout: async () => ({ ok: true, value: new Map() }) }),
      30,
    ),
    /correspondence/,
  );
  await assert.rejects(
    prepareCleanupCommand(
      source(),
      new Set(),
      service({
        layout: async () => ({
          ok: true,
          value: new Map([
            ['a', { x: NaN, y: 0 }],
            ['b', { x: 0, y: 0 }],
          ]),
        }),
      }),
      30,
    ),
    /correspondence/,
  );
  await assert.rejects(
    prepareCleanupCommand(
      source(),
      new Set(),
      service({ validateIdentity: () => ({ ok: false, message: 'stereo changed' }) }),
      30,
    ),
    /stereo changed/,
  );
  const controller = new AbortController();
  const doc = source();
  const command = await prepareCleanupCommand(doc, new Set(), service(), 30, controller.signal);
  controller.abort();
  assert.throws(() => command.apply(doc), /cancelled/);
});

test('multiple molecules prepare atomically and preserve independent centroids', async () => {
  const doc = source();
  doc.pages[0].objects.push({ id: 'd', type: 'node', position: { x: 300, y: 300 }, element: 'O' });
  const before = structuredClone(doc);
  let calls = 0;
  await assert.rejects(
    prepareCleanupCommand(
      doc,
      new Set(),
      service({
        layout: async (req) =>
          ++calls === 2 ? { ok: false, message: 'second failed' } : service().layout(req),
      }),
      30,
    ),
    /second failed/,
  );
  assert.deepEqual(doc, before);
  const next = (await prepareCleanupCommand(doc, new Set(), service(), 30)).apply(doc).document;
  assert.deepEqual(next.pages[0].objects.find((o) => o.id === 'd').position, { x: 300, y: 300 });
});

test('RDKit adapter verifies mapped layout and refuses malformed map replies', async () => {
  const rdkit = await initRDKitModule();
  const adapter = createRDKitChemistryService(rdkit);
  const doc = source();
  const next = (await prepareCleanupCommand(doc, new Set(), adapter, 30)).apply(doc).document;
  const a = next.pages[0].objects.find((o) => o.id === 'a').position;
  const b = next.pages[0].objects.find((o) => o.id === 'b').position;
  assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 30) < 0.01);
  const molblock = graphToMolblock(
    [{ id: 'a', x: 0, y: 0, element: 'C' }],
    [],
    0,
    0,
    undefined,
    true,
  ).molblock;
  assert.equal(parseMolblockGeometry(molblock).atoms[0].mapNumber, 1);
  for (const mb of [
    molblock.replace(/ {2}1 {2}0 {2}0\n/, '  0  0  0\n'),
    molblock.replace(/ {2}1 {2}0 {2}0\n/, '  2  0  0\n'),
  ]) {
    const fake = createRDKitChemistryService({
      get_mol: () => ({
        set_new_coords() {},
        get_molblock: () => mb,
        get_smiles: () => 'C',
        delete() {},
      }),
    });
    const result = await fake.layout({ molblock, atomMap: new Map([[1, 'a']]), bondLength: 30 });
    assert.equal(result.ok, false);
    assert.match(result.message, /atom maps/);
  }
});

test('mapped reordered output is accepted and duplicate maps or changed bonds are refused', async () => {
  const atoms = [
    { id: 'a', x: 0, y: 0, element: 'C' },
    { id: 'b', x: 30, y: 0, element: 'N' },
  ];
  const original = graphToMolblock(
    atoms,
    [{ id: 'bond', from: 'a', to: 'b', order: 1 }],
    0,
    0,
    undefined,
    true,
  ).molblock;
  const lines = original.split('\n');
  [lines[4], lines[5]] = [lines[5], lines[4]];
  const reordered = lines.join('\n');
  const rdkit = await initRDKitModule();
  const adapter = (output) =>
    createRDKitChemistryService({
      get_mol: (input) => {
        const mol = rdkit.get_mol(input);
        return {
          get_smiles: () => mol.get_smiles(),
          set_new_coords() {},
          get_molblock: () => output,
          delete: () => mol.delete(),
        };
      },
    });
  const request = {
    molblock: original,
    atomMap: new Map([
      [1, 'a'],
      [2, 'b'],
    ]),
    bondLength: 30,
  };
  const result = await adapter(reordered).layout(request);
  assert.equal(result.ok, true);
  assert.ok(result.value.get('a').x < result.value.get('b').x);
  const duplicated = reordered.split('\n');
  duplicated[4] =
    duplicated[4].slice(0, 60) + duplicated[5].slice(60, 63) + duplicated[4].slice(63);
  assert.equal((await adapter(duplicated.join('\n')).layout(request)).ok, false);
  const changed = reordered.split('\n');
  changed[6] = changed[6].slice(0, 6) + '  2' + changed[6].slice(9);
  assert.match((await adapter(changed.join('\n')).layout(request)).message, /connectivity/);
});

test('retained wedges are revalidated against moved coordinates', async () => {
  const rdkit = await initRDKitModule();
  const service = createRDKitChemistryService(rdkit);
  const atoms = [
    { id: 'a', element: 'C', x: 0, y: 0 },
    { id: 'b', element: 'F', x: 30, y: 0 },
    { id: 'c', element: 'Cl', x: -15, y: 26 },
    { id: 'd', element: 'Br', x: -15, y: -26 },
  ];
  const bonds = ['b', 'c', 'd'].map((to, i) => ({
    id: to,
    from: 'a',
    to,
    order: 1,
    stereo: i === 0 ? 1 : 0,
  }));
  const before = graphToMolblock(atoms, bonds, 0, 0, undefined, true).molblock;
  const mirrored = graphToMolblock(
    atoms.map((a) => ({ ...a, y: -a.y })),
    bonds,
    0,
    0,
    undefined,
    true,
  ).molblock;
  assert.equal(service.validateIdentity(before, mirrored).ok, false);
});
