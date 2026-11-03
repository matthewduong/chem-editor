import { LruCache } from './lruCache';
import type { ViewerOrbitalMesh, ViewerOrbitalResult } from './viewer3d';
type Cached =
  | { kind: 'field'; value: ViewerOrbitalResult }
  | { kind: 'mesh'; value: ViewerOrbitalMesh };
function bytes(value: number[] | Float64Array) {
  return ArrayBuffer.isView(value) ? value.byteLength : value.length * 8;
}
/** Inactive buffers share one 64 MiB budget. Active hook state is retained independently. */
export const orbitalBufferCache = new LruCache<Cached>(64 * 1024 * 1024, (item) =>
  item.kind === 'field'
    ? Object.values(item.value.fields).reduce((sum, field) => sum + bytes(field.values), 0)
    : bytes(item.value.positivePositions) + bytes(item.value.negativePositions),
);
export const orbitalCache = {
  get(key: string) {
    const item = orbitalBufferCache.get(`field:${key}`);
    return item?.kind === 'field' ? item.value : undefined;
  },
  set(key: string, value: ViewerOrbitalResult) {
    orbitalBufferCache.set(`field:${key}`, { kind: 'field', value });
  },
  delete(key: string) {
    orbitalBufferCache.delete(`field:${key}`);
  },
};
