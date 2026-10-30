import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  cdxmlToChemDrawDocument,
  chemDrawDocumentToCDXML,
} from '../.unit-test-dist/src/utils/cdxml.js';

const source = readFileSync(
  new URL('./fixtures/cdxml/reaction-step.cdxml', import.meta.url),
  'utf8',
);

test('a scheme step is read, gives the fragments their roles, and is written back', () => {
  const { document, warnings } = cdxmlToChemDrawDocument(source);
  const page = document.pages[0];
  assert.deepEqual(page.schemes, [
    {
      id: '40',
      steps: [
        {
          id: '41',
          reactants: ['10'],
          products: ['30'],
          arrows: ['20'],
          aboveArrow: ['21'],
          belowArrow: [],
        },
      ],
    },
  ]);
  assert.equal(page.objects.find((o) => o.id === '10').role, 'reactant');
  assert.equal(page.objects.find((o) => o.id === '30').role, 'product');
  assert.ok(!warnings.some((w) => /heuristically/.test(w)));
  assert.equal(page.preservedPageChildren, undefined);
  const xml = chemDrawDocumentToCDXML(document);
  assert.match(
    xml,
    /<step id="41" ReactionStepReactants="10" ReactionStepProducts="30" ReactionStepArrows="20" ReactionStepObjectsAboveArrow="21"\/>/,
  );
});

test('a step never names an object that is gone', () => {
  const { document } = cdxmlToChemDrawDocument(source);
  const page = document.pages[0];
  const without = {
    ...document,
    pages: [{ ...page, objects: page.objects.filter((o) => o.id !== '21') }],
  };
  const xml = chemDrawDocumentToCDXML(without);
  assert.match(xml, /<step id="41"[^>]*\/>/);
  assert.ok(!/ReactionStepObjectsAboveArrow/.test(xml));
});

test('a scheme with something other than steps in it stays raw', () => {
  const odd = source.replace('<step id="41"', '<foo id="99"/><step id="41"');
  const { document } = cdxmlToChemDrawDocument(odd);
  assert.equal(document.pages[0].schemes, undefined);
  assert.ok(chemDrawDocumentToCDXML(document).includes('<foo id="99"/>'));
});

test('empty and unknown step lists are kept as they can be', () => {
  const odd = source.replace(
    'ReactionStepObjectsAboveArrow="21"',
    'ReactionStepObjectsAboveArrow="" ReactionStepAtomMap="1 2"',
  );
  const { document } = cdxmlToChemDrawDocument(odd);
  const step = document.pages[0].schemes[0].steps[0];
  assert.deepEqual(step.aboveArrow, []);
  assert.deepEqual(step.rawAttributes, { ReactionStepAtomMap: '1 2' });
  assert.match(chemDrawDocumentToCDXML(document), /ReactionStepAtomMap="1 2"/);
});

test('an ordinary edit keeps the scheme', async () => {
  const { chemDrawDocumentToCanvasState, mergeCanvasStateIntoChemDrawDocument } =
    await import('../.unit-test-dist/src/lib/chemdrawModel.js');
  const { document } = cdxmlToChemDrawDocument(source);
  const { state } = chemDrawDocumentToCanvasState(document);
  const moved = { ...state, atoms: state.atoms.map((a) => ({ ...a, x: a.x + 5 })) };
  const merged = mergeCanvasStateIntoChemDrawDocument(document, moved).document;
  assert.deepEqual(merged.pages[0].schemes, document.pages[0].schemes);
});

test('roles are set from a selection into the nearest step, or a new one around the arrow', async () => {
  const { assignReactionRole } = await import('../.unit-test-dist/src/lib/reactionRoles.js');
  const { DEFAULT_DOCUMENT_STYLE_SETTINGS } =
    await import('../.unit-test-dist/src/lib/settings.js');
  let n = 100;
  const newId = () => String(n++);
  const { document } = cdxmlToChemDrawDocument(source);
  const below = assignReactionRole(
    document,
    new Set(['21']),
    'belowArrow',
    DEFAULT_DOCUMENT_STYLE_SETTINGS,
    newId,
  );
  const step = below.pages[0].schemes[0].steps[0];
  assert.deepEqual(step.aboveArrow, []);
  assert.deepEqual(step.belowArrow, ['21']);
  // Selecting an atom of the product makes the whole structure the reactant.
  const swapped = assignReactionRole(
    below,
    new Set(['31']),
    'reactants',
    DEFAULT_DOCUMENT_STYLE_SETTINGS,
    newId,
  );
  assert.deepEqual(swapped.pages[0].schemes[0].steps[0].reactants, ['10', '30']);
  assert.deepEqual(swapped.pages[0].schemes[0].steps[0].products, []);
  assert.equal(swapped.pages[0].objects.find((o) => o.id === '30').role, 'reactant');
  const removed = assignReactionRole(
    swapped,
    new Set(['30']),
    null,
    DEFAULT_DOCUMENT_STYLE_SETTINGS,
    newId,
  );
  assert.deepEqual(removed.pages[0].schemes[0].steps[0].reactants, ['10']);

  const bare = { ...document, pages: [{ ...document.pages[0], schemes: undefined }] };
  const made = assignReactionRole(
    bare,
    new Set(['30']),
    'products',
    DEFAULT_DOCUMENT_STYLE_SETTINGS,
    newId,
  );
  assert.deepEqual(made.pages[0].schemes[0].steps[0].arrows, ['20']);
  assert.deepEqual(made.pages[0].schemes[0].steps[0].products, ['30']);
});

test('Show Reaction Interpretation outlines each role on screen only', async () => {
  const { buildFixtureScene, RENDER_OPTIONS } = await import('../scripts/lib/scene-goldens.mjs');
  const { createRecordingContext } = await import('../scripts/lib/recording-canvas.mjs');
  const { renderDocumentScene } =
    await import('../.unit-test-dist/src/editor/scene/renderDocumentScene.js');
  const labels = async (showReactionRoles) => {
    const scene = { ...(await buildFixtureScene('reaction-step.cdxml')), showReactionRoles };
    const ctx = createRecordingContext();
    renderDocumentScene(ctx, scene, RENDER_OPTIONS);
    return ctx.__ops
      .filter((op) => op.name === 'fillText')
      .map((op) => op.args[0])
      .filter((text) => ['Reactant', 'Product', 'Above arrow', 'Arrow'].includes(text));
  };
  assert.deepEqual((await labels(true)).sort(), ['Above arrow', 'Arrow', 'Product', 'Reactant']);
  assert.deepEqual(await labels(false), []);
});
