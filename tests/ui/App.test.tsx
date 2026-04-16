import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { useStore } from '../../src/store';
import { resetStore } from './helpers';

const mocks = vi.hoisted(() => ({
  invokeTauri: vi.fn(),
  getCurrentAppWindow: vi.fn(),
  readClipboardText: vi.fn(),
  writeClipboardText: vi.fn(),
  openChemicalTextFile: vi.fn(),
  openImageBinaryFile: vi.fn(),
  saveTextWithDialog: vi.fn(),
  saveBinaryWithDialog: vi.fn(),
  chemCanvasHandle: {
    saveNative: vi.fn(),
    loadNative: vi.fn(),
    exportPNG: vi.fn(),
    exportSVG: vi.fn(),
    insertImage: vi.fn(),
    getMolblock: vi.fn(() => 'mock-molblock'),
    loadFromSmiles: vi.fn(),
    cleanUp: vi.fn(),
    addFromState: vi.fn(),
    addFromSmiles: vi.fn(),
    applyTextFormat: vi.fn(),
    fitToScreen: vi.fn(),
    moveContentIntoPage: vi.fn(),
    centerPageInView: vi.fn(),
  },
  setTheme: vi.fn(),
}));

vi.mock('../../src/lib/tauri.ts', () => ({
  invokeTauri: mocks.invokeTauri,
  getCurrentAppWindow: () => ({ setTheme: mocks.setTheme }),
  readClipboardText: mocks.readClipboardText,
  writeClipboardText: mocks.writeClipboardText,
}));

vi.mock('../../src/lib/fileDialogs.ts', () => ({
  openChemicalTextFile: mocks.openChemicalTextFile,
  openImageBinaryFile: mocks.openImageBinaryFile,
  saveTextWithDialog: mocks.saveTextWithDialog,
  saveBinaryWithDialog: mocks.saveBinaryWithDialog,
}));

vi.mock('../../src/hooks/useRDKit.ts', () => ({
  useRDKit: () => ({ rdkit: null, loading: false, failed: false }),
}));

vi.mock('../../src/hooks/useToolPaletteManager.ts', () => ({
  useToolPaletteManager: () => ({
    toolPalettes: { order: [], items: {} },
    dockedPaletteIds: [],
    floatingPaletteIds: [],
    paletteDrag: null,
    togglePaletteCollapsed: vi.fn(),
    beginPaletteDrag: vi.fn(),
    dockPalette: vi.fn(),
    dockGuideTop: null,
  }),
}));

vi.mock('../../src/components/ChemCanvas.tsx', () => ({
  ChemCanvas: React.forwardRef((_props, ref) => {
    React.useImperativeHandle(ref, () => mocks.chemCanvasHandle);
    return <div data-testid="chem-canvas">ChemCanvas</div>;
  }),
}));

vi.mock('../../src/components/ViewerPanel.tsx', () => ({
  ViewerPanel: () => <div data-testid="viewer-panel">Viewer Panel</div>,
}));

