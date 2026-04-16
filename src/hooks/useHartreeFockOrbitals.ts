import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import type { Viewer3DMolecule, ViewerOrbitalMesh, ViewerOrbitalResult } from '../lib/viewer3d';
import { buildOrbitalMesh } from '../lib/orbitalMesh';
import type { ViewerOrbitalBasis } from '../types/settings';
import { invokeTauri } from '../lib/tauri';

interface OrbitalResponse extends ViewerOrbitalResult {
  error?: string;
  fallback?: boolean;
}

const orbitalCache = new Map<string, ViewerOrbitalResult>();
const inFlightOrbitalCache = new Map<string, Promise<ViewerOrbitalResult>>();
const orbitalMeshCache = new Map<string, ViewerOrbitalMesh | null>();
const ORBITAL_REQUEST_TIMEOUT_MS = 60000;
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
): Promise<ViewerOrbitalResult> {
  const trimmedMolblock = molblock.trim();
  const trimmedSmiles = smiles.trim();
  const structureKey = trimmedMolblock || trimmedSmiles || buildGeometrySignature(molecule);
  const key = `${ORBITAL_CACHE_VERSION}|${structureKey}|${basis}|${charge ?? 'na'}|${buildGeometrySignature(molecule)}`;
  const cached = orbitalCache.get(key);
  if (cached) return cached;
  const inFlight = inFlightOrbitalCache.get(key);
  if (inFlight) return inFlight;

  const request = Promise.race([
    invokeTauri<OrbitalResponse>('calculate_orbitals', {
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
    }),
    new Promise<never>((_, reject) => {
      window.setTimeout(
        () => reject(new Error('HF orbital calculation timed out')),
        ORBITAL_REQUEST_TIMEOUT_MS,
      );
    }),
  ])
    .then((result) => {
      if (result.error) throw new Error(result.error);
      if (!result.grid) throw new Error('HF orbital calculation returned no volumetric grid');
      const normalized: ViewerOrbitalResult = {
        basis: result.basis,
        orbitals: result.orbitals ?? [],
        grid: result.grid,
        fields: result.fields ?? {},
        warnings: result.warnings ?? [],
      };
      if (orbitalCache.size >= 24) orbitalCache.delete(orbitalCache.keys().next().value!);
      orbitalCache.set(key, normalized);
      return normalized;
    })
    .finally(() => {
      inFlightOrbitalCache.delete(key);
    });

  inFlightOrbitalCache.set(key, request);
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

  const requestKey = useMemo(() => {
    if (!enabled || !molecule) return null;
    const structureKey = molblock.trim() || smiles.trim() || buildGeometrySignature(molecule);
    return `${ORBITAL_CACHE_VERSION}|${structureKey}|${basis}|${charge ?? 'na'}|${buildGeometrySignature(molecule)}`;
  }, [basis, charge, enabled, molblock, molecule, smiles]);

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
    const cached = orbitalCache.get(requestKey);
    if (cached) {
      applyResult(cached, requestKey);
      setPendingKey(null);
      return;
    }

    const serial = requestSerialRef.current + 1;
    requestSerialRef.current = serial;
    setPendingKey(requestKey);
    setError(null);
    fetchOrbitals(smiles, molblock, molecule, basis, charge)
      .then((next) => {
        if (requestSerialRef.current !== serial) return;
        applyResult(next, requestKey);
      })
      .catch((err: unknown) => {
        if (requestSerialRef.current !== serial) return;
        setError(describeError(err));
      })
      .finally(() => {
        if (requestSerialRef.current !== serial) return;
        setPendingKey(null);
      });
  }, [applyResult, basis, charge, enabled, molblock, molecule, requestKey, smiles]);

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
  const effectiveError = enabled && requestKey ? error : null;
  const deferredIsovalue = useDeferredValue(isovalue);
  const resultGrid = effectiveResult?.grid ?? null;
  const selectedField =
    effectiveSelectedOrbitalKey && effectiveResult
      ? (effectiveResult.fields[effectiveSelectedOrbitalKey] ?? null)
      : null;
  const selectedMesh = useMemo<ViewerOrbitalMesh | null>(() => {
    if (!requestKey || !selectedField || !resultGrid) return null;
    const meshKey = `${requestKey}|${selectedField.key}|${deferredIsovalue.toFixed(4)}`;
    if (orbitalMeshCache.has(meshKey)) return orbitalMeshCache.get(meshKey) ?? null;
    const nextMesh = buildOrbitalMesh(selectedField, resultGrid, deferredIsovalue);
    if (orbitalMeshCache.size >= 72) orbitalMeshCache.delete(orbitalMeshCache.keys().next().value!);
    orbitalMeshCache.set(meshKey, nextMesh);
    return nextMesh;
  }, [deferredIsovalue, requestKey, resultGrid, selectedField]);

  return {
    result: effectiveResult,
    orbitals: effectiveResult?.orbitals ?? [],
    warnings: effectiveResult?.warnings ?? [],
    selectedOrbitalKey: effectiveSelectedOrbitalKey,
    setSelectedOrbitalKey,
    selectedMesh,
    loading,
    error: effectiveError,
    stale,
    calculate,
  };
}
