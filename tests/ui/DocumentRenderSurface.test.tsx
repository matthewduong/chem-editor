import { act, render } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { DocumentRenderSurface } from '../../src/editor/scene/DocumentRenderSurface';
import type { DocumentSceneState } from '../../src/editor/scene/types';
const mock = vi.hoisted(() => ({ paint: vi.fn() }));
vi.mock('../../src/editor/scene/renderDocumentScene', () => ({ renderDocumentScene: mock.paint }));
it('coalesces pending scene changes and paints the latest viewport; unmount cancels work', () => {
  const frames = new Map<number, FrameRequestCallback>();
  let next = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++next, callback);
    return next;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const context = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
  const scene = {} as DocumentSceneState,
    nextScene = {} as DocumentSceneState;
  const props = { width: 100, height: 100, stageScale: 1, stagePos: { x: 0, y: 0 } };
  try {
    const view = render(<DocumentRenderSurface scene={scene} {...props} />);
    view.rerender(<DocumentRenderSurface scene={nextScene} {...props} stageScale={2} />);
    expect(frames.size).toBe(1);
    expect(mock.paint).not.toHaveBeenCalled();
    act(() => {
      const callback = frames.get(1)!;
      frames.delete(1);
      callback(0);
    });
    expect(mock.paint).toHaveBeenCalledWith(
      context,
      nextScene,
      expect.objectContaining({ stageScale: 2 }),
    );
    view.rerender(<DocumentRenderSurface scene={scene} {...props} />);
    expect(frames.size).toBe(1);
    view.unmount();
    expect(frames.size).toBe(0);
  } finally {
    vi.unstubAllGlobals();
  }
});
