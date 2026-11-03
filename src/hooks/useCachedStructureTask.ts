import { useEffect, useState } from 'react';
import { useDebouncedValue } from './useDebouncedValue';
import { useSmilesCache } from './useSmilesCache';
import { useRequestOwnership } from './useRequestOwnership';
import type { ViewerStructureStatus } from '../store';
import type { AsyncState } from '../types/panelState';

type StructureTaskResult<TData> = { data: TData } | { error: string };
interface UseCachedStructureTaskOptions<TResponse, TData> {
  viewerSmiles: string;
  viewerStructureStatus: ViewerStructureStatus;
  unavailableMessage: string;
  run: (smiles: string, signal?: AbortSignal) => Promise<TResponse>;
  selectData: (response: TResponse) => StructureTaskResult<TData>;
  debounceMs?: number;
}
export function useCachedStructureTask<TResponse, TData>({
  viewerSmiles,
  viewerStructureStatus,
  unavailableMessage,
  run,
  selectData,
  debounceMs = 500,
}: UseCachedStructureTaskOptions<TResponse, TData>): AsyncState<TData> {
  const [result, setResult] = useState<{ key: string; state: AsyncState<TData> } | null>(null);
  const debounced = useDebouncedValue(viewerSmiles, debounceMs);
  const cache = useSmilesCache<TData>();
  const ownership = useRequestOwnership(
    `${viewerSmiles}|${viewerStructureStatus.chemistryAvailable}`,
  );
  useEffect(() => {
    if (
      !viewerSmiles ||
      !viewerStructureStatus.chemistryAvailable ||
      debounced !== viewerSmiles ||
      cache.get(viewerSmiles) !== undefined
    )
      return;
    const request = ownership.start();
    void run(viewerSmiles, request.signal)
      .then((response) => {
        if (!request.current()) return;
        const next = selectData(response);
        if ('data' in next) {
          cache.set(viewerSmiles, next.data);
          setResult({
            key: viewerSmiles,
            state: { status: 'success', data: next.data, error: null },
          });
        } else
          setResult({
            key: viewerSmiles,
            state: { status: 'error', data: null, error: next.error },
          });
      })
      .catch((error) => {
        if (request.current())
          setResult({
            key: viewerSmiles,
            state: { status: 'error', data: null, error: String(error) },
          });
      });
    return ownership.cancel;
  }, [
    viewerSmiles,
    viewerStructureStatus.chemistryAvailable,
    debounced,
    cache,
    ownership,
    run,
    selectData,
  ]);
  if (!viewerStructureStatus.chemistryAvailable && viewerStructureStatus.kind === 'display-only')
    return {
      status: 'error',
      data: null,
      error: viewerStructureStatus.message ?? unavailableMessage,
    };
  if (!viewerSmiles) return { status: 'idle', data: null, error: null };
  const cached = cache.get(viewerSmiles);
  if (cached !== undefined) return { status: 'success', data: cached, error: null };
  if (result?.key === viewerSmiles) return result.state;
  return { status: 'loading', data: null, error: null };
}
