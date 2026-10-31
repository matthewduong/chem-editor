import { renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock('../../src/lib/tauri', () => ({ invokeTauri: mocks.invoke }));

import { useStartupDocument } from '../../src/hooks/useStartupDocument';

it('opens the CDXML file the app was started on, once', async () => {
  mocks.invoke.mockResolvedValue({ path: 'C:/tmp/object.cdxml', content: '<CDXML/>' });
  const open = vi.fn(async () => undefined);
  const { rerender } = renderHook(() => useStartupDocument(open));
  rerender();
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith({
      filePath: 'C:/tmp/object.cdxml',
      extension: 'cdxml',
      content: '<CDXML/>',
    }),
  );
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
  expect(mocks.invoke).toHaveBeenCalledWith('startup_document');
});

it('does nothing when the app was started without a document', async () => {
  mocks.invoke.mockReset();
  mocks.invoke.mockResolvedValue(null);
  const open = vi.fn(async () => undefined);
  renderHook(() => useStartupDocument(open));
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
  expect(open).not.toHaveBeenCalled();
});
