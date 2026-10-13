import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { buildDocumentSceneState } from '../.unit-test-dist/src/editor/scene/buildScene.js';
import { renderDocumentScene } from '../.unit-test-dist/src/editor/scene/renderDocumentScene.js';
import { hitTestDocumentScene } from '../.unit-test-dist/src/editor/scene/hitTest.js';
import { cdxmlToChemDrawDocument } from '../.unit-test-dist/src/utils/cdxml.js';
import { chemDrawDocumentToCanvasState } from '../.unit-test-dist/src/lib/chemdrawModel.js';
import {
  DEFAULT_DOCUMENT_STYLE_SETTINGS,
  DEFAULT_DOCUMENT_VIEW_SETTINGS,
  DEFAULT_PAGE_SETUP,
} from '../.unit-test-dist/src/lib/settings.js';
import { createRecordingContext } from '../scripts/lib/recording-canvas.mjs';
function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(freeze);
  }
  return value;
}
function input(document) {
  const state = chemDrawDocumentToCanvasState(document).state;
  return {
    document,
    canvasState: freeze({ ...state, groups: state.groups ?? [], textBoxes: state.textBoxes ?? [] }),
    documentStyleSettings: DEFAULT_DOCUMENT_STYLE_SETTINGS,
    documentViewSettings: DEFAULT_DOCUMENT_VIEW_SETTINGS,
    pageSetup: DEFAULT_PAGE_SETUP,
  };
}
const fixtures = readdirSync('tests/fixtures/cdxml').filter((f) => f.endsWith('.cdxml'));
for (const fixture of fixtures)
  test(`cache parity for labels, styles, groups and crossings: ${fixture}`, () => {
    const document = freeze(
      cdxmlToChemDrawDocument(readFileSync(`tests/fixtures/cdxml/${fixture}`, 'utf8')).document,
    );
    const args = input(document),
      cached = buildDocumentSceneState(args),
      again = buildDocumentSceneState(args),
      uncached = buildDocumentSceneState({ ...args, useCache: false });
    assert.equal(cached.index, again.index);
    assert.equal(cached.legacy, again.legacy);
    assert.deepEqual(cached.index, uncached.index);
    assert.deepEqual(cached.legacy, uncached.legacy);
    for (const viewport of [
      { stageScale: 1, stagePos: { x: 0, y: 0 } },
      { stageScale: 2, stagePos: { x: -20, y: 30 } },
    ]) {
      const record = (scene) => {
        const ctx = createRecordingContext();
        renderDocumentScene(ctx, scene, { width: 600, height: 600, ...viewport });
        return ctx.__ops;
      };
      assert.deepEqual(record(cached), record(uncached));
      for (const node of args.canvasState.atoms)
        assert.deepEqual(
          hitTestDocumentScene(cached, node, { stageScale: viewport.stageScale }),
          hitTestDocumentScene(uncached, node, { stageScale: viewport.stageScale }),
        );
    }
    const style = {
      ...DEFAULT_DOCUMENT_STYLE_SETTINGS,
      textFormat: { ...DEFAULT_DOCUMENT_STYLE_SETTINGS.textFormat, fontSize: 18 },
    };
    const changed = buildDocumentSceneState({ ...args, documentStyleSettings: style });
    assert.notEqual(changed.index, cached.index);
    assert.notEqual(changed.legacy, cached.legacy);
    const replacement = input(freeze(structuredClone(document)));
    assert.notEqual(buildDocumentSceneState(replacement).index, cached.index);
  });
test('mutable inputs bypass caches and cannot expose obsolete geometry', () => {
  const document = cdxmlToChemDrawDocument(
    '<CDXML><page id="1"><fragment id="f"><n id="a" p="0 0"/><n id="b" p="30 0"/><b id="c" B="a" E="b"/></fragment></page></CDXML>',
  ).document;
  const before = buildDocumentSceneState(input(document));
  document.pages[0].objects.find((o) => o.id === 'a').position.x = 100;
  const after = buildDocumentSceneState(input(document));
  assert.notEqual(before.index, after.index);
  assert.notDeepEqual(before.index.boundsById.get('a'), after.index.boundsById.get('a'));
});
