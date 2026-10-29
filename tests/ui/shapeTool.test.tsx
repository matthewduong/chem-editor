import { act, renderHook } from '@testing-library/react';
import { beforeEach, expect, it } from 'vitest';
import { useShapeTool } from '../../src/tools/useShapeTool';
import { useStore } from '../../src/store';
import { resetStore } from './helpers';

beforeEach(() => {
  resetStore();
});

it('previews a drag without touching history, and commits one shape for it', () => {
  const { result } = renderHook(() => useShapeTool());
  const source = useStore.getState();
  act(() => result.current.begin('rectangle', { x: 10, y: 10 }));
  act(() => result.current.update({ x: 60, y: 40 }));
  expect(result.current.preview).toMatchObject({ type: 'graphic', graphicType: 'rectangle' });
  expect(useStore.getState().history).toBe(source.history);
  expect(useStore.getState().documentFile.dirty).toBe(false);
  let shape: ReturnType<typeof result.current.commit> = null;
  act(() => {
    shape = result.current.commit();
  });
  expect(shape).toMatchObject({
    type: 'graphic',
    graphicType: 'rectangle',
    bounds: { left: 10, top: 10, right: 60, bottom: 40 },
  });
  expect(shape!.id).not.toBe('__preview-shape');
  expect(result.current.preview).toBeNull();
  expect(result.current.isActive()).toBe(false);
});

it('a click, a cancel, or a press on a replaced document commits nothing', () => {
  const { result } = renderHook(() => useShapeTool());
  act(() => result.current.begin('oval', { x: 10, y: 10 }));
  act(() => result.current.update({ x: 11, y: 10 }));
  expect(result.current.commit()).toBeNull();

  act(() => result.current.begin('oval', { x: 10, y: 10 }));
  act(() => result.current.update({ x: 60, y: 40 }));
  act(() => result.current.cancel());
  expect(result.current.isActive()).toBe(false);
  expect(result.current.commit()).toBeNull();

  act(() => result.current.begin('oval', { x: 10, y: 10 }));
  act(() => result.current.update({ x: 60, y: 40 }));
  act(() =>
    useStore.setState({
      chemDrawDocument: {
        ...useStore.getState().chemDrawDocument!,
        pages: [{ id: 'other', objects: [] }],
      },
    }),
  );
  expect(result.current.commit()).toBeNull();
});
