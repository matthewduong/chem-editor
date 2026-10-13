import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { invokeTauri } from '../lib/tauri';
import { emptyTemplateLibrary, parseTemplateLibrary, type TemplateLibrary } from '../lib/templates';

export function useTemplateLibrary() {
  const [library, setLibrary] = useState<TemplateLibrary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const raw = useRef<string | null>(null);
  const locked = useRef(false);
  useEffect(() => {
    let active = true;
    if (!isTauri()) {
      setLibrary(emptyTemplateLibrary());
      return;
    }
    invokeTauri<string | null>('load_template_library')
      .then((text) => {
        const parsed = text === null ? emptyTemplateLibrary() : parseTemplateLibrary(text);
        if (active) {
          raw.current = text;
          setLibrary(parsed);
        }
      })
      .catch((error) => {
        if (active)
          setError(`Cannot load templates: ${String(error)} The original library was retained.`);
      });
    return () => {
      active = false;
    };
  }, []);
  const update = async (next: TemplateLibrary) => {
    if (!library || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      const contents = JSON.stringify(next);
      parseTemplateLibrary(contents);
      if (isTauri())
        await invokeTauri('save_template_library', { contents, expected: raw.current });
      raw.current = contents;
      setLibrary(next);
      setError(null);
    } catch (error) {
      setError(`Cannot save templates: ${String(error)} The prior library was retained.`);
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return { library, error, busy, update, persistent: isTauri() };
}
