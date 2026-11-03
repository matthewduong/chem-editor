import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import type { Viewer3DMolecule, ViewerOrbitalResult } from '../lib/viewer3d';
import { useOrbitalMesh } from './useOrbitalMesh';
import { orbitalCache } from '../lib/orbitalCache';
import type { ViewerOrbitalBasis } from '../types/settings';
import { invokeScientific } from '../lib/scientificJobs';

interface OrbitalResponse extends ViewerOrbitalResult {
  error?: string;
  fallback?: boolean;
}

const ORBITAL_CACHE_VERSION = 2;

function buildGeometrySignature(molecule: Viewer3DMolecule | null) {
  if (!molecule) return '';
  return molecule.atoms
    .map((atom) => `${atom.element}:${atom.x.toFixed(4)}:${atom.y.toFixed(4)}:${atom.z.toFixed(4)}`)
    .join('|');
}

async function fetchOrbitals(
  smiles: string,
  molblock: string,
  molecule: Viewer3DMolecule,
  basis: ViewerOrbitalBasis,
  charge: number | null,
  signal?: AbortSignal,
): Promise<ViewerOrbitalResult> {
  const trimmedMolblock = molblock.trim();
  const trimmedSmiles = smiles.trim();
  const structureKey = trimmedMolblock || trimmedSmiles || buildGeometrySignature(molecule);
  const key = `${ORBITAL_CACHE_VERSION}|${structureKey}|${basis}|${charge ?? 'na'}|${buildGeometrySignature(molecule)}`;
  const cached = orbitalCache.get(key);
  if (cached) return cached;

  const request = invokeScientific<OrbitalResponse>(
    'calculate_orbitals',
    {
      smiles: trimmedMolblock ? undefined : trimmedSmiles || undefined,
      molblock: trimmedMolblock || undefined,
      atoms: molecule.atoms.map((atom) => ({
        element: atom.element,
        x: atom.x,
        y: atom.y,
        z: atom.z,
        atomMapNum: atom.atomMapNum,
      })),
      basis,
      charge: charge ?? undefined,
    },
    signal,
  ).then((result) => {
    if (result.error) throw new Error(result.error);
    if (!result.grid) throw new Error('HF orbital calculation returned no volumetric grid');
    const normalized: ViewerOrbitalResult = {
      basis: result.basis,
      orbitals: result.orbitals ?? [],
      grid: result.grid,
      fields: Object.fromEntries(
        Object.entries(result.fields ?? {}).map(([key, field]) => [
          key,
          { ...field, values: new Float64Array(field.values) },
        ]),
      ),
      warnings: result.warnings ?? [],
    };

    return normalized;
  });

  return request;
}

function describeError(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string' && value.trim()) return value;
  if (
    typeof value === 'object' &&
    value &&
    'message' in value &&
    typeof (value as { message?: unknown }).message === 'string'
  ) {
    return (value as { message: string }).message;
  }
  return 'Orbital calculation failed';
}

export interface HartreeFockOrbitalOptions {
  enabled: boolean;
  smiles: string;
  molblock: string;
  molecule: Viewer3DMolecule | null;
  basis: ViewerOrbitalBasis;
  isovalue: number;
  charge: number | null;
}

