import { useMemo } from 'react';
import { LruCache } from '../lib/lruCache';
export function useSmilesCache<T>() {
  return useMemo(() => new LruCache<T>(50), []);
}
