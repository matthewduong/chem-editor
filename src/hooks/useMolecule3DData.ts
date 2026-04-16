import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import type { Viewer3DAtom, Viewer3DBond, Viewer3DMolecule } from '../lib/viewer3d';
import type { ViewerForceField } from '../types/settings';
import {
  alignViewerConformerSeries,
  normalizeViewerElementSymbol,
  viewer3DMoleculeFromMolblock,
} from '../lib/viewer3d';
import { invokeTauri } from '../lib/tauri';

interface ConformerResult {
  error?: string;
  bonds?: Viewer3DBond[];
  conformers?: Array<{ atoms: Viewer3DAtom[]; energy?: number; delta_e?: number }>;
}

const conformerCache = new Map<string, Viewer3DMolecule[]>();
const inFlightConformerCache = new Map<string, Promise<Viewer3DMolecule[]>>();
const CONFORMER_REQUEST_TIMEOUT_MS = 45000;
const CONFORMER_CACHE_VERSION = 3;
const prepareViewerConformers = (nextConformers: Viewer3DMolecule[]) =>
  alignViewerConformerSeries(nextConformers);
const METAL_ELEMENTS = new Set([
  'Li',
  'Be',
  'Na',
  'Mg',
  'Al',
  'K',
  'Ca',
  'Sc',
  'Ti',
  'V',
  'Cr',
  'Mn',
  'Fe',
  'Co',
  'Ni',
  'Cu',
  'Zn',
  'Ga',
  'Rb',
  'Sr',
  'Y',
  'Zr',
  'Nb',
  'Mo',
  'Tc',
  'Ru',
  'Rh',
  'Pd',
  'Ag',
  'Cd',
  'In',
  'Sn',
  'Cs',
  'Ba',
  'La',
  'Ce',
  'Pr',
  'Nd',
  'Pm',
  'Sm',
  'Eu',
  'Gd',
  'Tb',
  'Dy',
  'Ho',
  'Er',
  'Tm',
  'Yb',
  'Lu',
  'Hf',
  'Ta',
  'W',
  'Re',
  'Os',
  'Ir',
  'Pt',
  'Au',
  'Hg',
  'Tl',
  'Pb',
  'Bi',
  'Po',
  'Fr',
  'Ra',
  'Ac',
  'Th',
  'Pa',
  'U',
  'Np',
  'Pu',
  'Am',
  'Cm',
  'Bk',
  'Cf',
  'Es',
  'Fm',
  'Md',
  'No',
  'Lr',
  'Rf',
  'Db',
  'Sg',
  'Bh',
  'Hs',
  'Mt',
  'Ds',
  'Rg',
  'Cn',
  'Nh',
  'Fl',
  'Mc',
  'Lv',
]);

function molblockContainsMetal(molblock: string): boolean {
  if (!molblock.trim()) return false;
  const lines = molblock.split('\n');
  const countsLine = lines[3];
  if (!countsLine || countsLine.length < 6) return false;
  const atomCount = Number.parseInt(countsLine.slice(0, 3).trim(), 10);
  if (!Number.isFinite(atomCount) || atomCount <= 0) return false;

  for (let index = 0; index < atomCount; index += 1) {
    const line = lines[index + 4];
    if (!line || line.length < 34) continue;
    if (METAL_ELEMENTS.has(normalizeViewerElementSymbol(line.slice(31, 34)))) return true;
  }
  return false;
}

function buildStructureIdentity(smiles: string, molblock: string) {
  return molblock.trim() || smiles.trim();
}

function normalizeRawConformerAtoms(
  atoms: Array<{ x: number; y: number; z: number; element: string; atomMapNum?: number | null }>,
): Viewer3DAtom[] {
  return atoms.map((atom) => ({
    x: atom.x,
    y: atom.y,
    z: atom.z,
    element: atom.element,
    atomMapNum: atom.atomMapNum ?? undefined,
  }));
}

