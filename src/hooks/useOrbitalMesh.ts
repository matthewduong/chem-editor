import { useEffect, useMemo, useState } from 'react';
import { OrbitalMeshClient } from '../workers/orbitalMeshClient';
import { orbitalBufferCache } from '../lib/orbitalCache';
import type { ViewerOrbitalMesh, ViewerOrbitalResult } from '../lib/viewer3d';
export function useOrbitalMesh(
  result: ViewerOrbitalResult | null,
  structureKey: string | null,
  fieldKey: string | null,
  isovalue: number,
) {
  const client = useMemo(() => new OrbitalMeshClient(), []);
  const [state, setState] = useState<{
    result: ViewerOrbitalResult;
    mesh: ViewerOrbitalMesh;
    key: string;
  } | null>(null);
  const [error, setError] = useState<{ result: ViewerOrbitalResult; message: string } | null>(null);
  useEffect(() => () => client.dispose(), [client]);
  useEffect(() => {
    if (!result || !fieldKey || !structureKey) {
      client.dispose();
      return;
    }
    let active = true;
    const key = `mesh:${structureKey}|${fieldKey}|${isovalue}`;
    const timer = setTimeout(() => {
      const cached = orbitalBufferCache.get(key);
      if (cached?.kind === 'mesh') {
        orbitalBufferCache.delete(key);
        setState({ result, mesh: cached.value, key });
        setError(null);
        return;
      }
      void client
        .mesh(result, fieldKey, isovalue)
        .then((mesh) => {
          if (active) {
            setState({ result, mesh, key });
            setError(null);
          }
        })
        .catch((value: unknown) => {
          if (active)
            setError({ result, message: value instanceof Error ? value.message : String(value) });
        });
    }, 100);
    return () => {
      active = false;
      clearTimeout(timer);
      client.cancel();
    };
  }, [client, result, structureKey, fieldKey, isovalue]);
  useEffect(
    () => () => {
      if (state) orbitalBufferCache.set(state.key, { kind: 'mesh', value: state.mesh });
    },
    [state],
  );
  return {
    mesh: state?.result === result ? state.mesh : null,
    error: error?.result === result ? error.message : null,
  };
}
