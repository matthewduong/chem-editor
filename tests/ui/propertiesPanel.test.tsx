import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PropertiesPanel } from '../../src/components/PropertiesPanel';
import { commitCanvasEdit, useStore } from '../../src/store';

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }));
vi.mock('../../src/lib/tauri', () => ({ invokeTauri: mock.invoke }));

const theme = { sidebar: '#fff', text: '#000', border: '#ccc' } as never;

it('shows m/z and elemental analysis and pastes the analysis as one caption', async () => {
  mock.invoke.mockResolvedValue({
    formula: 'C6H12O6',
    mw: 180.156,
    exact_mass: 180.0634,
    logp: -3.2,
    tpsa: 110.4,
    hbd: 5,
    hba: 6,
    rotatable_bonds: 1,
    rings: 1,
    aromatic_rings: 0,
    charge: 0,
    heavy_atoms: 12,
  });
  commitCanvasEdit({
    atoms: [
      { id: 'a', x: 100, y: 100, element: 'C' },
      { id: 'b', x: 130, y: 120, element: 'O' },
    ],
    bonds: [{ id: 'ab', from: 'a', to: 'b', order: 1 }],
    arrows: [],
    groups: [],
    textBoxes: [],
  } as never);
  useStore.setState({
    viewerStructureStatus: {
      kind: 'valid',
      chemistryAvailable: true,
      fallbackGeometryAvailable: true,
      message: null,
    },
  } as never);
  render(<PropertiesPanel theme={theme} isDarkMode={false} viewerSmiles="OCC1OC(O)C(O)C(O)C1O" />);
  await waitFor(() => expect(screen.getByText('C, 40.00; H, 6.71; O, 53.28')).toBeTruthy());
  expect(screen.getByText('180.06 (100.0%), 181.07 (6.9%), 182.07 (1.4%)')).toBeTruthy();
  fireEvent.click(screen.getByText('Paste analysis as caption'));
  const captions = useStore.getState().textBoxes ?? [];
  expect(captions).toHaveLength(1);
  const text = captions[0]!.runs.map((run) => run.text).join('');
  expect(text.split('\n')[0]).toBe('Chemical Formula: C6H12O6');
  expect(text).toContain('Elemental Analysis: C, 40.00; H, 6.71; O, 53.28');
  expect(captions[0]!.y).toBeGreaterThan(120);
});
