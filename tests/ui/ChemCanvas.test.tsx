import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChemCanvas, type ChemCanvasRef } from '../../src/components/ChemCanvas';
import type { ChemDrawDocument } from '../../src/types/chemdraw';
import { DEFAULT_CANVAS_BOND_LENGTH } from '../../src/lib/chemdrawMetrics';
import { useStore } from '../../src/store';
import { resetStore } from './helpers';

const mocks = vi.hoisted(() => ({
  saveTextWithDialog: vi.fn(),
  saveTextToPath: vi.fn(),
  saveBinaryWithDialog: vi.fn(),
  prepareChemDrawDocumentForSaveAsync: vi.fn(),
  loadChemDrawDocumentForCanvasAsync: vi.fn(),
  lastDocumentRenderSurfaceProps: null as null | Record<string, unknown>,
}));

vi.mock('../../src/hooks/useRDKit.ts', () => ({
  useRDKit: () => ({ rdkit: null, loading: false, failed: false }),
}));

vi.mock('../../src/tools/useBondTool.ts', () => ({
  useBondTool: () => ({
    cleanup: vi.fn(),
    onMouseDown: vi.fn(),
    onMouseMove: vi.fn(),
    onMouseUp: vi.fn(),
    dragPreviewLine: null,
    activeAtomId: null,
  }),
}));

vi.mock('../../src/tools/useSelectTool.ts', () => ({
  useSelectTool: () => ({
    cleanup: vi.fn(),
    onMouseDown: vi.fn(),
    onMouseMove: vi.fn(),
    onMouseUp: vi.fn(),
    isSelectionBoxActive: false,
    selectionBoxStart: null,
    selectionBoxEnd: null,
  }),
}));

vi.mock('../../src/tools/useAtomTool.ts', () => ({
  useAtomTool: () => ({
    cleanup: vi.fn(),
    onMouseDown: vi.fn(),
    onMouseMove: vi.fn(),
    onMouseUp: vi.fn(),
    openEditor: vi.fn(),
    editingAtomId: null,
    dragPreviewLine: null,
    activeAtomId: null,
    editingValue: '',
    setEditingValue: vi.fn(),
    handleFinishEditing: vi.fn(),
    closeEditor: vi.fn(),
  }),
}));

vi.mock('../../src/editor/scene/DocumentRenderSurface.tsx', () => ({
  DocumentRenderSurface: React.forwardRef((props: Record<string, unknown>, ref) => {
    mocks.lastDocumentRenderSurfaceProps = props;
    React.useImperativeHandle(ref, () => ({
      toDataURL: vi.fn(() => 'data:image/png;base64,AAAA'),
    }));
    return <div data-testid="document-render-surface" />;
  }),
}));

vi.mock('../../src/lib/fileDialogs.ts', () => ({
  saveTextWithDialog: mocks.saveTextWithDialog,
  saveTextToPath: mocks.saveTextToPath,
  saveBinaryWithDialog: mocks.saveBinaryWithDialog,
}));

vi.mock('../../src/lib/chemdrawDocumentCommandsAsync.ts', () => ({
  loadChemDrawDocumentForCanvasAsync: mocks.loadChemDrawDocumentForCanvasAsync,
  prepareChemDrawDocumentForSaveAsync: mocks.prepareChemDrawDocumentForSaveAsync,
}));

function createDocument(): ChemDrawDocument {
  return {
    schemaVersion: 1,
    source: 'manual',
    pages: [{ id: 'page-1', objects: [] }],
  };
}