async function fetchConformers(
  smiles: string,
  molblock: string,
  forceField: string,
  maxConformers: number,
  preferSmilesInput: boolean,
): Promise<Viewer3DMolecule[]> {
  // Prefer mapped SMILES when available so RDKit builds the same chemistry-aware
  // graph used elsewhere, while atom-map numbers keep canvas/viewer sync stable.
  const useSmilesInput = preferSmilesInput || !molblock;
  const structureKey = useSmilesInput ? smiles : molblock;
  const key = `${CONFORMER_CACHE_VERSION}|${structureKey}|${forceField}|${maxConformers}`;
  const cached = conformerCache.get(key);
  if (cached) return cached;
  const inFlight = inFlightConformerCache.get(key);
  if (inFlight) return inFlight;

  const request = Promise.race([
    invokeTauri<ConformerResult>('generate_conformers', {
      smiles: useSmilesInput ? smiles || undefined : undefined,
      molblock: useSmilesInput ? undefined : molblock || undefined,
      forceField,
      maxConformers,
    }),
    new Promise<never>((_, reject) => {
      window.setTimeout(
        () => reject(new Error('3D generation timed out')),
        CONFORMER_REQUEST_TIMEOUT_MS,
      );
    }),
  ])
    .then((result) => {
      if (result.error) throw new Error(result.error);
      const bonds = result.bonds || [];
      const conformers = result.conformers || [];
      const data = conformers.map((conformer) => ({
        atoms: (conformer.atoms || []).map((atom) => ({
          ...atom,
          element: normalizeViewerElementSymbol(atom.element),
        })),
        bonds,
        energy: conformer.energy,
        delta_e: conformer.delta_e,
      }));
      if (conformerCache.size >= 50) conformerCache.delete(conformerCache.keys().next().value!);
      conformerCache.set(key, data);
      return data;
    })
    .finally(() => {
      inFlightConformerCache.delete(key);
    });

  inFlightConformerCache.set(key, request);
  return request;
}

export interface Molecule3DDataOptions {
  smiles: string;
  geometrySmiles?: string;
  preferSmilesGeometry?: boolean;
  forceField: ViewerForceField;
  multiConformer: boolean;
  maxConformers: number;
}

