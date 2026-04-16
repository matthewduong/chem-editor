import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebouncedValue } from './useDebouncedValue';
import { useSmilesCache } from './useSmilesCache';
import type { ViewerStructureStatus } from '../store';
import type { AsyncState } from '../types/panelState';

type StructureTaskResult<TData> = { data: TData } | { error: string };

interface UseCachedStructureTaskOptions<TResponse, TData> {
  viewerSmiles: string;
  viewerStructureStatus: ViewerStructureStatus;
  unavailableMessage: string;
  run: (smiles: string) => Promise<TResponse>;
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
}: UseCachedStructureTaskOptions<TResponse, TData>) {
  const [state, setState] = useState<AsyncState<TData>>({
    status: 'idle',
    data: null,
    error: null,
  });
  const debouncedSmiles = useDebouncedValue(viewerSmiles, debounceMs);
  const cache = useSmilesCache<TData>();
  // Ignore stale async completions when a newer structure request has already started.
  const requestSerialRef = useRef(0);

  const queueState = useCallback(
    (next: AsyncState<TData> | ((current: AsyncState<TData>) => AsyncState<TData>)) => {
      queueMicrotask(() => {
        setState(next);
      });
    },
    [],
  );

  useEffect(() => {
    if (!debouncedSmiles) {
      if (viewerStructureStatus.kind === 'display-only') {
        queueState({
          status: 'error',
          data: null,
          error: viewerStructureStatus.message ?? unavailableMessage,
        });
      } else {
        queueState({ status: 'idle', data: null, error: null });
      }
      return;
    }

    const cached = cache.get(debouncedSmiles);
    if (cached) {
      queueState({ status: 'success', data: cached, error: null });
      return;
    }

    const serial = requestSerialRef.current + 1;
    requestSerialRef.current = serial;
    queueState((current) => ({ ...current, status: 'loading', error: null }));

    run(debouncedSmiles)
      .then((response) => {
        if (requestSerialRef.current !== serial) return;
        const next = selectData(response);
        if ('data' in next) {
          cache.set(debouncedSmiles, next.data);
          setState({ status: 'success', data: next.data, error: null });
          return;
        }
        setState({ status: 'error', data: null, error: next.error });
      })
      .catch((error) => {
        if (requestSerialRef.current !== serial) return;
        setState({ status: 'error', data: null, error: String(error) });
      });
  }, [
    cache,
    debouncedSmiles,
    queueState,
    run,
    selectData,
    unavailableMessage,
    viewerStructureStatus,
  ]);

  return state;
}
