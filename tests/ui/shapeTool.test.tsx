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
  expect(result.current.preview).toMatchObject([{ type: 'graphic', graphicType: 'rectangle' }]);
  expect(useStore.getState().history).toBe(source.history);
  expect(useStore.getState().documentFile.dirty).toBe(false);
  let shape: ReturnType<typeof result.current.commit> = null;
  act(() => {
    shape = result.current.commit();
  });
  expect(shape).toMatchObject([
    {
      type: 'graphic',
      graphicType: 'rectangle',
      bounds: { left: 10, top: 10, right: 60, bottom: 40 },
    },
  ]);
  expect(shape![0].id).not.toBe('__preview-shape');
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

it('a bracket pair commits both brackets; a dagger commits on a click', () => {
  const { result } = renderHook(() => useShapeTool());
  act(() => result.current.begin('pair-round', { x: 10, y: 10 }));
  act(() => result.current.update({ x: 60, y: 40 }));
  let pair: ReturnType<typeof result.current.commit> = null;
  act(() => {
    pair = result.current.commit();
  });
  expect(pair).toHaveLength(2);
  expect(new Set(pair!.map((o) => o.id)).size).toBe(2);

  act(() => result.current.begin('dagger', { x: 30, y: 30 }, { symbolSize: 7 }));
  expect(result.current.preview).toMatchObject([{ graphicType: 'symbol', symbolType: 'Dagger' }]);
  let dagger: ReturnType<typeof result.current.commit> = null;
  act(() => {
    dagger = result.current.commit();
  });
  expect(dagger).toMatchObject([
    {
      graphicType: 'symbol',
      points: [
        { x: 30, y: 30 },
        { x: 30, y: 37 },
      ],
    },
  ]);
});

it('Edit Curve drags a handle of an existing curve and commits it under the same id', () => {
  const curve = {
    id: 'c1',
    type: 'graphic' as const,
    graphicType: 'curve' as const,
    points: [
      { x: -5, y: 0 },
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 35, y: 0 },
      { x: 40, y: 0 },
      { x: 45, y: 0 },
    ],
    preservation: { capability: 'editable' as const },
  };
  act(() =>
    useStore.setState({
      chemDrawDocument: {
        ...useStore.getState().chemDrawDocument!,
        pages: [{ id: 'page', objects: [curve] }],
      },
    }),
  );
  const { result } = renderHook(() => useShapeTool());
  act(() => result.current.begin('edit-curve', { x: 40, y: 1 }, { handleTolerance: 3 }));
  act(() => result.current.update({ x: 40, y: 20 }));
  let edited: ReturnType<typeof result.current.commit> = null;
  act(() => {
    edited = result.current.commit();
  });
  expect(edited).toHaveLength(1);
  expect(edited![0].id).toBe('c1');
  expect(edited![0]).toMatchObject({
    points: [{}, {}, {}, { x: 35, y: 20 }, { x: 40, y: 20 }, {}],
  });
});
