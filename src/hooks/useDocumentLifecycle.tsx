import { setDocumentQuitGuard, documentChangesBlocked } from '../store/documentGuard';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { shouldAutosave } from '../lib/autosave';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import type { ChemCanvasRef } from '../components/ChemCanvas';
import { useStore } from '../store';
import { getCurrentAppWindow, invokeTauri, openDocumentWindow } from '../lib/tauri';
import {
  listDocumentRecovery,
  flushRecoveryWrites,
  claimDocumentRecovery,
  discardDocumentRecovery,
  saveDocumentRecovery,
  type DocumentRecovery,
} from '../lib/documentRecovery';

type Decision = 'save' | 'discard' | 'cancel';

export function useDocumentLifecycle(canvas: RefObject<ChemCanvasRef | null>) {
  const decisionRef = useRef<((decision: Decision) => void) | null>(null);
  const [action, setAction] = useState<string | null>(null);
  const [recoveries, setRecoveries] = useState<DocumentRecovery[]>([]);
  const recovery = recoveries[0] ?? null;
  const quitToken = useRef<string | null>(null);
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

  // Save Files Every N minutes, when the preference is on and the file may be saved over.
  const autosaveMinutes = useStore((s) => s.appPreferences.autosaveMinutes);
  useEffect(() => {
    if (autosaveMinutes <= 0) return;
    const timer = window.setInterval(() => {
      if (shouldAutosave(autosaveMinutes, useStore.getState().documentFile)) void save(false);
    }, autosaveMinutes * 60_000);
    return () => window.clearInterval(timer);
  }, [autosaveMinutes, save]);

  const confirmReplace = useCallback(
    async (nextAction: string, deferDiscard = false): Promise<boolean> => {
      if (documentChangesBlocked()) return false;
      if (!useStore.getState().documentFile.dirty) return true;
      if (decisionRef.current) return false;
      const decision = await new Promise<Decision>((resolve) => {
        decisionRef.current = resolve;
        setAction(nextAction);
      });
      if (decision === 'cancel') return false;
      if (decision === 'save') return save();
      if (!deferDiscard) await saveDocumentRecovery(null);
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
    const requested = new URLSearchParams(window.location.search).get('recovery');
    const task =
      requested && isTauri()
        ? claimDocumentRecovery(requested).then((value) => {
            useStore.getState().replaceDocument(value.document);
            return [];
          })
        : listDocumentRecovery((message) => useStore.getState().showToast(message));
    void task
      .then((value) => {
        if (!mounted) return;
        setRecoveries(value);
        setRecoveryReady(value.length === 0);
      })
      .catch((error) => {
        if (!mounted) return;
        useStore.getState().showToast(`Could not read recovery data: ${String(error)}`);
        // New snapshots have independent IDs; unreadable files remain intact.
        setRecoveryReady(true);
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
        if (documentChangesBlocked() || !state.documentFile.dirty || !state.chemDrawDocument)
          return;
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
    const requestClose = async () => {
      if (closeInFlight.current || quitToken.current) return;
      closeInFlight.current = true;
      try {
        if (!(await confirmReplace('Close'))) return;
        await saveDocumentRecovery(null);
        await getCurrentAppWindow().destroy();
      } finally {
        closeInFlight.current = false;
      }
    };
    register(
      getCurrentAppWindow().onCloseRequested((event) => {
        event.preventDefault();
        void requestClose();
      }),
    );
    register(
      listen<string>('document-quit-requested', ({ payload: token }) => {
        if (quitToken.current) return;
        quitToken.current = token;
        void (async () => {
          try {
            // Confirm receipt first: the coordinator only abandons a quit for silent windows.
            await invokeTauri('receive_document_quit', { token });
            const ready = !closeInFlight.current && (await confirmReplace('Quit', true));
            if (quitToken.current !== token) return;
            if (ready) {
              setDocumentQuitGuard(token);
              await flushRecoveryWrites();
            }
            await invokeTauri('acknowledge_document_quit', { token, ready });
          } catch (error) {
            setDocumentQuitGuard(null);
            quitToken.current = null;
            // Withdraw this window's vote, or the coordinator would wait on it forever and every
            // later quit would be ignored. Aborting an attempt twice is harmless.
            void invokeTauri('acknowledge_document_quit', { token, ready: false }).catch(() => {});
            useStore.getState().showToast(`Quit cancelled: ${String(error)}`);
          }
        })();
      }),
    );
    register(
      listen<string>('document-quit-cancelled', ({ payload: token }) => {
        if (quitToken.current !== token) return;
        quitToken.current = null;
        setDocumentQuitGuard(null);
        resolveDecision('cancel');
      }),
    );
    return () => {
      disposed = true;
      cleanup.forEach((fn) => fn());
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [confirmReplace, resolveDecision]);

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
              : `${recoveries.length} unsaved drawing(s). Drawing from ${recovery?.savedAt} can be recovered in a new window.`}
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
                  if (isTauri() && recovery.id) openDocumentWindow(recovery.id);
                  else useStore.getState().replaceDocument(recovery.document);
                  setRecoveries((items) => items.slice(1));
                  if (recoveries.length === 1) setRecoveryReady(true);
                }}
              >
                Recover
              </button>
              <button
                onClick={() => {
                  void discardDocumentRecovery(recovery?.id).then(() => {
                    setRecoveries((items) => items.slice(1));
                    if (recoveries.length === 1) setRecoveryReady(true);
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
