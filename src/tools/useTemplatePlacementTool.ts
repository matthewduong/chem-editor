import { useMemo, useRef } from 'react';
import { ToolLifecycle } from '../editor/toolLifecycle';
import { placeTemplate, type UserTemplate } from '../lib/templates';
import type { ChemDrawDocument } from '../types/chemdraw';
import { useStore } from '../store';

/**
 * Template placement on the shared gesture contract. It is armed rather than pressed: after
 * `arm`, the preview follows the pointer and one click commits it as a single undo step.
 * `placeTemplate` is the same pure call for the preview and the commit, so they cannot differ.
 *
 * A placement armed on one document is discarded if the document is replaced before the
 * click, and Escape, a tool change or a cancelled pointer disarm it.
 */
export function useTemplatePlacementTool() {
  const lifecycle = useRef(new ToolLifecycle<null, ChemDrawDocument | null>());
  const armed = useRef<UserTemplate | null>(null);
  // Only refs and the store are used, so one stable object serves every render.
  return useMemo(() => {
    const cancel = () => {
      const wasArmed = armed.current !== null;
      lifecycle.current.cancel();
      armed.current = null;
      if (wasArmed) useStore.getState().clearPreviewChemDrawDocument();
    };
    return {
      isActive: () => armed.current !== null,
      arm(template: UserTemplate) {
        const store = useStore.getState();
        store.deselectAll();
        lifecycle.current.begin(store.chemDrawDocument, {
          point: { x: 0, y: 0 },
          hit: null,
          modifiers: { primary: false, shift: false },
        });
        armed.current = template;
        store.showToast(
          'Click to place the template. Hold Shift over an atom or bond to attach; Escape cancels.',
          'info',
        );
      },
      /** Preview at the pointer. `attachTargetId` is the atom or bond under it when attaching. */
      update(pos: { x: number; y: number }, attachTargetId?: string) {
        const template = armed.current;
        const store = useStore.getState();
        if (!template || !store.chemDrawDocument) return;
        try {
          store.setPreviewChemDrawDocument(
            placeTemplate(store.chemDrawDocument, template, pos, attachTargetId).document,
          );
        } catch {
          store.clearPreviewChemDrawDocument();
        }
      },
      /** Place the template at the pointer. Always disarms; a failure is reported, not thrown. */
      commit(pos: { x: number; y: number }, attachTargetId?: string) {
        const template = armed.current;
        const store = useStore.getState();
        const accepted = lifecycle.current.commit(store.chemDrawDocument);
        armed.current = null;
        try {
          if (!template || !accepted || !store.chemDrawDocument) return;
          const result = placeTemplate(store.chemDrawDocument, template, pos, attachTargetId);
          store.commitDocument(result.document);
          store.setSelectedObjectIds(new Set(result.objectIds));
        } catch (error) {
          store.showToast(error instanceof Error ? error.message : 'Template insertion failed.');
        } finally {
          store.clearPreviewChemDrawDocument();
        }
      },
      cancel,
    };
  }, []);
}
