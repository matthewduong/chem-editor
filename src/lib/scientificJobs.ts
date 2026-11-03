import { invokeTauri } from './tauri';

type Entry = { id: string; promise: Promise<unknown>; consumers: number; cancelling: boolean };
const requests = new Map<string, Entry>();

/**
 * Shared requests live until terminal IPC acknowledgement, including while cancellation runs.
 * `onJob` receives the backend job ID, which scopes `scientific-job-progress` events.
 */
export async function invokeScientific<T>(
  command: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  onJob?: (jobId: string) => void,
): Promise<T> {
  if (signal?.aborted) throw new Error('Job cancelled');
  const key = `${command}:${JSON.stringify(args)}`;
  let entry = requests.get(key);
  if (entry?.cancelling) {
    await entry.promise.catch(() => {});
    return invokeScientific(command, args, signal, onJob);
  }
  if (!entry) {
    const id = crypto.randomUUID();
    entry = { id, consumers: 0, cancelling: false, promise: Promise.resolve() };
    const owned = entry;
    entry.promise = invokeTauri<T>(command, { ...args, jobId: id }).finally(() => {
      if (requests.get(key) === owned) requests.delete(key);
    });
    requests.set(key, entry);
  }
  const owned = entry;
  owned.consumers += 1;
  onJob?.(owned.id);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    owned.consumers -= 1;
    if (owned.consumers === 0 && requests.get(key) === owned) {
      owned.cancelling = true;
      // The original invoke settles only after the owned process has been reaped.
      void invokeTauri('cancel_scientific_job', { jobId: owned.id }).catch(() => {});
    }
  };
  signal?.addEventListener('abort', release, { once: true });
  try {
    const value = await owned.promise;
    if (signal?.aborted) throw new Error('Job cancelled');
    return value as T;
  } finally {
    signal?.removeEventListener('abort', release);
    release();
  }
}
