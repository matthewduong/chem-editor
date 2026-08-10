import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANVAS_TOOL_SHORTCUTS,
  assignShortcutBinding,
  buildDefaultKeybindingPreferences,
  getCanvasToolShortcut,
  getShortcutBinding,
} from '../.unit-test-dist/src/lib/keybindings.js';
import { normalizeAppPreferences } from '../.unit-test-dist/src/lib/settings.js';

function keyEvent(key, options = {}) {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...options,
  };
}

test('canvas tool shortcuts cover the primary drawing tools', () => {
  assert.deepEqual(
    CANVAS_TOOL_SHORTCUTS.map((shortcut) => [shortcut.id, shortcut.tool]),
    [
      ['canvas.tools.select', 'select'],
      ['canvas.tools.pan', 'pan'],
      ['canvas.tools.bond', 'bond'],
      ['canvas.tools.ring', 'ring'],
      ['canvas.tools.text', 'text'],
      ['canvas.tools.arrow', 'arrow'],
      ['canvas.tools.benzene', 'fragment'],
      ['canvas.tools.cyclopentadiene', 'fragment'],
      ['canvas.tools.cyclohexane', 'fragment'],
      ['canvas.tools.cyclopentane', 'fragment'],
      ['canvas.tools.eraser', 'eraser'],
    ],
  );
});

test('canvas tool shortcut resolver honors defaults, conflicts, and custom bindings', () => {
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('v')), null);
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('h')), null);
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('b')), null);
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('r')), null);
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('x'))?.tool, 'bond');
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('t'))?.tool, 'text');
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('e'))?.tool, 'arrow');
  assert.deepEqual(getCanvasToolShortcut(undefined, keyEvent('j')), {
    id: 'canvas.tools.benzene',
    tool: 'fragment',
    selectedFragment: 'c1ccccc1',
    label: 'Switch to benzene tool',
    description: 'Switch to the benzene fragment tool when no canvas object is hovered.',
    category: 'Tools',
    context: 'canvas',
    defaultBinding: { key: 'j' },
  });
  assert.equal(
    getCanvasToolShortcut(undefined, keyEvent('j', { shiftKey: true }))?.id,
    'canvas.tools.cyclopentadiene',
  );
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('u'))?.id, 'canvas.tools.cyclohexane');
  assert.equal(
    getCanvasToolShortcut(undefined, keyEvent('u', { shiftKey: true }))?.id,
    'canvas.tools.cyclopentane',
  );
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('x'), { hasHoveredObject: true }), null);
  assert.equal(
    getCanvasToolShortcut(undefined, keyEvent('x'), { hasHoveredAtomOrBond: true }),
    null,
  );

  const preferences = assignShortcutBinding(
    buildDefaultKeybindingPreferences(),
    'canvas.tools.ring',
    { key: 'q' },
  );

  assert.equal(getCanvasToolShortcut(preferences, keyEvent('q'))?.tool, 'ring');
  assert.equal(getCanvasToolShortcut(preferences, keyEvent('r')), null);
});

test('preferences migration replaces stale non-ChemDraw tool defaults', () => {
  const normalized = normalizeAppPreferences({
    version: 9,
    keybindings: {
      bindings: {
        'canvas.tools.select': { key: 'v' },
        'canvas.tools.pan': { key: 'p' },
        'canvas.tools.bond': { key: 'b' },
        'canvas.tools.ring': { key: 'r' },
        'canvas.tools.eraser': { key: 'x' },
      },
    },
  });

  assert.equal(normalized.version, 10);
  assert.deepEqual(getShortcutBinding(normalized.keybindings, 'canvas.tools.select'), { key: '' });
  assert.deepEqual(getShortcutBinding(normalized.keybindings, 'canvas.tools.pan'), { key: 'p' });
  assert.deepEqual(getShortcutBinding(normalized.keybindings, 'canvas.tools.bond'), { key: 'x' });
  assert.deepEqual(getShortcutBinding(normalized.keybindings, 'canvas.tools.ring'), { key: '' });
  assert.deepEqual(getShortcutBinding(normalized.keybindings, 'canvas.tools.eraser'), { key: '' });
  assert.deepEqual(getShortcutBinding(normalized.keybindings, 'canvas.tools.benzene'), {
    key: 'j',
  });
  assert.deepEqual(getShortcutBinding(normalized.keybindings, 'canvas.tools.cyclohexane'), {
    key: 'u',
  });
});
