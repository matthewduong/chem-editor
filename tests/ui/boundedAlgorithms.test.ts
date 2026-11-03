import { expect, test } from 'vitest';
import { ringTopology } from '../../src/lib/ringTopology';
import { computeRingCentroids } from '../../src/lib/renderGeometry';
import { LruCache } from '../../src/lib/lruCache';
import type { Atom, Bond } from '../../src/types/chemistry';
import { buildDocumentIndex, queryObjectsInBounds } from '../../src/editor/document';
import type { ChemDrawDocument } from '../../src/types/chemdraw';

test('long chains have no cyclic search and coordinate edits reuse topology', () => {
  const atoms = Array.from(
    { length: 10000 },
    (_, i) => ({ id: `${i}`, element: 'C', x: i, y: 0 }) as Atom,
  );
  const bonds = atoms
    .slice(1)
    .map((a, i) => ({ id: `b${i}`, from: `${i}`, to: a.id, order: 1 }) as Bond);
  expect(computeRingCentroids(atoms, bonds).size).toBe(0);
  const before = ringTopology(atoms, bonds);
  expect(
    ringTopology(
      atoms.map((a) => ({ ...a, y: 1 })),
      bonds,
    ),
  ).toBe(before);
});
test('LRU budgets evict least recently used entries and reject oversize values', () => {
  const cache = new LruCache<Uint8Array>(8, (a) => a.byteLength);
  cache.set('a', new Uint8Array(4));
  cache.set('b', new Uint8Array(4));
  cache.get('a');
  cache.set('c', new Uint8Array(4));
  expect(cache.get('b')).toBeUndefined();
  cache.set('huge', new Uint8Array(9));
  expect(cache.bytes).toBe(8);
});
test('huge finite bounds overflow insertion and broad queries preserve drawing order', () => {
  const document = {
    schemaVersion: 1,
    pages: [
      {
        id: 'p',
        objects: [
          {
            id: 'big',
            type: 'graphic',
            graphicType: 'rectangle',
            bounds: { left: -1e30, right: 1e30, top: -1e30, bottom: 1e30 },
          },
          {
            id: 'small',
            type: 'graphic',
            graphicType: 'rectangle',
            bounds: { left: 0, right: 1, top: 0, bottom: 1 },
          },
        ],
      },
    ],
  } as unknown as ChemDrawDocument;
  const index = buildDocumentIndex(document);
  expect(index.spatialIndex.cells.size).toBeLessThanOrEqual(256);
  expect(index.spatialIndex.overflow).toContain('big');
  const bounds = { left: -1e30, right: 1e30, top: -1e30, bottom: 1e30 };
  expect(queryObjectsInBounds(index, bounds).map((e) => e.id)).toEqual(['big', 'small']);
});
