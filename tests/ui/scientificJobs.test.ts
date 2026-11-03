import { beforeEach, expect, test, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/tauri', () => ({ invokeTauri: invoke }));
import { invokeScientific } from '../../src/lib/scientificJobs';
beforeEach(() => {
  invoke.mockReset();
});
test('deduplication retains ownership until terminal acknowledgement; only last consumer cancels', async () => {
  let finish!: (value: unknown) => void;
  invoke.mockImplementation((command: string) =>
    command === 'cancel_scientific_job'
      ? Promise.resolve('cancelled')
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  const a = new AbortController();
  const b = new AbortController();
  const first = invokeScientific('calculate_orbitals', { smiles: 'C' }, a.signal).catch(String);
  const second = invokeScientific('calculate_orbitals', { smiles: 'C' }, b.signal).catch(String);
  expect(invoke).toHaveBeenCalledTimes(1);
  a.abort();
  expect(invoke).toHaveBeenCalledTimes(1);
  b.abort();
  expect(invoke).toHaveBeenCalledTimes(2);
  let settled = false;
  void second.then(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  finish({});
  await Promise.all([first, second]);
  expect(settled).toBe(true);
});
