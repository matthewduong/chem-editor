import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isKeyboardTextEntryTarget,
  readModifierKeyState,
  shouldIgnoreKeyboardShortcuts,
} from '../.unit-test-dist/src/lib/keyboard.js';

test('text-style inputs block global shortcuts', () => {
  assert.equal(isKeyboardTextEntryTarget({ tagName: 'input', type: 'text' }), true);
  assert.equal(isKeyboardTextEntryTarget({ tagName: 'textarea' }), true);
  assert.equal(
    isKeyboardTextEntryTarget({
      tagName: 'div',
      getAttribute: (name) => (name === 'role' ? 'combobox' : null),
    }),
    true,
  );
});

test('non-text inputs do not block global shortcuts', () => {
  assert.equal(isKeyboardTextEntryTarget({ tagName: 'input', type: 'checkbox' }), false);
  assert.equal(isKeyboardTextEntryTarget({ tagName: 'button' }), false);
});

test('contenteditable regions block global shortcuts', () => {
  assert.equal(isKeyboardTextEntryTarget({ tagName: 'div', isContentEditable: true }), true);
  assert.equal(
    isKeyboardTextEntryTarget({
      tagName: 'span',
      closest: (selector) => (selector === '[contenteditable="true"]' ? {} : null),
    }),
    true,
  );
});

test('active text inputs still block shortcuts when the event target is elsewhere', () => {
  const outsideTarget = { tagName: 'div' };
  const activeInput = { tagName: 'input', type: 'search' };
  const root = {
    contains(candidate) {
      return candidate === outsideTarget || candidate === activeInput;
    },
  };

  assert.equal(shouldIgnoreKeyboardShortcuts(outsideTarget, activeInput, root), true);
});

test('focus outside the shortcut scope does not block app shortcuts', () => {
  const appButton = { tagName: 'button' };
  const outsideInput = { tagName: 'input', type: 'text' };
  const root = {
    contains(candidate) {
      return candidate === appButton;
    },
  };

  assert.equal(shouldIgnoreKeyboardShortcuts(appButton, outsideInput, root), false);
});

test('modifier keys can be read from event flags or getModifierState', () => {
  assert.deepEqual(readModifierKeyState({ ctrlKey: true, shiftKey: false }), {
    primary: true,
    shift: false,
  });
  assert.deepEqual(
    readModifierKeyState({
      getModifierState(key) {
        return key === 'Meta' || key === 'Shift';
      },
    }),
    {
      primary: true,
      shift: true,
    },
  );
  assert.deepEqual(readModifierKeyState(null), {
    primary: false,
    shift: false,
  });
});
