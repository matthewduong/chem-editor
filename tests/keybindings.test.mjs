import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CANVAS_TOOL_SHORTCUTS,
  assignShortcutBinding,
  buildDefaultKeybindingPreferences,
  getCanvasToolShortcut,
} from '../.unit-test-dist/src/lib/keybindings.js';

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
    CANVAS_TOOL_SHORTCUTS.map((shortcut) => shortcut.tool),
    ['select', 'pan', 'bond', 'ring', 'text', 'arrow', 'eraser'],
  );
});

test('canvas tool shortcut resolver honors defaults, conflicts, and custom bindings', () => {
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('v'))?.tool, 'select');
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('h'))?.tool, 'pan');
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('b'))?.tool, 'bond');
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('r'))?.tool, 'ring');
  assert.equal(getCanvasToolShortcut(undefined, keyEvent('x'))?.tool, 'eraser');
  assert.equal(
    getCanvasToolShortcut(undefined, keyEvent('v'), { hasHoveredAtomOrBond: true }),
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
