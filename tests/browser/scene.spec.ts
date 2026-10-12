import { test, expect } from '@playwright/test';

test('move, rotate and scale previews paint exactly the committed scene', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const codec = (await import(
      String('/src/utils/cdxml.ts')
    )) as typeof import('../../src/utils/cdxml');
    const model = (await import(
      String('/src/lib/chemdrawModel.ts')
    )) as typeof import('../../src/lib/chemdrawModel');
    const scenes = (await import(
      String('/src/editor/scene/buildScene.ts')
    )) as typeof import('../../src/editor/scene/buildScene');
    const previews = (await import(
      String('/src/editor/scene/preview.ts')
    )) as typeof import('../../src/editor/scene/preview');
    const commands = (await import(
      String('/src/editor/commands/index.ts')
    )) as typeof import('../../src/editor/commands');
    const renderer = (await import(
      String('/src/editor/scene/renderDocumentScene.ts')
    )) as typeof import('../../src/editor/scene/renderDocumentScene');
    const surface = (await import(
      String('/tests/browser/surfaceHarness.tsx')
    )) as typeof import('./surfaceHarness');
    const settings = (await import(
      String('/src/lib/settings.ts')
    )) as typeof import('../../src/lib/settings');
    const source = codec.cdxmlToChemDrawDocument(
      '<CDXML><page id="1"><fragment id="2"><n id="3" p="80 80" Element="7"/><n id="4" p="110 80" Element="8"/><b id="5" B="3" E="4" Order="2"/></fragment><t id="6" p="90 130"><s face="1">styled</s></t></page></CDXML>',
    ).document;
    const build = (document: typeof source) =>
      scenes.buildDocumentSceneState({
        document,
        canvasState: {
          ...model.chemDrawDocumentToCanvasState(document).state,
          groups: [],
          textBoxes: model.chemDrawDocumentToCanvasState(document).state.textBoxes ?? [],
        },
        documentStyleSettings: source.metadata!.documentStyleSettings!,
        documentViewSettings: settings.CHEMDRAW_FIDELITY_DOCUMENT_VIEW_SETTINGS,
        pageSetup: source.metadata!.pageSetup!,
      });
    const paint = (scene: ReturnType<typeof build>) => {
      const canvas = document.createElement('canvas');
      canvas.width = 500;
      canvas.height = 500;
      renderer.renderDocumentScene(canvas.getContext('2d')!, scene, {
        width: 500,
        height: 500,
        stageScale: 1,
        stagePos: { x: 0, y: 0 },
        drawPageChrome: false,
      });
      return canvas.toDataURL();
    };
    const ids = new Set(['3', '4', '5', '6']);
    const context = commands.createEditorCommandContext({
      activePageId: '1',
      documentStyleSettings: source.metadata!.documentStyleSettings!,
      pageSetup: source.metadata!.pageSetup!,
    });
    const transforms: import('../../src/editor/types').SelectionPreviewTransform[] = [
      {
        kind: 'move',
        dx: 20,
        dy: 30,
        selectedObjectIds: ids,
        movedAtomIds: new Set(['3', '4']),
        affectedBondIds: new Set(['5']),
      },
      {
        kind: 'rotate',
        center: { x: 100, y: 100 },
        radians: 0.6,
        selectedObjectIds: ids,
        movedAtomIds: new Set(['3', '4']),
        affectedBondIds: new Set(['5']),
      },
      {
        kind: 'scale',
        anchor: { x: 100, y: 100 },
        factor: 1.3,
        selectedObjectIds: ids,
        movedAtomIds: new Set(['3', '4']),
        affectedBondIds: new Set(['5']),
      },
    ];
    return transforms.map((transform) => {
      const options = { objectIds: ids };
      const command =
        transform.kind === 'move'
          ? commands.createMoveSelectionCommand({ dx: transform.dx, dy: transform.dy }, options)
          : transform.kind === 'rotate'
            ? commands.createRotateSelectionCommand(transform.center, transform.radians, options)
            : commands.createScaleSelectionCommand(transform.anchor, transform.factor, options);
      const committed = build(command.apply(source, context).document);
      const preview = previews.buildPreviewScene(build(source), source, {
        transform,
        arrow: null,
        ring: null,
        line: null,
      });
      return {
        exportExcludesPreview:
          surface.renderSurfaceExport(preview, build(source)) === paint(build(source)),
        kind: transform.kind,
        equal: paint(preview) === paint(committed),
        changed: paint(preview) !== paint(build(source)),
      };
    });
  });
  expect(results).toEqual([
    { exportExcludesPreview: true, kind: 'move', equal: true, changed: true },
    { exportExcludesPreview: true, kind: 'rotate', equal: true, changed: true },
    { exportExcludesPreview: true, kind: 'scale', equal: true, changed: true },
  ]);
});
