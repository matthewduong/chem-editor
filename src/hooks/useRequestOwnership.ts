import { useLayoutEffect, useMemo, useRef } from 'react';

/**
 * One owner per raw input key. A key change or unmount invalidates the previous owner at commit,
 * before passive effects or any debounce run, so a late reply can never land on newer input.
 */
export function useRequestOwnership(key: string) {
  const scopeRef = useRef({ generation: 0, controller: null as AbortController | null });
  useLayoutEffect(() => {
    const scope = scopeRef.current;
    return () => {
      scope.generation += 1;
      scope.controller?.abort();
    };
  }, [key]);
  // A fresh handle per key, so effects that depend on it rerun when the input changes.
  return useMemo(
    () => ({
      key,
      start() {
        const scope = scopeRef.current;
        scope.controller?.abort();
        const controller = new AbortController();
        scope.controller = controller;
        const generation = ++scope.generation;
        return {
          signal: controller.signal,
          current: () => scope.generation === generation && !controller.signal.aborted,
        };
      },
      cancel() {
        scopeRef.current.controller?.abort();
      },
    }),
    [key],
  );
}
