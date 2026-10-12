import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import type { ChemCanvasRef } from '../components/ChemCanvas';
import { useStore } from '../store';
import { getCurrentAppWindow, invokeTauri } from '../lib/tauri';
import {
  loadDocumentRecovery,
  saveDocumentRecovery,
  type DocumentRecovery,
} from '../lib/documentRecovery';

type Decision = 'save' | 'discard' | 'cancel';

export function useDocumentLifecycle(canvas: RefObject<ChemCanvasRef | null>) {
  const decisionRef = useRef<((decision: Decision) => void) | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<DocumentRecovery | null>(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const saveInFlight = useRef<Promise<boolean> | null>(null);
  const closeInFlight = useRef(false);

  const save = useCallback(
    (saveAs = false): Promise<boolean> => {
      if (saveInFlight.current) return saveInFlight.current;
      const task = (async () => {
        const state = useStore.getState();
        const snapshot = {
          document: state.chemDrawDocument,
          revision: state.documentRevision,
          sessionId: state.documentSessionId,
        };
        try {
          const result = await canvas.current?.saveNative({
            path: state.documentFile.path,
            prompt: saveAs || !state.documentFile.path,
          });
          if (!result?.saved || !result.path) return false;
          useStore.getState().markDocumentSaved(result.path, result.snapshot ?? snapshot);
          useStore.getState().addRecentFile(result.path);
          if (!useStore.getState().documentFile.dirty) await saveDocumentRecovery(null);
          return !useStore.getState().documentFile.dirty;
        } catch (error) {
          useStore.getState().showToast(`Failed to save file: ${String(error)}`);
          return false;
        }
      })();
      saveInFlight.current = task;
      void task.finally(() => {
        saveInFlight.current = null;
      });
      return task;
    },
    [canvas],
  );

  const confirmReplace = useCallback(
    async (nextAction: string): Promise<boolean> => {
      if (!useStore.getState().documentFile.dirty) return true;
      if (decisionRef.current) return false;
      const decision = await new Promise<Decision>((resolve) => {
        decisionRef.current = resolve;
        setAction(nextAction);
      });
      if (decision === 'cancel') return false;
      if (decision === 'save') return save();
      await saveDocumentRecovery(null);
      return true;
    },
    [save],
  );

  const resolveDecision = useCallback((decision: Decision) => {
    const resolve = decisionRef.current;
    decisionRef.current = null;
    setAction(null);
    resolve?.(decision);
  }, []);

  useEffect(() => {
    let mounted = true;
    void loadDocumentRecovery()
      .then((value) => {
        if (!mounted) return;
        setRecovery(value);
        setRecoveryReady(!value);
      })
      .catch((error) => {
        if (mounted)
          useStore.getState().showToast(`Could not read recovery data: ${String(error)}`);
      });
    return () => {
      mounted = false;
      decisionRef.current?.('cancel');
      decisionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!recoveryReady) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const state = useStore.getState();
        if (!state.documentFile.dirty || !state.chemDrawDocument) return;
        void saveDocumentRecovery({
          version: 1,
          savedAt: new Date().toISOString(),
          path: state.documentFile.path,
          document: state.chemDrawDocument,
        }).catch((error) =>
          useStore.getState().showToast(`Recovery could not be saved: ${String(error)}`),
        );
      }, 2000);
    };
    schedule();
    const unsubscribe = useStore.subscribe((state, previous) => {
      if (
        state.documentRevision !== previous.documentRevision ||
        state.documentFile !== previous.documentFile
      )
        schedule();
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [recoveryReady]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!useStore.getState().documentFile.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', beforeUnload);
    if (!isTauri()) return () => window.removeEventListener('beforeunload', beforeUnload);
    let disposed = false;
    const cleanup: Array<() => void> = [];
    const register = (promise: Promise<() => void>) => {
      void promise.then((unlisten) => (disposed ? unlisten() : cleanup.push(unlisten)));
    };
    const requestClose = async (quit: boolean) => {
      if (closeInFlight.current) return;
      closeInFlight.current = true;
      try {
        if (!(await confirmReplace(quit ? 'Quit' : 'Close'))) return;
        await saveDocumentRecovery(null);
        if (quit) await invokeTauri('finish_document_quit');
        else await getCurrentAppWindow().destroy();
      } finally {
        closeInFlight.current = false;
      }
    };
    register(
      getCurrentAppWindow().onCloseRequested((event) => {
        event.preventDefault();
        void requestClose(false);
      }),
    );
    register(
      listen('document-quit-requested', () => {
        void requestClose(true);
      }),
    );
    return () => {
      disposed = true;
      cleanup.forEach((fn) => fn());
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [confirmReplace]);

  const dialog =
    action || recovery ? (
      <div
        role="presentation"
        style={{
          position: 'fixed',
          inset: 0,
          background: '#0008',
          zIndex: 100000,
          display: 'grid',
          placeItems: 'center',
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="document-decision-title"
          style={{
            background: 'Canvas',
            color: 'CanvasText',
            padding: 24,
            borderRadius: 8,
            maxWidth: 440,
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && action) resolveDecision('cancel');
          }}
        >
          <h2 id="document-decision-title">
            {action ? 'Save your changes?' : 'Recover unsaved drawing?'}
          </h2>
          <p>
            {action
              ? `${useStore.getState().documentFile.name} has unsaved changes. Save before ${action.toLowerCase()}?`
              : `A drawing from ${recovery?.savedAt} can be recovered.`}
          </p>
          {action ? (
            <div style={{ display: 'flex', gap: 12 }}>
              <button autoFocus onClick={() => resolveDecision('save')}>
                Save
              </button>
              <button onClick={() => resolveDecision('discard')}>Discard</button>
              <button onClick={() => resolveDecision('cancel')}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                autoFocus
                onClick={() => {
                  if (!recovery) return;
                  void confirmReplace('Recover').then((allowed) => {
                    if (!allowed) return;
                    useStore.getState().replaceDocument(recovery.document);
                    // Recovery opens as an unsaved copy; it never overwrites its source automatically.
                    setRecovery(null);
                    setRecoveryReady(true);
                  });
                }}
              >
                Recover
              </button>
              <button
                onClick={() => {
                  void saveDocumentRecovery(null).then(() => {
                    setRecovery(null);
                    setRecoveryReady(true);
                  });
                }}
              >
                Discard recovery
              </button>
            </div>
          )}
        </div>
      </div>
    ) : null;
  return { save, confirmReplace, dialog };
}
