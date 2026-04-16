import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useHartreeFockGeometryOptimization } from '../../src/hooks/useHartreeFockGeometryOptimization';
import { createDeferred, flushMicrotasks } from './helpers';

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
}));

vi.mock('../../src/lib/tauri.ts', () => ({
  invokeTauri: mocks.invokeTauri,
}));

function createMolecule(label: string) {
  return {
    atoms: [{ element: label, x: 0, y: 0, z: 0, atomMapNum: 3 }],
    bonds: [{ a1: 0, a2: 0, order: 1 }],
  };
}

describe('useHartreeFockGeometryOptimization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds optimization payloads, preserves warnings, and reuses cached results', async () => {
    mocks.invokeTauri.mockResolvedValue({
      atoms: [{ element: 'C', x: 1, y: 2, z: 3, atomMapNum: 3 }],
      bonds: [{ a1: 0, a2: 0, order: 1 }],
      energyHartree: -1.234,
      warnings: ['HF optimization stopped early: reached max iterations'],
    });

    const { result } = renderHook(() =>
      useHartreeFockGeometryOptimization({
        enabled: true,
        smiles: 'optimize-cache',
        molblock: '',
        molecule: createMolecule('C'),
        basis: '6-31G*',
        charge: 1,
      }),
    );

    await act(async () => {
      await result.current.optimize();
    });

    await waitFor(() => {
      expect(result.current.result?.energyHartree).toBe(-1.234);
      expect(result.current.warnings).toEqual([
        'HF optimization stopped early: reached max iterations',
      ]);
    });

    expect(mocks.invokeTauri).toHaveBeenCalledWith(
      'optimize_hartree_fock_geometry',
      expect.objectContaining({
        smiles: 'optimize-cache',
        basis: '6-31G*',
        charge: 1,
        atoms: [{ element: 'C', x: 0, y: 0, z: 0, atomMapNum: 3 }],
        bonds: [{ a1: 0, a2: 0, order: 1 }],
      }),
    );

    await act(async () => {
      await result.current.optimize();
    });

    expect(mocks.invokeTauri).toHaveBeenCalledTimes(1);
  });

  it('reports timeout errors when an optimization never returns', async () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout').mockImplementation(((
      callback: TimerHandler,
    ) => {
      if (typeof callback === 'function') callback();
      return 0 as unknown as number;
    }) as typeof window.setTimeout);
    mocks.invokeTauri.mockImplementation(() => new Promise(() => undefined));

    const { result } = renderHook(() =>
      useHartreeFockGeometryOptimization({
        enabled: true,
        smiles: 'optimize-timeout',
        molblock: '',
        molecule: createMolecule('N'),
        basis: '3-21G',
        charge: 0,
      }),
    );

    await act(async () => {
      void result.current.optimize();
      await flushMicrotasks();
    });

    expect(result.current.error).toBe('HF geometry optimization timed out');
    setTimeoutSpy.mockRestore();
  });

  it('keeps the newest optimization result when an older request resolves late', async () => {
    const staleRequest = createDeferred<{
      atoms: Array<{ element: string; x: number; y: number; z: number }>;
      bonds: Array<{ a1: number; a2: number; order: number }>;
      energyHartree: number;
      warnings: string[];
    }>();
    const freshRequest = createDeferred<{
      atoms: Array<{ element: string; x: number; y: number; z: number }>;
      bonds: Array<{ a1: number; a2: number; order: number }>;
      energyHartree: number;
      warnings: string[];
    }>();
    mocks.invokeTauri.mockImplementation((_command, args) => {
      const payload = args as { smiles?: string };
      return payload.smiles === 'optimize-stale-a' ? staleRequest.promise : freshRequest.promise;
    });

    const { result, rerender } = renderHook(
      (props: Parameters<typeof useHartreeFockGeometryOptimization>[0]) =>
        useHartreeFockGeometryOptimization(props),
      {
        initialProps: {
          enabled: true,
          smiles: 'optimize-stale-a',
          molblock: '',
          molecule: createMolecule('O'),
          basis: '3-21G',
          charge: 0,
        },
      },
    );

    await act(async () => {
      void result.current.optimize();
      await flushMicrotasks();
    });

    rerender({
      enabled: true,
      smiles: 'optimize-stale-b',
      molblock: '',
      molecule: createMolecule('F'),
      basis: '6-31G*',
      charge: -1,
    });

    await act(async () => {
      void result.current.optimize();
      await flushMicrotasks();
    });

    await act(async () => {
      freshRequest.resolve({
        atoms: [{ element: 'F', x: 9, y: 9, z: 9 }],
        bonds: [{ a1: 0, a2: 0, order: 1 }],
        energyHartree: -9.5,
        warnings: ['fresh'],
      });
      await flushMicrotasks();
    });

    await waitFor(() => {
      expect(result.current.result?.atoms[0].element).toBe('F');
      expect(result.current.result?.energyHartree).toBe(-9.5);
    });

    await act(async () => {
      staleRequest.resolve({
        atoms: [{ element: 'O', x: 1, y: 1, z: 1 }],
        bonds: [{ a1: 0, a2: 0, order: 1 }],
        energyHartree: -1.5,
        warnings: ['stale'],
      });
      await flushMicrotasks();
    });

    expect(result.current.result?.atoms[0].element).toBe('F');
    expect(result.current.result?.energyHartree).toBe(-9.5);
  });
});
