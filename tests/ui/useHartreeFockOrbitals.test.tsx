import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHartreeFockOrbitals } from '../../src/hooks/useHartreeFockOrbitals';
import { createDeferred, flushMicrotasks } from './helpers';

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
  buildOrbitalMesh: vi.fn((field, _grid, isovalue: number) => ({
    key: `${field.key}:${isovalue.toFixed(3)}`,
    positivePositions: [],
    negativePositions: [],
  })),
}));

vi.mock('../../src/lib/tauri.ts', () => ({
  invokeTauri: mocks.invokeTauri,
}));

vi.mock('../../src/lib/orbitalMesh.ts', () => ({
  buildOrbitalMesh: mocks.buildOrbitalMesh,
}));

function createMolecule(label: string) {
  return {
    atoms: [{ element: label, x: 0, y: 0, z: 0 }],
    bonds: [],
  };
}

describe('useHartreeFockOrbitals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects HOMO by default, reuses cached results, and rebuilds meshes when isovalue changes', async () => {
    const response = {
      basis: '3-21G',
      orbitals: [
        {
          key: 'mo-0',
          label: 'HOMO',
          moIndex: 0,
          occupation: 2,
          energyHartree: -0.5,
          energyEv: -13.6,
        },
        {
          key: 'mo-1',
          label: 'LUMO',
          moIndex: 1,
          occupation: 0,
          energyHartree: 0.1,
          energyEv: 2.7,
        },
      ],
      grid: {
        origin: { x: 0, y: 0, z: 0 },
        spacing: 0.5,
        dims: [2, 2, 2],
      },
      fields: {
        'mo-0': { key: 'mo-0', origin: { x: 0, y: 0, z: 0 }, spacing: 0.5, dims: [2, 2, 2] },
        'mo-1': { key: 'mo-1', origin: { x: 0, y: 0, z: 0 }, spacing: 0.5, dims: [2, 2, 2] },
      },
      warnings: ['Coarse orbital grid'],
    };
    mocks.invokeTauri.mockResolvedValue(response);

    const { result, rerender } = renderHook(
      (props: Parameters<typeof useHartreeFockOrbitals>[0]) => useHartreeFockOrbitals(props),
      {
        initialProps: {
          enabled: true,
          smiles: 'orbital-cache-smiles',
          molblock: '',
          molecule: createMolecule('C'),
          basis: '3-21G',
          isovalue: 0.05,
          charge: 0,
        },
      },
    );

    await act(async () => {
      result.current.calculate();
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.selectedOrbitalKey).toBe('mo-0');
      expect(result.current.warnings).toEqual(['Coarse orbital grid']);
    });
    expect(mocks.invokeTauri).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(mocks.buildOrbitalMesh).toHaveBeenCalledWith(
        expect.objectContaining({ key: 'mo-0' }),
        response.grid,
        0.05,
      );
    });

    await act(async () => {
      result.current.calculate();
      await flushMicrotasks();
    });
    expect(mocks.invokeTauri).toHaveBeenCalledTimes(1);

    rerender({
      enabled: true,
      smiles: 'orbital-cache-smiles',
      molblock: '',
      molecule: createMolecule('C'),
      basis: '3-21G',
      isovalue: 0.08,
      charge: 0,
    });

    await waitFor(() => {
      expect(mocks.buildOrbitalMesh).toHaveBeenCalledTimes(2);
    });
  });

  it('cancels the backend job and reports no error for a requested cancellation', async () => {
    let rejectJob!: (error: Error) => void;
    mocks.invokeTauri.mockImplementation((command: string) => {
      if (command === 'cancel_scientific_job') {
        rejectJob(new Error('Job cancelled'));
        return Promise.resolve('cancelled');
      }
      return new Promise((_, reject) => {
        rejectJob = reject;
      });
    });

    const { result } = renderHook(() =>
      useHartreeFockOrbitals({
        enabled: true,
        smiles: 'orbital-cancel',
        molblock: '',
        molecule: createMolecule('O'),
        basis: '3-21G',
        isovalue: 0.05,
        charge: 0,
      }),
    );

    await act(async () => {
      result.current.calculate();
      await flushMicrotasks();
    });
    expect(result.current.loading).toBe(true);
    const jobId = mocks.invokeTauri.mock.calls[0][1].jobId;

    await act(async () => {
      result.current.cancel();
      await flushMicrotasks();
    });

    expect(mocks.invokeTauri).toHaveBeenCalledWith('cancel_scientific_job', { jobId });
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('ignores stale orbital responses when a newer calculation finishes first', async () => {
    const staleRequest = createDeferred<{
      basis: string;
      orbitals: Array<{
        key: string;
        label: string;
        moIndex: number;
        occupation: number;
        energyHartree: number;
        energyEv: number;
      }>;
      grid: { origin: { x: number; y: number; z: number }; spacing: number; dims: number[] };
      fields: Record<
        string,
        {
          key: string;
          origin: { x: number; y: number; z: number };
          spacing: number;
          dims: number[];
        }
      >;
      warnings: string[];
    }>();
    const freshRequest = createDeferred<{
      basis: string;
      orbitals: Array<{
        key: string;
        label: string;
        moIndex: number;
        occupation: number;
        energyHartree: number;
        energyEv: number;
      }>;
      grid: { origin: { x: number; y: number; z: number }; spacing: number; dims: number[] };
      fields: Record<
        string,
        {
          key: string;
          origin: { x: number; y: number; z: number };
          spacing: number;
          dims: number[];
        }
      >;
      warnings: string[];
    }>();
    mocks.invokeTauri.mockImplementation((_command, args) => {
      const payload = args as { smiles?: string };
      return payload.smiles === 'orbital-stale-a' ? staleRequest.promise : freshRequest.promise;
    });

    const { result, rerender } = renderHook(
      (props: Parameters<typeof useHartreeFockOrbitals>[0]) => useHartreeFockOrbitals(props),
      {
        initialProps: {
          enabled: true,
          smiles: 'orbital-stale-a',
          molblock: '',
          molecule: createMolecule('N'),
          basis: '3-21G',
          isovalue: 0.05,
          charge: 0,
        },
      },
    );

    await act(async () => {
      result.current.calculate();
      await flushMicrotasks();
    });

    rerender({
      enabled: true,
      smiles: 'orbital-stale-b',
      molblock: '',
      molecule: createMolecule('F'),
      basis: '6-31G*',
      isovalue: 0.05,
      charge: 1,
    });

    await act(async () => {
      result.current.calculate();
      await flushMicrotasks();
    });

    await act(async () => {
      freshRequest.resolve({
        basis: '6-31G*',
        orbitals: [
          {
            key: 'mo-fresh',
            label: 'HOMO',
            moIndex: 2,
            occupation: 2,
            energyHartree: -0.7,
            energyEv: -19.0,
          },
        ],
        grid: { origin: { x: 0, y: 0, z: 0 }, spacing: 0.25, dims: [2, 2, 2] },
        fields: {
          'mo-fresh': {
            key: 'mo-fresh',
            origin: { x: 0, y: 0, z: 0 },
            spacing: 0.25,
            dims: [2, 2, 2],
          },
        },
        warnings: [],
      });
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.selectedOrbitalKey).toBe('mo-fresh');
      expect(result.current.result?.basis).toBe('6-31G*');
    });

    await act(async () => {
      staleRequest.resolve({
        basis: '3-21G',
        orbitals: [
          {
            key: 'mo-stale',
            label: 'HOMO',
            moIndex: 0,
            occupation: 2,
            energyHartree: -0.4,
            energyEv: -10.8,
          },
        ],
        grid: { origin: { x: 0, y: 0, z: 0 }, spacing: 0.5, dims: [1, 1, 1] },
        fields: {
          'mo-stale': {
            key: 'mo-stale',
            origin: { x: 0, y: 0, z: 0 },
            spacing: 0.5,
            dims: [1, 1, 1],
          },
        },
        warnings: ['stale'],
      });
      await flushMicrotasks();
    });

    expect(result.current.selectedOrbitalKey).toBe('mo-fresh');
    expect(result.current.result?.basis).toBe('6-31G*');
  });
});