vi.mock('../../src/components/PreferencesPanel.tsx', () => ({
  PreferencesPanel: ({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div>Preferences Panel</div> : null,
}));

vi.mock('../../src/components/TransformDialogs.tsx', () => ({
  TransformDialogs: () => null,
}));

vi.mock('../../src/components/PropertiesPanel.tsx', () => ({
  PropertiesPanel: () => <div>Properties Panel</div>,
}));

vi.mock('../../src/components/IrPanel.tsx', () => ({
  IrPanel: () => <div>IR Panel</div>,
}));

vi.mock('../../src/components/MsPanel.tsx', () => ({
  MsPanel: () => <div>MS Panel</div>,
}));

vi.mock('../../src/components/NmrPanel.tsx', () => ({
  NmrPanel: () => <div>NMR Panel</div>,
}));

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    mocks.invokeTauri.mockImplementation((command: string) => {
      if (command === 'load_app_settings') return Promise.resolve(null);
      if (command === 'parse_chemical_file') return Promise.resolve({ molblock: 'PARSED-MOL' });
      return Promise.resolve(undefined);
    });
    mocks.openChemicalTextFile.mockResolvedValue(null);
    mocks.openImageBinaryFile.mockResolvedValue(null);
  });

  it('syncs the macOS theme on mount and toggles native fullscreen with the shortcut', async () => {
    render(<App />);

    await waitFor(() => {
      expect(mocks.setTheme).toHaveBeenCalledWith('light');
      expect(mocks.invokeTauri).toHaveBeenCalledWith('sync_macos_window_theme', {
        isDarkMode: false,
      });
    });

    fireEvent.keyDown(screen.getByTestId('chem-canvas'), { key: 'f', metaKey: true });

    await waitFor(() => {
      expect(mocks.invokeTauri).toHaveBeenCalledWith('toggle_native_fullscreen');
    });
  });

  it('routes file open and save actions through the ChemCanvas ref methods', async () => {
    mocks.openChemicalTextFile.mockResolvedValue({
      filePath: '/tmp/test.cdxml',
      extension: 'cdxml',
      content: '<CDXML />',
    });

    render(<App />);

    fireEvent.click(screen.getByText('File ▾'));
    fireEvent.click(screen.getByText(/^Open\.\.\./));

    await waitFor(() => {
      expect(mocks.chemCanvasHandle.loadNative).toHaveBeenCalledWith('<CDXML />');
    });

    fireEvent.click(screen.getByText('File ▾'));
    fireEvent.click(screen.getByText(/^Save \(.cdxml\)/));

    await waitFor(() => {
      expect(mocks.chemCanvasHandle.saveNative).toHaveBeenCalled();
    });
  });

  it('shows a toast when opening a file fails', async () => {
    mocks.openChemicalTextFile.mockRejectedValue(new Error('boom'));

    render(<App />);

    fireEvent.click(screen.getByText('File ▾'));
    fireEvent.click(screen.getByText(/^Open\.\.\./));

    await waitFor(() => {
      expect(screen.getByText('Failed to open file')).toBeTruthy();
    });
  });

  it('routes image insertion through the shared file dialog and ChemCanvas ref', async () => {
    mocks.openImageBinaryFile.mockResolvedValue({
      filePath: '/tmp/figure.png',
      extension: 'png',
      mimeType: 'image/png',
      content: new Uint8Array([1, 2, 3, 4]),
    });

    render(<App />);

    fireEvent.click(screen.getByText('File ▾'));
    fireEvent.click(screen.getByText('Insert Image...'));

    await waitFor(() => {
      expect(mocks.chemCanvasHandle.insertImage).toHaveBeenCalledWith({
        bytes: new Uint8Array([1, 2, 3, 4]),
        mimeType: 'image/png',
        sourceFileName: 'figure.png',
      });
    });
  });

  it('persists chair rotation while the ring tool is active and resets it on preset/tool changes', async () => {
    render(<App />);

    await act(async () => {
      useStore.getState().setTool('ring');
      useStore.getState().setRingPreset('chair');
      useStore.getState().rotateRingTemplate(1);
      useStore.getState().rotateRingTemplate(1);
    });
    await waitFor(() => {
      expect(useStore.getState().ringRotationSteps).toBe(2);
    });

    await act(async () => {
      useStore.getState().rotateRingTemplate(-1);
    });
    await waitFor(() => {
      expect(useStore.getState().ringRotationSteps).toBe(1);
    });

    await act(async () => {
      useStore.getState().setRingPreset('chair-flipped');
    });
    await waitFor(() => {
      expect(useStore.getState().ringRotationSteps).toBe(0);
    });

    await act(async () => {
      useStore.getState().setRingPreset('chair');
      useStore.getState().rotateRingTemplate(1);
    });
    await waitFor(() => {
      expect(useStore.getState().ringRotationSteps).toBe(1);
    });

    await act(async () => {
      useStore.getState().setTool('bond');
    });
    await waitFor(() => {
      expect(useStore.getState().ringRotationSteps).toBe(0);
    });
  });

  it('toggles the properties panel from the Calculate menu', async () => {
    render(<App />);

    fireEvent.click(screen.getByText('Calculate ▾'));
    fireEvent.click(screen.getByText('Properties'));

    await waitFor(() => {
      expect(screen.getByText('Properties Panel')).toBeTruthy();
    });

    fireEvent.click(screen.getByText('Calculate ▾'));
    fireEvent.click(screen.getByText('Properties'));

    await waitFor(() => {
      expect(screen.queryByText('Properties Panel')).toBeNull();
    });
  });

  it('switches atom color display mode without mutating authored document defaults', async () => {
    render(<App />);

    await waitFor(() => {
      expect(mocks.invokeTauri).toHaveBeenCalledWith('sync_macos_window_theme', {
        isDarkMode: false,
      });
    });

    fireEvent.click(screen.getByText('Settings ▾'));
    const toggle = screen.getByLabelText('Enhanced Atom Colors') as HTMLInputElement;
    expect(toggle.checked).toBe(true);

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(useStore.getState().documentViewSettings.atomColorViewMode).toBe('chemdraw-fidelity');
      expect(useStore.getState().documentStyleSettings.colors.monochrome).toBe(true);
    });
  });
});
