import { canvasStateToChemDrawDocument } from '../../src/lib/chemdrawModel';
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
  if (overrides.atoms && !overrides.chemDrawDocument) {
    const document = canvasStateToChemDrawDocument(
      {
        atoms: overrides.atoms,
        bonds: overrides.bonds ?? [],
        arrows: overrides.arrows ?? [],
        groups: overrides.groups ?? [],
        textBoxes: overrides.textBoxes ?? [],
      },
      {
        documentStyleSettings:
          overrides.documentStyleSettings ?? useStore.getInitialState().documentStyleSettings,
      },
    ).document;
    overrides = { ...overrides, chemDrawDocument: document, history: [document], historyIndex: 0 };
  }
  useStore.setState({
    ...useStore.getInitialState(),
    ...overrides,
  });
}
