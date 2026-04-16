import { useStore } from '../../src/store';

export function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

export function flushMicrotasks() {
  return Promise.resolve();
}

export function resetStore(overrides: Partial<ReturnType<typeof useStore.getState>> = {}) {
  useStore.setState({
    ...useStore.getInitialState(),
    ...overrides,
  });
}
