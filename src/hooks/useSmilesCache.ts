import { useMemo, useRef } from 'react';

export function useSmilesCache<T>(): {
  get: (key: string) => T | undefined;
  set: (key: string, value: T) => void;
} {
  const map = useRef(new Map<string, T>());
  return useMemo(
    () => ({
      get: (key: string) => map.current.get(key),
      set: (key: string, value: T) => {
        map.current.set(key, value);
      },
    }),
    [],
  );
}
