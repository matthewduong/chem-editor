import { act, renderHook } from '@testing-library/react';
import { expect, test } from 'vitest';
import { useCachedStructureTask } from '../../src/hooks/useCachedStructureTask';
const status = {
  kind: 'valid' as const,
  chemistryAvailable: true,
  fallbackGeometryAvailable: true,
  message: null,
};
const selectData = (data: string) => ({ data });
test('raw changes, empty input, cache hits, and unmount invalidate pending results', async () => {
  const pending = new Map<string, (value: string) => void>();
  const run = (key: string) => new Promise<string>((resolve) => pending.set(key, resolve));
  const { result, rerender, unmount } = renderHook(
    ({ key }) =>
      useCachedStructureTask({
        viewerSmiles: key,
        viewerStructureStatus: status,
        unavailableMessage: 'no',
        run,
        selectData,
        debounceMs: 0,
      }),
    { initialProps: { key: 'A' } },
  );
  await act(async () => pending.get('A')!('cached A'));
  expect(result.current.data).toBe('cached A');
  rerender({ key: 'B' });
  expect(result.current.data).toBeNull();
  await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  rerender({ key: 'A' });
  expect(result.current.data).toBe('cached A');
  await act(async () => pending.get('B')!('stale B'));
  expect(result.current.data).toBe('cached A');
  rerender({ key: 'C' });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  rerender({ key: '' });
  expect(result.current.data).toBeNull();
  await act(async () => pending.get('C')!('stale C'));
  expect(result.current.status).toBe('idle');
  unmount();
});
