import { useEffect, useState } from 'react';
import type { RdkitModule } from '../types/rdkit';

declare global {
  interface Window {
    initRDKitModule: (options: { locateFile: () => string }) => Promise<RdkitModule>;
  }
}

let rdkitPromise: Promise<RdkitModule> | null = null;

export function useRDKit() {
  const [rdkit, setRdkit] = useState<RdkitModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!rdkitPromise) {
      rdkitPromise = window.initRDKitModule({
        locateFile: () => '/rdkit/RDKit_minimal.wasm',
      });
    }
    rdkitPromise
      .then((instance) => {
        setRdkit(instance);
        setLoading(false);
      })
      .catch((e) => {
        console.error('RDKit WASM failed to load:', e);
        setLoading(false);
        setFailed(true);
      });
  }, []);

  return { rdkit, loading, failed };
}
