import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Viewer3DMolecule } from '../../src/lib/viewer3d';
import { useMolecule3DData } from '../../src/hooks/useMolecule3DData';
import { useStore } from '../../src/store';
import { createDeferred, flushMicrotasks, resetStore } from './helpers';

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
  alignViewerConformerSeries: vi.fn((molecules: Viewer3DMolecule[]) => molecules),
  viewer3DMoleculeFromMolblock: vi.fn(),
}));

vi.mock('../../src/lib/tauri.ts', () => ({
  invokeTauri: mocks.invokeTauri,
}));

vi.mock('../../src/lib/viewer3d.ts', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/lib/viewer3d')>('../../src/lib/viewer3d');
  return {
    ...actual,
    alignViewerConformerSeries: mocks.alignViewerConformerSeries,
    viewer3DMoleculeFromMolblock: mocks.viewer3DMoleculeFromMolblock,
  };
});

function validViewerStatus() {
  return {
    kind: 'valid' as const,
    chemistryAvailable: true,
    fallbackGeometryAvailable: true,
    message: null,
  };
}

function configureViewerState(overrides: Partial<ReturnType<typeof useStore.getState>> = {}) {
  resetStore({
    minimizeGeometry: true,
    viewerMolblock: '',
    viewerGeometryMolblock: '',
    viewerStructureStatus: validViewerStatus(),
    viewerAtomIdByMapNumber: {},
    viewerAtomIndexById: {},
    rawConformer: null,
    ...overrides,
  });
}

describe('useMolecule3DData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configureViewerState();
  });

  it('dedupes in-flight conformer requests, reuses the cache, and maps atom indices', async () => {
    const deferred = createDeferred<{
      bonds: Array<{ a1: number; a2: number; order: number }>;
      conformers: Array<{
        atoms: Array<{ element: string; x: number; y: number; z: number; atomMapNum?: number }>;
        energy: number;
        delta_e: number;
      }>;
    }>();
    mocks.invokeTauri.mockReturnValue(deferred.promise);
    configureViewerState({
      viewerAtomIdByMapNumber: {
        '7': 'canvas-atom-7',
      },
    });

    const options = {
      smiles: 'cache-smiles',
      geometrySmiles: '',
      preferSmilesGeometry: false,
      forceField: 'UFF' as const,
      multiConformer: true,
      maxConformers: 2,
    };

    const first = renderHook(() => useMolecule3DData(options));
    const second = renderHook(() => useMolecule3DData(options));

    expect(mocks.invokeTauri).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve({
        bonds: [{ a1: 0, a2: 0, order: 1 }],
        conformers: [
          {
            atoms: [{ element: 'C', x: 0, y: 0, z: 0, atomMapNum: 7 }],
            energy: -0.12,
            delta_e: 0,
          },
        ],
      });
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(first.result.current.molecule?.atoms[0].atomMapNum).toBe(7);
      expect(second.result.current.molecule?.atoms[0].atomMapNum).toBe(7);
    });

    expect(useStore.getState().viewerAtomIndexById).toEqual({ 'canvas-atom-7': 0 });

    const third = renderHook(() => useMolecule3DData(options));
    await waitFor(() => {
      expect(third.result.current.molecule?.atoms[0].element).toBe('C');
    });
    expect(mocks.invokeTauri).toHaveBeenCalledTimes(1);

    first.unmount();
    second.unmount();
    third.unmount();
  });

  it('falls back to viewer molblock geometry when chemistry is unavailable but fallback geometry exists', async () => {
    const fallbackMolecule: Viewer3DMolecule = {
      atoms: [{ element: 'O', x: 1, y: 2, z: 3 }],
      bonds: [{ a1: 0, a2: 0, order: 1 }],
      energy: undefined,
      delta_e: 0,
    };
    mocks.viewer3DMoleculeFromMolblock.mockReturnValue(fallbackMolecule);
    configureViewerState({
      minimizeGeometry: false,
      viewerMolblock: 'display-only-molblock',
      viewerStructureStatus: {
        kind: 'display-only',
        chemistryAvailable: false,
        fallbackGeometryAvailable: true,
        message: '3D optimization is unavailable for this structure',
      },
    });

    const { result } = renderHook(() =>
      useMolecule3DData({
        smiles: '',
        geometrySmiles: '',
        preferSmilesGeometry: false,
        forceField: 'MMFF94s',
        multiConformer: false,
        maxConformers: 1,
      }),
    );

    await waitFor(() => {
      expect(result.current.molecule).toEqual(fallbackMolecule);
      expect(result.current.error).toBe('3D optimization is unavailable for this structure');
    });

    expect(mocks.invokeTauri).not.toHaveBeenCalled();
  });

  it('downgrades metal-containing molblocks to UFF and ignores stale request results', async () => {
    const staleRequest = createDeferred<{
      bonds: Array<{ a1: number; a2: number; order: number }>;
      conformers: Array<{
        atoms: Array<{ element: string; x: number; y: number; z: number }>;
        energy: number;
        delta_e: number;
      }>;
    }>();
    const freshRequest = createDeferred<{
      bonds: Array<{ a1: number; a2: number; order: number }>;
      conformers: Array<{
        atoms: Array<{ element: string; x: number; y: number; z: number }>;
        energy: number;
        delta_e: number;
      }>;
    }>();
    mocks.invokeTauri.mockImplementation((_command, args) => {
      const payload = args as { molblock?: string; smiles?: string };
      if (payload.molblock?.includes('Zn')) return staleRequest.promise;
      return freshRequest.promise;
    });

    configureViewerState({
      viewerGeometryMolblock: [
        '',
        '  ChemEditor',
        '',
        '  1  0  0  0  0  0  0  0  0  0999 V2000',
        '    0.0000    0.0000    0.0000 Zn  0  0  0  0  0  0  0  0  0  0  0  0',
        'M  END',
      ].join('\n'),
    });

    const { result, rerender } = renderHook(
      (props: Parameters<typeof useMolecule3DData>[0]) => useMolecule3DData(props),
      {
        initialProps: {
          smiles: 'stale-smiles-a',
          geometrySmiles: '',
          preferSmilesGeometry: false,
          forceField: 'MMFF94s',
          multiConformer: false,
          maxConformers: 1,
        },
      },
    );

    await waitFor(() => {
      expect(mocks.invokeTauri).toHaveBeenCalledTimes(1);
    });
    expect(mocks.invokeTauri.mock.calls[0][1]).toMatchObject({ forceField: 'UFF' });

    await act(async () => {
      configureViewerState();
      rerender({
        smiles: 'stale-smiles-b',
        geometrySmiles: '',
        preferSmilesGeometry: false,
        forceField: 'UFF',
        multiConformer: false,
        maxConformers: 1,
      });
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(mocks.invokeTauri).toHaveBeenCalledTimes(2);
    });

    await act(async () => {
      freshRequest.resolve({
        bonds: [{ a1: 0, a2: 0, order: 1 }],
        conformers: [{ atoms: [{ element: 'N', x: 5, y: 5, z: 5 }], energy: -1, delta_e: 0 }],
      });
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.molecule?.atoms[0].element).toBe('N');
    });

    await act(async () => {
      staleRequest.resolve({
        bonds: [{ a1: 0, a2: 0, order: 1 }],
        conformers: [{ atoms: [{ element: 'Zn', x: 0, y: 0, z: 0 }], energy: -2, delta_e: 0 }],
      });
      await flushMicrotasks();
    });

    expect(result.current.molecule?.atoms[0].element).toBe('N');
  });
});
