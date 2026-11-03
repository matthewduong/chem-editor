import { expect, test } from 'vitest';
import { OrbitalMeshClient } from '../../src/workers/orbitalMeshClient';
import type { ViewerOrbitalResult } from '../../src/lib/viewer3d';

class FakeWorker {
  posted: Array<{ type: string; id: number; transfer?: Transferable[] }> = [];
  terminated = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage(message: { type: string; id: number }, transfer?: Transferable[]) {
    this.posted.push({ ...message, transfer });
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const result = {
  basis: '3-21G',
  orbitals: [],
  grid: { origin: { x: 0, y: 0, z: 0 }, spacing: 0.5, dims: [2, 2, 2] },
  fields: { homo: { key: 'homo', values: [1, 2, 3, 4, 5, 6, 7, 8], minValue: 1, maxValue: 8 } },
  warnings: [],
} as unknown as ViewerOrbitalResult;
const mesh = (key: string) => ({ key, positivePositions: [], negativePositions: [] });

function client() {
  const workers: FakeWorker[] = [];
  const instance = new OrbitalMeshClient(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker as unknown as Worker;
  });
  return { instance, workers };
}

test('the grid is transferred once per result; later isovalues send only the request', async () => {
  const { instance, workers } = client();
  const first = instance.mesh(result, 'homo', 0.05);
  workers[0].reply({ id: 1, mesh: mesh('a') });
  await expect(first).resolves.toEqual(mesh('a'));
  const second = instance.mesh(result, 'homo', 0.08);
  workers[0].reply({ id: 2, mesh: mesh('b') });
  await expect(second).resolves.toEqual(mesh('b'));
  expect(workers).toHaveLength(1);
  expect(workers[0].posted.map((m) => m.type)).toEqual(['load', 'mesh', 'mesh']);
  expect(workers[0].posted[0].transfer).toHaveLength(1);
  // The caller's arrays are copied before transfer, never detached from under it.
  expect((result.fields.homo.values as number[]).length).toBe(8);
});

test('supersession terminates the busy worker and a stale reply is ignored', async () => {
  const { instance, workers } = client();
  const stale = instance.mesh(result, 'homo', 0.05);
  const fresh = instance.mesh(result, 'homo', 0.06);
  await expect(stale).rejects.toThrow('superseded');
  expect(workers[0].terminated).toBe(true);
  expect(workers[1].posted.map((m) => m.type)).toEqual(['load', 'mesh']);
  const freshId = workers[1].posted[1].id;
  workers[1].reply({ id: freshId - 1, mesh: mesh('stale') });
  workers[1].reply({ id: freshId, mesh: mesh('fresh') });
  await expect(fresh).resolves.toEqual(mesh('fresh'));
});

test('a worker error reply rejects and the next request starts a fresh worker', async () => {
  const { instance, workers } = client();
  const failed = instance.mesh(result, 'homo', 0.05);
  workers[0].reply({ id: 1, error: 'Invalid orbital field' });
  await expect(failed).rejects.toThrow('Invalid orbital field');
  expect(workers[0].terminated).toBe(true);
  void instance.mesh(result, 'homo', 0.05);
  expect(workers[1].posted[0].type).toBe('load');
});
