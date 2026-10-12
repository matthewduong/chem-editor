import { createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  DocumentRenderSurface,
  type DocumentRenderSurfaceRef,
} from '../../src/editor/scene/DocumentRenderSurface';
import type { DocumentSceneState } from '../../src/editor/scene/types';

export function renderSurfaceExport(visible: DocumentSceneState, committed: DocumentSceneState) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const ref = createRef<DocumentRenderSurfaceRef>();
  try {
    flushSync(() =>
      root.render(
        <DocumentRenderSurface
          ref={ref}
          scene={visible}
          exportScene={committed}
          width={500}
          height={500}
          stageScale={1}
          stagePos={{ x: 0, y: 0 }}
        />,
      ),
    );
    return ref.current!.toDataURL();
  } finally {
    root.unmount();
    container.remove();
  }
}
