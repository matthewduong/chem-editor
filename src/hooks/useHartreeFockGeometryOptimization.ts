import { useCallback, useMemo, useRef, useState } from 'react';
import type { Viewer3DMolecule } from '../lib/viewer3d';
import type { ViewerOrbitalBasis } from '../types/settings';
import { invokeTauri } from '../lib/tauri';

interface OptimizationAtom {
  element: string;
  x: number;
  y: number;
  z: number;
  atomMapNum?: number | null;
}

interface OptimizationBond {
  a1: number;
  a2: number;
  order: number;
}

export interface HartreeFockOptimizedConformer {
  structureKey: string;
  forceField: 'hartree-fock';
  atoms: OptimizationAtom[];
  bonds: OptimizationBond[];
  energyHartree?: number;
  warnings?: string[];
}

interface OptimizationResponse extends HartreeFockOptimizedConformer {
  error?: string;
  fallback?: boolean;
}

export interface HartreeFockGeometryOptimizationOptions {
  enabled: boolean;
  smiles: string;
  molblock: string;
  molecule: Viewer3DMolecule | null;
  basis: ViewerOrbitalBasis;
  charge: number | null;
}

const optimizationCache = new Map<string, HartreeFockOptimizedConformer>();
const inFlightOptimizationCache = new Map<string, Promise<HartreeFockOptimizedConformer>>();
const OPTIMIZATION_REQUEST_TIMEOUT_MS = 90000;
const OPTIMIZATION_CACHE_VERSION = 1;

function buildGeometrySignature(molecule: Viewer3DMolecule | null) {
  if (!molecule) return '';
  return molecule.atoms
    .map((atom) => `${atom.element}:${atom.x.toFixed(4)}:${atom.y.toFixed(4)}:${atom.z.toFixed(4)}`)
    .join('|');
}

function resolveStructureKey(smiles: string, molblock: string, molecule: Viewer3DMolecule | null) {
  return molblock.trim() || smiles.trim() || buildGeometrySignature(molecule);
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
  return 'HF geometry optimization failed';
}

async function requestOptimizedGeometry(
  smiles: string,
  molblock: string,
  molecule: Viewer3DMolecule,
  basis: ViewerOrbitalBasis,
  charge: number | null,
): Promise<HartreeFockOptimizedConformer> {
  const trimmedMolblock = molblock.trim();
  const trimmedSmiles = smiles.trim();
  const structureKey = resolveStructureKey(smiles, molblock, molecule);
  const cacheKey = `${OPTIMIZATION_CACHE_VERSION}|${structureKey}|${basis}|${charge ?? 'na'}|${buildGeometrySignature(molecule)}`;
  const cached = optimizationCache.get(cacheKey);
  if (cached) return cached;
  const inFlight = inFlightOptimizationCache.get(cacheKey);
  if (inFlight) return inFlight;

  const request = Promise.race([
    invokeTauri<OptimizationResponse>('optimize_hartree_fock_geometry', {
      smiles: trimmedMolblock ? undefined : trimmedSmiles || undefined,
      molblock: trimmedMolblock || undefined,
      atoms: molecule.atoms.map((atom) => ({
        element: atom.element,
        x: atom.x,
        y: atom.y,
        z: atom.z,
        atomMapNum: atom.atomMapNum,
      })),
      bonds: molecule.bonds.map((bond) => ({
        a1: bond.a1,
        a2: bond.a2,
        order: bond.order,
      })),
      basis,
      charge: charge ?? undefined,
    }),
    new Promise<never>((_, reject) => {
      window.setTimeout(
        () => reject(new Error('HF geometry optimization timed out')),
        OPTIMIZATION_REQUEST_TIMEOUT_MS,
      );
    }),
  ])
    .then((result) => {
      if (result.error) throw new Error(result.error);
      const normalized: HartreeFockOptimizedConformer = {
        structureKey,
        forceField: 'hartree-fock',
        atoms: result.atoms ?? [],
        bonds: result.bonds ?? [],
        energyHartree: result.energyHartree,
        warnings: result.warnings ?? [],
      };
      if (optimizationCache.size >= 12)
        optimizationCache.delete(optimizationCache.keys().next().value!);
      optimizationCache.set(cacheKey, normalized);
      return normalized;
    })
    .finally(() => {
      inFlightOptimizationCache.delete(cacheKey);
    });

  inFlightOptimizationCache.set(cacheKey, request);
  return request;
}

export function useHartreeFockGeometryOptimization({
  enabled,
  smiles,
  molblock,
  molecule,
  basis,
  charge,
}: HartreeFockGeometryOptimizationOptions) {
  const [result, setResult] = useState<HartreeFockOptimizedConformer | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestSerialRef = useRef(0);

  const requestKey = useMemo(() => {
    if (!enabled || !molecule) return null;
    const structureKey = resolveStructureKey(smiles, molblock, molecule);
    return `${OPTIMIZATION_CACHE_VERSION}|${structureKey}|${basis}|${charge ?? 'na'}|${buildGeometrySignature(molecule)}`;
  }, [basis, charge, enabled, molecule, molblock, smiles]);

  const optimize = useCallback(async () => {
    if (!enabled || !molecule || !requestKey) return null;
    const cached = optimizationCache.get(requestKey);
    if (cached) {
      setActiveKey(requestKey);
      setResult(cached);
      setError(null);
      setPendingKey(null);
      return cached;
    }

    const serial = requestSerialRef.current + 1;
    requestSerialRef.current = serial;
    setPendingKey(requestKey);
    setError(null);

    try {
      const next = await requestOptimizedGeometry(smiles, molblock, molecule, basis, charge);
      if (requestSerialRef.current !== serial) return null;
      setActiveKey(requestKey);
      setResult(next);
      return next;
    } catch (value: unknown) {
      if (requestSerialRef.current !== serial) return null;
      setError(describeError(value));
      return null;
    } finally {
      if (requestSerialRef.current === serial) setPendingKey(null);
    }
  }, [basis, charge, enabled, molecule, molblock, requestKey, smiles]);

  const cachedResult = requestKey ? (optimizationCache.get(requestKey) ?? null) : null;
  const effectiveResult =
    enabled && requestKey ? (activeKey === requestKey ? result : cachedResult) : null;

  return {
    result: effectiveResult,
    warnings: effectiveResult?.warnings ?? [],
    loading: Boolean(enabled && requestKey && pendingKey === requestKey),
    error: enabled && requestKey ? error : null,
    optimize,
  };
}
