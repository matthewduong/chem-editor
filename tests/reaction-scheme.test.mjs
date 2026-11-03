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

test('Clean Up Reaction lays the step out along its arrow', async () => {
  const { cleanUpReaction } = await import('../.unit-test-dist/src/lib/reactionCleanup.js');
  const { getObjectsBounds } = await import('../.unit-test-dist/src/lib/chemdrawModel.js');
  const { DEFAULT_DOCUMENT_STYLE_SETTINGS: settings } =
    await import('../.unit-test-dist/src/lib/settings.js');
  // Scatter the fixture: the product far below, the reagent off to one side.
  const { document } = cdxmlToChemDrawDocument(source);
  const page = document.pages[0];
  const shifted = {
    ...document,
    pages: [
      {
        ...page,
        objects: page.objects.map((o) =>
          o.type === 'node' && ['31', '32', '33'].includes(o.id)
            ? { ...o, position: { x: o.position.x + 40, y: o.position.y + 90 } }
            : o.type === 'text' && o.id === '21'
              ? { ...o, anchor: { x: o.anchor.x - 70, y: o.anchor.y + 50 } }
              : o,
        ),
      },
    ],
  };
  const clean = cleanUpReaction(shifted, settings);
  const arrow = clean.pages[0].objects.find((o) => o.id === '20');
  const box = (id) => getObjectsBounds(clean, [id], settings);
  const midY = (b) => (b.top + b.bottom) / 2;
  // ChemDraw 26.1.0.6801: 1.515 x CaptionSize between a structure and the arrow's end, and 0.575 x
  // CaptionSize from the arrow to text above or below it (gaps.md).
  const gap = 1.515 * settings.nativeMetrics.captionSize;
  assert.ok(Math.abs(box('10').right - (arrow.tail.x - gap)) < 1e-6);
  assert.ok(Math.abs(box('30').left - (arrow.head.x + gap)) < 1e-6);
  assert.ok(Math.abs(midY(box('10')) - arrow.tail.y) < 1e-6);
  assert.ok(Math.abs(midY(box('30')) - arrow.tail.y) < 1e-6);
  const reagent = box('21');
  assert.ok(
    Math.abs(reagent.bottom - (arrow.tail.y - 0.575 * settings.nativeMetrics.captionSize)) < 1e-6,
  );
  assert.ok(
    Math.abs((reagent.left + reagent.right) / 2 - (arrow.tail.x + arrow.head.x) / 2) < 1e-6,
  );
});

test('Clean Up Reaction puts a + between reactants, with a gap on each side (ChemDraw 26.1.0.6801)', async () => {
  const { cleanUpReaction } = await import('../.unit-test-dist/src/lib/reactionCleanup.js');
  const { getObjectsBounds } = await import('../.unit-test-dist/src/lib/chemdrawModel.js');
  const { DEFAULT_DOCUMENT_STYLE_SETTINGS: settings } =
    await import('../.unit-test-dist/src/lib/settings.js');
  const xml = `<?xml version="1.0"?><CDXML BondLength="14.4" CaptionSize="10"><page id="1">
    <fragment id="10"><n id="11" p="0 20" Element="6"/><n id="12" p="12.47 12.8" Element="6"/><b id="13" B="11" E="12"/></fragment>
    <fragment id="14"><n id="15" p="30 60" Element="6"/><n id="16" p="42.47 52.8" Element="6"/><b id="17" B="15" E="16"/></fragment>
    <arrow id="20" Head3D="190 16 0" Tail3D="140 16 0" ArrowheadHead="Full" ArrowheadType="Solid" HeadSize="1000" ArrowheadCenterSize="875" ArrowheadWidth="250"/>
    <fragment id="30"><n id="31" p="205 20" Element="6"/><n id="32" p="217.47 12.8" Element="6"/><b id="33" B="31" E="32"/></fragment>
    <scheme id="40"><step id="41" ReactionStepReactants="10 14" ReactionStepProducts="30" ReactionStepArrows="20"/></scheme>
  </page></CDXML>`;
  const { document } = cdxmlToChemDrawDocument(xml);
  let n = 0;
  const clean = cleanUpReaction(document, settings, () => `plus${n++}`);
  const plus = clean.pages[0].objects.filter((o) => o.type === 'text');
  assert.equal(plus.length, 1);
  assert.equal(plus[0].text.runs[0].text, '+');
  const gap = 1.515 * settings.nativeMetrics.captionSize;
  const arrow = clean.pages[0].objects.find((o) => o.id === '20');
  const box = (id) => getObjectsBounds(clean, [id], settings);
  // Reactant 14 stands a gap before the arrow; reactant 10 a gap, the plus and a gap before that.
  assert.ok(Math.abs(box('14').right - (arrow.tail.x - gap)) < 1e-6);
  const plusWidth = 0.473 * settings.nativeMetrics.captionSize;
  assert.ok(Math.abs(box('10').right - (box('14').left - 2 * gap - plusWidth)) < 1e-6);
  // The plus box's left edge is 0.056 x the size right of its anchor, centred between them.
  const left = plus[0].anchor.x + 0.056 * settings.nativeMetrics.captionSize;
  assert.ok(Math.abs(left - (box('14').left - gap - plusWidth)) < 1e-6);
});