describe('ChemCanvas', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.lastDocumentRenderSurfaceProps = null;
    resetStore();
  });

  it('starts with an ACS-sized canvas zoom that preserves a comfortable visual bond length', async () => {
    render(<ChemCanvas width={800} height={600} />);

    await screen.findByTestId('document-render-surface');

    const stageScale = mocks.lastDocumentRenderSurfaceProps?.stageScale as number | undefined;
    expect(stageScale).toBeCloseTo(45 / DEFAULT_CANVAS_BOND_LENGTH, 3);
  });

  it('saves native CDXML through the shared file dialog plumbing', async () => {
    const preparedDocument = createDocument();
    mocks.prepareChemDrawDocumentForSaveAsync.mockResolvedValue({
      xml: '<CDXML />',
      document: preparedDocument,
    });
    mocks.saveTextWithDialog.mockResolvedValue('/tmp/sketch.cdxml');
    useStore.setState({
      ...useStore.getState(),
      atoms: [{ id: 'a1', x: 10, y: 10, kind: 'element', element: 'C' }],
      chemDrawDocument: createDocument(),
    });

    const ref = React.createRef<ChemCanvasRef>();
    render(<ChemCanvas ref={ref} width={800} height={600} />);

    let result: Awaited<ReturnType<ChemCanvasRef['saveNative']>> | undefined;
    await act(async () => {
      result = await ref.current?.saveNative();
    });

    expect(mocks.prepareChemDrawDocumentForSaveAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        canvasState: expect.objectContaining({
          atoms: [{ id: 'a1', x: 10, y: 10, kind: 'element', element: 'C' }],
        }),
      }),
    );
    expect(mocks.saveTextWithDialog).toHaveBeenCalledWith(
      expect.objectContaining({ content: '<CDXML />', defaultPath: 'sketch.cdxml' }),
    );
    expect(result).toEqual({ path: '/tmp/sketch.cdxml', saved: true });
    expect(useStore.getState().chemDrawDocument).toMatchObject(preparedDocument);
  });

  it('saves native CDXML directly when a path is supplied', async () => {
    const preparedDocument = createDocument();
    mocks.prepareChemDrawDocumentForSaveAsync.mockResolvedValue({
      xml: '<CDXML />',
      document: preparedDocument,
    });
    mocks.saveTextToPath.mockResolvedValue('/tmp/current.cdxml');

    const ref = React.createRef<ChemCanvasRef>();
    render(<ChemCanvas ref={ref} width={800} height={600} />);

    let result: Awaited<ReturnType<ChemCanvasRef['saveNative']>> | undefined;
    await act(async () => {
      result = await ref.current?.saveNative({ path: '/tmp/current.cdxml' });
    });

    expect(mocks.saveTextToPath).toHaveBeenCalledWith('/tmp/current.cdxml', '<CDXML />');
    expect(mocks.saveTextWithDialog).not.toHaveBeenCalled();
    expect(result).toEqual({ path: '/tmp/current.cdxml', saved: true });
  });

  it('loads native documents into store history and forwards warnings as toasts', async () => {
    const loadedDocument = createDocument();
    mocks.loadChemDrawDocumentForCanvasAsync.mockResolvedValue({
      document: loadedDocument,
      warnings: ['Limited editing support'],
      state: {
        atoms: [{ id: 'n1', x: 40, y: 30, kind: 'element', element: 'N' }],
        bonds: [],
        arrows: [],
        groups: [],
        textBoxes: [],
      },
    });

    const ref = React.createRef<ChemCanvasRef>();
    render(<ChemCanvas ref={ref} width={800} height={600} />);

    await act(async () => {
      await ref.current?.loadNative('<CDXML />');
    });

    await waitFor(() => {
      expect(useStore.getState().chemDrawDocument?.schemaVersion).toBe(
        loadedDocument.schemaVersion,
      );
      expect(useStore.getState().chemDrawDocument?.source).toBe(loadedDocument.source);
      expect(useStore.getState().chemDrawDocument?.pages[0]?.id).toBe('page-1');
      expect(useStore.getState().chemDrawDocument?.pages[0]?.objects).toHaveLength(2);
      expect(useStore.getState().atoms).toEqual([
        { id: 'n1', x: 40, y: 30, kind: 'element', element: 'N' },
      ]);
      expect(useStore.getState().history).toHaveLength(1);
      expect(useStore.getState().toasts[0]?.message).toBe('Limited editing support');
    });
  });

  it('surfaces invalid native loads as error toasts', async () => {
    mocks.loadChemDrawDocumentForCanvasAsync.mockRejectedValue(new Error('bad cdxml'));

    const ref = React.createRef<ChemCanvasRef>();
    render(<ChemCanvas ref={ref} width={800} height={600} />);

    await act(async () => {
      await ref.current?.loadNative('<bad />');
    });

    await waitFor(() => {
      expect(useStore.getState().toasts[0]?.message).toBe('Failed to load file: invalid CDXML');
    });
  });

  it('switches tools with hotkeys and deletes the selected canvas objects', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener');
    useStore.setState({
      ...useStore.getState(),
      tool: 'bond',
    });

    render(<ChemCanvas width={800} height={600} />);
    const surface = await screen.findByTestId('document-render-surface');
    const keydownHandler = addEventListenerSpy.mock.calls
      .filter(([eventName]) => eventName === 'keydown')
      .at(-1)?.[1] as EventListener | undefined;
    addEventListenerSpy.mockRestore();

    if (!keydownHandler) {
      throw new Error('ChemCanvas did not register a keydown handler');
    }

    const dispatchShortcut = (
      key: string,
      target: EventTarget,
      options: KeyboardEventInit = {},
    ) => {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, ...options });
      Object.defineProperty(event, 'target', {
        value: target,
        configurable: true,
      });
      keydownHandler(event);
    };

    for (const [key, expectedTool] of [
      ['x', 'bond'],
      ['t', 'text'],
      ['e', 'arrow'],
    ] as const) {
      dispatchShortcut(key, surface);
      await waitFor(() => {
        expect(useStore.getState().tool).toBe(expectedTool);
      });
    }

    dispatchShortcut('j', surface);
    await waitFor(() => {
      expect(useStore.getState().tool).toBe('fragment');
      expect(useStore.getState().selectedFragment).toBe('c1ccccc1');
    });

    dispatchShortcut('J', surface, { shiftKey: true });
    await waitFor(() => {
      expect(useStore.getState().tool).toBe('fragment');
      expect(useStore.getState().selectedFragment).toBe('C1=CC=CC1');
    });

    dispatchShortcut('u', surface);
    await waitFor(() => {
      expect(useStore.getState().tool).toBe('fragment');
      expect(useStore.getState().selectedFragment).toBe('C1CCCCC1');
    });

    dispatchShortcut('U', surface, { shiftKey: true });
    await waitFor(() => {
      expect(useStore.getState().tool).toBe('fragment');
      expect(useStore.getState().selectedFragment).toBe('C1CCCC1');
    });

    dispatchShortcut('v', surface);
    await waitFor(() => {
      expect(useStore.getState().tool).toBe('fragment');
    });

    dispatchShortcut(' ', surface);
    await waitFor(() => {
      expect(useStore.getState().tool).toBe('select');
    });

    act(() => {
      useStore.setState({
        ...useStore.getState(),
        tool: 'select',
        atoms: [
          {
            id: 'a1',
            x: 10,
            y: 10,
            kind: 'element',
            element: 'C',
          },
          {
            id: 'a2',
            x: 40,
            y: 10,
            kind: 'element',
            element: 'C',
          },
        ],
        bonds: [{ id: 'b1', from: 'a1', to: 'a2', order: 1 }],
        selectedAtomIds: new Set(),
        selectedObjectIds: new Set(['b1']),
        selectedBondIds: new Set(['b1']),
        selectedArrowIds: new Set(),
        selectedTextBoxIds: new Set(),
      });
    });
    await waitFor(() => {
      expect(screen.getByText('Bond Style')).toBeTruthy();
    });
    const closeButton = screen.getByText('Close') as HTMLButtonElement;
    closeButton.focus();
    dispatchShortcut('Delete', closeButton);

    await waitFor(() => {
      expect(useStore.getState().bonds).toEqual([]);
      expect(useStore.getState().selectedBondIds.size).toBe(0);
      expect(useStore.getState().history).toHaveLength(1);
    });
  });
});