export function useMolecule3DData({
  smiles,
  geometrySmiles = '',
  preferSmilesGeometry = false,
  forceField,
  multiConformer,
  maxConformers,
}: Molecule3DDataOptions) {
  const minimizeGeometry = useStore((s) => s.minimizeGeometry);
  const rawConformer = useStore((s) => s.rawConformer);
  const viewerMolblock = useStore((s) => s.viewerMolblock);
  const viewerGeometryMolblock = useStore((s) => s.viewerGeometryMolblock);
  const viewerStructureStatus = useStore((s) => s.viewerStructureStatus);
  const viewerAtomIdByMapNumber = useStore((s) => s.viewerAtomIdByMapNumber);
  const setViewerAtomIndexById = useStore((s) => s.setViewerAtomIndexById);
  const [conformers, setConformers] = useState<Viewer3DMolecule[]>([]);
  const [confIndex, setConfIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSerialRef = useRef(0);
  const lastGeometryForceFieldRef = useRef<Exclude<ViewerForceField, 'hartree-fock'>>('UFF');

  useEffect(() => {
    if (forceField !== 'hartree-fock') {
      lastGeometryForceFieldRef.current = forceField;
    }
  }, [forceField]);

  const describeError = (value: unknown): string => {
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
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized !== '{}') return serialized;
    } catch {
      /* intentional */
    }
    return 'Engine Error';
  };

  useEffect(() => {
    const resetState = (next: {
      conformers?: Viewer3DMolecule[];
      confIndex?: number;
      loading?: boolean;
      error?: string | null;
    }) => {
      setConformers(prepareViewerConformers(next.conformers ?? []));
      setConfIndex(next.confIndex ?? 0);
      setLoading(next.loading ?? false);
      setError(next.error ?? null);
    };
    const getFallbackConformers = (): Viewer3DMolecule[] => {
      if (!viewerMolblock || !viewerStructureStatus.fallbackGeometryAvailable) return [];
      const fallbackMolecule = viewer3DMoleculeFromMolblock(viewerMolblock);
      return fallbackMolecule ? [{ ...fallbackMolecule, energy: undefined, delta_e: 0 }] : [];
    };

    const conformerMolblock = viewerGeometryMolblock || viewerMolblock;
    const conformerSmiles = preferSmilesGeometry ? geometrySmiles || smiles : smiles;
    const structureIdentity = buildStructureIdentity(conformerSmiles, conformerMolblock);
    const matchingRawConformer =
      rawConformer && rawConformer.structureKey === structureIdentity ? rawConformer : null;

    if (!smiles && !conformerMolblock) {
      requestSerialRef.current += 1;
      resetState({});
      return;
    }

    if (
      !viewerStructureStatus.chemistryAvailable &&
      viewerMolblock &&
      viewerStructureStatus.fallbackGeometryAvailable
    ) {
      if (!minimizeGeometry) {
        requestSerialRef.current += 1;
        const fallbackMolecule = viewer3DMoleculeFromMolblock(viewerMolblock);
        resetState({
          conformers: fallbackMolecule
            ? [{ ...fallbackMolecule, energy: undefined, delta_e: 0 }]
            : [],
          error:
            viewerStructureStatus.message ?? '3D optimization is unavailable for this structure',
        });
        return;
      }
      // When geometry minimization is on, try real conformer generation via the sidecar
      // even when SMILES-level chemistry is unavailable — the molblock's lead elements
      // are usually enough for RDKit Python to produce a 3D embedding.
    }

    if (
      !viewerStructureStatus.chemistryAvailable &&
      !viewerStructureStatus.fallbackGeometryAvailable
    ) {
      requestSerialRef.current += 1;
      resetState({
        error:
          viewerStructureStatus.message ?? '3D visualization is unavailable for this structure',
      });
      return;
    }

    if (forceField === 'hartree-fock' && matchingRawConformer?.forceField === 'hartree-fock') {
      requestSerialRef.current += 1;
      resetState({
        conformers: [
          {
            atoms: normalizeRawConformerAtoms(matchingRawConformer.atoms),
            bonds: matchingRawConformer.bonds,
            energy: matchingRawConformer.energyHartree,
            delta_e: 0,
          },
        ],
      });
      return;
    }

    if (!minimizeGeometry && matchingRawConformer) {
      requestSerialRef.current += 1;
      resetState({
        conformers: [
          {
            atoms: normalizeRawConformerAtoms(matchingRawConformer.atoms),
            bonds: matchingRawConformer.bonds,
            energy: matchingRawConformer.energyHartree,
            delta_e: 0,
          },
        ],
      });
      return;
    }

    if (!minimizeGeometry && !matchingRawConformer) {
      requestSerialRef.current += 1;
      resetState({
        error: 'No 3D conformer available',
      });
      return;
    }

    const serial = requestSerialRef.current + 1;
    requestSerialRef.current = serial;
    const limit = multiConformer ? maxConformers : 1;
    const geometryForceField =
      forceField === 'hartree-fock' ? lastGeometryForceFieldRef.current : forceField;
    const effectiveForceField =
      molblockContainsMetal(conformerMolblock) && geometryForceField === 'MMFF94s'
        ? 'UFF'
        : geometryForceField;
    queueMicrotask(() => {
      setLoading(true);
      setError(null);
    });

    fetchConformers(
      conformerSmiles,
      conformerMolblock,
      effectiveForceField,
      limit,
      preferSmilesGeometry,
    )
      .then((data) => {
        if (requestSerialRef.current !== serial) return;
        if (data.length === 0) {
          const fallbackConformers = getFallbackConformers();
          setError('No valid 3D geometry found');
          setConformers(prepareViewerConformers(fallbackConformers));
          setConfIndex(0);
          return;
        }
        setConformers(prepareViewerConformers(data));
        setConfIndex(0);
      })
      .catch((err: unknown) => {
        if (requestSerialRef.current !== serial) return;
        const fallbackConformers = getFallbackConformers();
        setConformers(prepareViewerConformers(fallbackConformers));
        setConfIndex(0);
        setError(describeError(err));
      })
      .finally(() => {
        if (requestSerialRef.current !== serial) return;
        setLoading(false);
      });
  }, [
    forceField,
    geometrySmiles,
    maxConformers,
    minimizeGeometry,
    multiConformer,
    preferSmilesGeometry,
    rawConformer,
    smiles,
    viewerGeometryMolblock,
    viewerMolblock,
    viewerStructureStatus,
  ]);

  useEffect(() => {
    if (Object.keys(viewerAtomIdByMapNumber).length === 0 || !conformers[confIndex]) return;
    const mapping: Record<string, number> = {};
    conformers[confIndex].atoms.forEach((atom, index) => {
      const atomId =
        atom.atomMapNum != null ? viewerAtomIdByMapNumber[String(atom.atomMapNum)] : undefined;
      if (atomId) mapping[atomId] = index;
    });
    setViewerAtomIndexById(mapping);
  }, [confIndex, conformers, setViewerAtomIndexById, viewerAtomIdByMapNumber]);

  const molecule = useMemo(() => conformers[confIndex] || null, [confIndex, conformers]);

  return {
    conformers,
    confIndex,
    setConfIndex,
    loading,
    error,
    molecule,
  };
}
