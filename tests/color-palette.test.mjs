import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PALETTE_COLORS,
  addPaletteColor,
  normalizeColorPalette,
} from '../.unit-test-dist/src/lib/colorPalette.js';
import { normalizeAppPreferences } from '../.unit-test-dist/src/lib/settings.js';

test('a saved palette keeps distinct hex colours, newest first, up to the limit', () => {
  assert.deepEqual(normalizeColorPalette(['#ABCDEF', 'red', '#abcdef', 3, '#123456']), [
    '#abcdef',
    '#123456',
  ]);
  assert.deepEqual(addPaletteColor(['#111111', '#222222'], '#222222'), ['#222222', '#111111']);
  const many = Array.from({ length: 40 }, (_, i) => `#0000${i.toString(16).padStart(2, '0')}`);
  assert.equal(normalizeColorPalette(many).length, MAX_PALETTE_COLORS);
  assert.deepEqual(normalizeAppPreferences({}).colorPalette, []);
});
