import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { StructureDiagnostics } from '../../src/components/StructureDiagnostics';
import { useStore } from '../../src/store';
import { resetStore } from './helpers';
import type { ChemistryDiagnostic } from '../../src/lib/chemistry/service';
const mock = vi.hoisted(() => ({ check: vi.fn() }));
vi.mock('../../src/lib/chemistry/diagnostics', () => ({ checkStructure: mock.check }));
vi.mock('../../src/hooks/useRDKit', () => ({ useRDKit: () => ({ rdkit: null, loading: false }) }));
beforeEach(() => resetStore());
it('navigates issues without history and invalidates them on a new document', async () => {
  mock.check.mockResolvedValue([
    {
      code: 'test',
      severity: 'error',
      message: 'Bad atom',
      objectIds: ['a'],
      availability: 'available',
    },
  ]);
  const reveal = vi.fn();
  render(<StructureDiagnostics reveal={reveal} />);
  const before = useStore.getState();
  fireEvent.click(screen.getByTitle('Check Structure'));
  const issue = await screen.findByText('error: Bad atom');
  fireEvent.click(issue);
  expect(reveal).toHaveBeenCalledWith(['a']);
  expect(useStore.getState().history).toBe(before.history);
  act(() => useStore.getState().clearCanvas());
  expect(screen.queryByText('error: Bad atom')).toBeNull();
  expect(screen.getByText(/Document changed/)).toBeTruthy();
});
it('discards completions from an obsolete document', async () => {
  let finish!: (issues: ChemistryDiagnostic[]) => void;
  mock.check.mockReturnValue(
    new Promise<ChemistryDiagnostic[]>((resolve) => {
      finish = resolve;
    }),
  );
  render(<StructureDiagnostics reveal={vi.fn()} />);
  fireEvent.click(screen.getByTitle('Check Structure'));
  act(() => useStore.getState().clearCanvas());
  await act(async () =>
    finish([
      {
        code: 'old',
        severity: 'error',
        message: 'Obsolete',
        objectIds: ['a'],
        availability: 'available',
      },
    ]),
  );
  await waitFor(() => expect(screen.queryByText(/Obsolete/)).toBeNull());
  expect(screen.getByText(/Document changed/)).toBeTruthy();
});