export function useHartreeFockOrbitals({
  enabled,
  smiles,
  molblock,
  molecule,
  basis,
  isovalue,
  charge,
}: HartreeFockOrbitalOptions) {
  const [result, setResult] = useState<ViewerOrbitalResult | null>(null);
  const [selectedOrbitalKey, setSelectedOrbitalKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSerialRef = useRef(0);
  const controllerRef = useRef<AbortController | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const requestKey = useMemo(() => {
    if (!enabled || !molecule) return null;
    const structureKey = molblock.trim() || smiles.trim() || buildGeometrySignature(molecule);
    return `${ORBITAL_CACHE_VERSION}|${structureKey}|${basis}|${charge ?? 'na'}|${buildGeometrySignature(molecule)}`;
  }, [basis, charge, enabled, molblock, molecule, smiles]);

  useEffect(() => {
    requestSerialRef.current += 1;
    controllerRef.current?.abort();
    return () => {
      requestSerialRef.current += 1;
      controllerRef.current?.abort();
    };
  }, [requestKey]);
  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  const applyResult = useCallback((next: ViewerOrbitalResult, key: string) => {
    setActiveKey(key);
    setResult(next);
    setError(null);
    setSelectedOrbitalKey((current) => {
      if (current && next.orbitals.some((orbital) => orbital.key === current)) return current;
      return (
        next.orbitals.find((orbital) => orbital.label === 'HOMO')?.key ??
        next.orbitals[0]?.key ??
        null
      );
    });
  }, []);

  const calculate = useCallback(() => {
    if (!enabled || !molecule || !requestKey) return;
    controllerRef.current?.abort();
    requestSerialRef.current += 1;
    // The displayed result is held outside the inactive-buffer cache, so check it first.
    const cached = (activeKey === requestKey ? result : null) ?? orbitalCache.get(requestKey);
    if (cached) {
      applyResult(cached, requestKey);
      setPendingKey(null);
      return;
    }

    const serial = requestSerialRef.current + 1;
    requestSerialRef.current = serial;
    const controller = new AbortController();
    controllerRef.current = controller;
    setErrorKey(requestKey);
    setPendingKey(requestKey);
    setError(null);
    fetchOrbitals(smiles, molblock, molecule, basis, charge, controller.signal)
      .then((next) => {
        if (requestSerialRef.current !== serial) return;
        applyResult(next, requestKey);
      })
      .catch((err: unknown) => {
        // A cancellation the user asked for is not a failure to report.
        if (requestSerialRef.current !== serial || controller.signal.aborted) return;
        setError(describeError(err));
      })
      .finally(() => {
        if (requestSerialRef.current !== serial) return;
        setPendingKey(null);
      });
  }, [
    activeKey,
    applyResult,
    basis,
    charge,
    enabled,
    molblock,
    molecule,
    requestKey,
    result,
    smiles,
  ]);

  const cachedResult = requestKey ? (orbitalCache.get(requestKey) ?? null) : null;
  const effectiveResult =
    enabled && requestKey ? (activeKey === requestKey ? result : cachedResult) : null;
  const effectiveSelectedOrbitalKey =
    selectedOrbitalKey &&
    effectiveResult?.orbitals.some((orbital) => orbital.key === selectedOrbitalKey)
      ? selectedOrbitalKey
      : (effectiveResult?.orbitals.find((orbital) => orbital.label === 'HOMO')?.key ??
        effectiveResult?.orbitals[0]?.key ??
        null);
  const stale = Boolean(
    enabled && requestKey && activeKey && activeKey !== requestKey && !cachedResult,
  );
  const loading = Boolean(enabled && requestKey && pendingKey === requestKey);
  const effectiveError = enabled && requestKey && errorKey === requestKey ? error : null;
  const meshState = useOrbitalMesh(
    effectiveResult,
    requestKey,
    effectiveSelectedOrbitalKey,
    isovalue,
  );
  useEffect(() => {
    if (!effectiveResult || !requestKey) return;
    orbitalCache.delete(requestKey);
    return () => {
      orbitalCache.set(requestKey, effectiveResult);
    };
  }, [effectiveResult, requestKey]);

  return {
    cancel,
    result: effectiveResult,
    orbitals: effectiveResult?.orbitals ?? [],
    warnings: effectiveResult?.warnings ?? [],
    selectedOrbitalKey: effectiveSelectedOrbitalKey,
    setSelectedOrbitalKey,
    selectedMesh: meshState.mesh,
    loading,
    error: effectiveError ?? meshState.error,
    stale,
    calculate,
  };
}
