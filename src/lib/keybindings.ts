import type { KeybindingPreferences, ShortcutBinding } from '../types/settings';

export type ShortcutCategory =
  | 'File'
  | 'Edit'
  | 'View'
  | 'Arrange'
  | 'Selection'
  | 'Tools'
  | 'Atoms'
  | 'Bonds & Rings'
  | 'Fragments';

export type ShortcutContext = 'global' | 'canvas';

export interface ShortcutDefinition {
  id: string;
  label: string;
  description: string;
  category: ShortcutCategory;
  context: ShortcutContext;
  defaultBinding: ShortcutBinding;
}

export const APP_SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  {
    id: 'app.file.new',
    label: 'New document',
    description: 'Start a new document.',
    category: 'File',
    context: 'global',
    defaultBinding: { key: 'n', primary: true },
  },
  {
    id: 'app.file.save',
    label: 'Save document',
    description: 'Save the current document.',
    category: 'File',
    context: 'global',
    defaultBinding: { key: 's', primary: true },
  },
  {
    id: 'app.file.save-as',
    label: 'Save document as',
    description: 'Save the current document to a new file path.',
    category: 'File',
    context: 'global',
    defaultBinding: { key: 's', primary: true, shift: true },
  },
  {
    id: 'app.file.open',
    label: 'Open document',
    description: 'Open a ChemEditor document.',
    category: 'File',
    context: 'global',
    defaultBinding: { key: 'o', primary: true },
  },
  {
    id: 'app.file.print',
    label: 'Print',
    description: 'Print the current document.',
    category: 'File',
    context: 'global',
    defaultBinding: { key: 'p', primary: true },
  },
  {
    id: 'app.edit.undo',
    label: 'Undo',
    description: 'Undo the last change.',
    category: 'Edit',
    context: 'global',
    defaultBinding: { key: 'z', primary: true },
  },
  {
    id: 'app.edit.redo',
    label: 'Redo',
    description: 'Redo the last undone change.',
    category: 'Edit',
    context: 'global',
    defaultBinding: { key: 'y', primary: true },
  },
  {
    id: 'app.edit.select-all',
    label: 'Select all',
    description: 'Select every object on the canvas.',
    category: 'Edit',
    context: 'global',
    defaultBinding: { key: 'a', primary: true },
  },
  {
    id: 'app.edit.copy',
    label: 'Copy selection',
    description: 'Copy the current selection.',
    category: 'Edit',
    context: 'global',
    defaultBinding: { key: 'c', primary: true },
  },
  {
    id: 'app.edit.cut',
    label: 'Cut selection',
    description: 'Cut the current selection.',
    category: 'Edit',
    context: 'global',
    defaultBinding: { key: 'x', primary: true },
  },
  {
    id: 'app.edit.paste',
    label: 'Paste',
    description: 'Paste from the clipboard.',
    category: 'Edit',
    context: 'global',
    defaultBinding: { key: 'v', primary: true },
  },
  {
    id: 'app.edit.cleanup',
    label: 'Clean up structure',
    description: 'Run the structure cleanup/layout command.',
    category: 'Edit',
    context: 'global',
    defaultBinding: { key: 'k', primary: true },
  },
  {
    id: 'app.view.fit',
    label: 'Fit to screen',
    description: 'Fit the drawing to the current viewport.',
    category: 'View',
    context: 'global',
    defaultBinding: { key: '0', primary: true },
  },
  {
    id: 'app.view.toggle-theme',
    label: 'Toggle theme',
    description: 'Switch between light and dark mode.',
    category: 'View',
    context: 'global',
    defaultBinding: { key: 'l', primary: true },
  },
  {
    id: 'app.view.fullscreen',
    label: 'Toggle fullscreen',
    description: 'Toggle the native fullscreen window mode on macOS.',
    category: 'View',
    context: 'global',
    defaultBinding: { key: 'f', primary: true },
  },
  {
    id: 'app.arrange.rotate',
    label: 'Rotate selection',
    description: 'Open the rotate selection dialog.',
    category: 'Arrange',
    context: 'global',
    defaultBinding: { key: 'r', primary: true },
  },
  {
    id: 'app.arrange.group',
    label: 'Group selection',
    description: 'Group selected objects.',
    category: 'Arrange',
    context: 'global',
    defaultBinding: { key: 'g', primary: true },
  },
  {
    id: 'app.arrange.ungroup',
    label: 'Ungroup selection',
    description: 'Ungroup selected objects.',
    category: 'Arrange',
    context: 'global',
    defaultBinding: { key: 'g', primary: true, shift: true },
  },
  {
    id: 'app.arrange.align-left',
    label: 'Align left',
    description: 'Align selected objects to the left edge.',
    category: 'Arrange',
    context: 'global',
    defaultBinding: { key: 'l', primary: true, shift: true },
  },
  {
    id: 'app.arrange.align-right',
    label: 'Align right',
    description: 'Align selected objects to the right edge.',
    category: 'Arrange',
    context: 'global',
    defaultBinding: { key: 'r', primary: true, shift: true },
  },
  {
    id: 'app.arrange.align-top',
    label: 'Align top',
    description: 'Align selected objects to the top edge.',
    category: 'Arrange',
    context: 'global',
    defaultBinding: { key: 't', primary: true, shift: true },
  },
  {
    id: 'app.arrange.align-bottom',
    label: 'Align bottom',
    description: 'Align selected objects to the bottom edge.',
    category: 'Arrange',
    context: 'global',
    defaultBinding: { key: 'b', primary: true, shift: true },
  },
  {
    id: 'app.arrange.center-h',
    label: 'Center horizontally',
    description: 'Center selected objects horizontally.',
    category: 'Arrange',
    context: 'global',
    defaultBinding: { key: 'h', primary: true, shift: true },
  },
  {
    id: 'app.arrange.center-v',
    label: 'Center vertically',
    description: 'Center selected objects vertically.',
    category: 'Arrange',
    context: 'global',
    defaultBinding: { key: 'v', primary: true, shift: true },
  },
  {
    id: 'app.arrange.distribute-h',
    label: 'Distribute horizontally',
    description: 'Distribute selected objects horizontally.',
    category: 'Arrange',
    context: 'global',
    defaultBinding: { key: 'd', primary: true, shift: true },
  },
  {
    id: 'app.arrange.distribute-v',
    label: 'Distribute vertically',
    description: 'Distribute selected objects vertically.',
    category: 'Arrange',
    context: 'global',
    defaultBinding: { key: 'e', primary: true, shift: true },
  },
  {
    id: 'app.selection.clear',
    label: 'Clear selection',
    description: 'Deselect everything and close open menus.',
    category: 'Selection',
    context: 'global',
    defaultBinding: { key: 'escape' },
  },
];

export const ATOM_HOTKEY_VALUES: Record<string, string> = {
  c: 'C',
  n: 'N',
  o: 'O',
  f: 'F',
  s: 'S',
  p: 'P',
  h: 'H',
  b: 'Br',
  i: 'I',
  l: 'Cl',
  m: 'Me',
  e: 'Et',
  a: 'Ph',
  d: 'D',
};

export const BOND_HOTKEY_VALUES: Record<
  string,
  { order?: number; stereo?: number; ring?: string }
> = {
  '1': { order: 1, stereo: 0 },
  '2': { order: 2, stereo: 0 },
  '3': { order: 3, stereo: 0 },
  w: { order: 1, stereo: 1 },
  h: { order: 1, stereo: 6 },
  v: { ring: 'C1CC1' },
  '4': { ring: 'C1CCC1' },
  '5': { ring: 'C1CCCC1' },
  '6': { ring: 'C1CCCCC1' },
  '7': { ring: 'C1CCCCCC1' },
  '8': { ring: 'C1CCCCCCC1' },
  a: { ring: 'c1ccccc1' },
  z: { ring: 'C1=CC=CC1' },
};

export const ATOM_FRAGMENT_HOTKEY_VALUES: Record<string, string> = {
  '0': 'C(C)CC',
  '1': 'CC',
  '2': 'C(=O)C',
  '3': 'c1ccccc1',
  '6': 'C1CCCCC1',
  '7': 'C1CCCC1',
  '8': 'CCC',
  '9': 'CC(C)C',
  z: 'C#CC',
  Z: 'N=[N+]=[N-]',
  v: 'C1CC1',
  u: 'C1CCC1',
  k: 'S(=O)(=O)C',
  K: 'C(C)(C)C',
};

export const FRAGMENT_MIN_FV: Record<string, number> = {
  '0': 2,
  '1': 1,
  '2': 3,
  '3': 2,
  '6': 2,
  '7': 2,
  '8': 1,
  '9': 1,
  z: 3,
  Z: 2,
  v: 2,
  u: 2,
  k: 1,
  K: 3,
};

export const ATOM_FRAGMENT_OPTIONS: Record<string, Array<{ minFV: number; smiles: string }>> = {
  z: [
    { minFV: 3, smiles: 'C#CC' },
    { minFV: 1, smiles: 'CC#CC' },
  ],
  '2': [
    { minFV: 3, smiles: 'C(=O)C' },
    { minFV: 2, smiles: 'C=O' },
  ],
  K: [
    { minFV: 3, smiles: 'C(C)(C)C' },
    { minFV: 2, smiles: 'C(C)C' },
    { minFV: 1, smiles: 'CC' },
  ],
  '0': [
    { minFV: 2, smiles: 'C(C)CC' },
    { minFV: 1, smiles: 'CCC' },
  ],
};

const CANVAS_FIXED_SHORTCUTS: ShortcutDefinition[] = [
  {
    id: 'canvas.selection.component',
    label: 'Select connected object',
    description: 'Select the hovered atom, bond, arrow, text box, or connected component.',
    category: 'Selection',
    context: 'canvas',
    defaultBinding: { key: 'space' },
  },
  {
    id: 'canvas.atom.edit',
    label: 'Edit hovered atom label',
    description: 'Open the hovered atom label editor.',
    category: 'Atoms',
    context: 'canvas',
    defaultBinding: { key: 'enter' },
  },
  {
    id: 'canvas.tools.text',
    label: 'Switch to text tool',
    description: 'Switch to the text tool when nothing is hovered.',
    category: 'Tools',
    context: 'canvas',
    defaultBinding: { key: 't' },
  },
  {
    id: 'canvas.tools.arrow',
    label: 'Switch to arrow tool',
    description: 'Switch to the arrow tool when nothing is hovered.',
    category: 'Tools',
    context: 'canvas',
    defaultBinding: { key: 'e' },
  },
  {
    id: 'canvas.delete',
    label: 'Delete hovered or selected object',
    description: 'Delete the current selection or the hovered object.',
    category: 'Edit',
    context: 'canvas',
    defaultBinding: { key: 'delete' },
  },
  {
    id: 'canvas.delete.backspace',
    label: 'Delete hovered or selected object (Backspace)',
    description: 'Delete the current selection or the hovered object.',
    category: 'Edit',
    context: 'canvas',
    defaultBinding: { key: 'backspace' },
  },
  {
    id: 'canvas.stereo.wedge',
    label: 'Add wedge bond',
    description: 'Add a wedged bond from the hovered atom.',
    category: 'Bonds & Rings',
    context: 'canvas',
    defaultBinding: { key: '4' },
  },
  {
    id: 'canvas.stereo.hash',
    label: 'Add hashed bond',
    description: 'Add a hashed bond from the hovered atom.',
    category: 'Bonds & Rings',
    context: 'canvas',
    defaultBinding: { key: '5' },
  },
];

export const ATOM_SHORTCUT_DEFINITIONS: ShortcutDefinition[] = Object.entries(
  ATOM_HOTKEY_VALUES,
).map(([key, value]) => ({
  id: `canvas.atom.${key}`,
  label: `Apply ${value}`,
  description: `Replace the hovered atom with ${value}.`,
  category: 'Atoms',
  context: 'canvas',
  defaultBinding: bindingFromKeyToken(key),
}));

export const BOND_SHORTCUT_DEFINITIONS: ShortcutDefinition[] = Object.entries(
  BOND_HOTKEY_VALUES,
).map(([key, value]) => ({
  id: `canvas.bond.${key}`,
  label: value.ring
    ? key === 'a'
      ? 'Attach benzene'
      : key === 'z'
        ? 'Attach cyclopentadiene'
        : `Attach ring (${key})`
    : value.stereo === 1
      ? 'Set wedge bond'
      : value.stereo === 6
        ? 'Set hashed bond'
        : `Set bond order ${value.order}`,
  description: value.ring
    ? 'Attach the corresponding ring to the hovered bond.'
    : 'Apply the corresponding bond style to the hovered bond.',
  category: 'Bonds & Rings',
  context: 'canvas',
  defaultBinding: bindingFromKeyToken(key),
}));

export const FRAGMENT_SHORTCUT_DEFINITIONS: ShortcutDefinition[] = Object.entries(
  ATOM_FRAGMENT_HOTKEY_VALUES,
).map(([key, value]) => ({
  id: `canvas.fragment.${key}`,
  label: `Attach fragment ${value}`,
  description: 'Attach the corresponding fragment to the hovered atom.',
  category: 'Fragments',
  context: 'canvas',
  defaultBinding: bindingFromKeyToken(key),
}));

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  ...APP_SHORTCUT_DEFINITIONS,
  ...CANVAS_FIXED_SHORTCUTS,
  ...ATOM_SHORTCUT_DEFINITIONS,
  ...BOND_SHORTCUT_DEFINITIONS,
  ...FRAGMENT_SHORTCUT_DEFINITIONS,
];

export const SHORTCUT_DEFINITION_MAP = Object.fromEntries(
  SHORTCUT_DEFINITIONS.map((definition) => [definition.id, definition]),
) as Record<string, ShortcutDefinition>;

export const SHORTCUT_CATEGORIES: ShortcutCategory[] = [
  'File',
  'Edit',
  'View',
  'Arrange',
  'Selection',
  'Tools',
  'Atoms',
  'Bonds & Rings',
  'Fragments',
];

export function normalizeKey(key: string): string {
  if (key === ' ') return 'space';
  if (key.length === 1) return key.toLowerCase();
  const lowered = key.toLowerCase();
  if (lowered === 'esc') return 'escape';
  return lowered;
}

function bindingFromKeyToken(key: string): ShortcutBinding {
  return {
    key: normalizeKey(key),
    ...(/^[A-Z]$/.test(key) ? { shift: true } : {}),
  };
}

export function normalizeShortcutBinding(
  binding: ShortcutBinding | null | undefined,
): ShortcutBinding | null {
  if (!binding || typeof binding.key !== 'string' || !binding.key.trim()) return null;
  return {
    key: normalizeKey(binding.key.trim()),
    ...(binding.primary ? { primary: true } : {}),
    ...(binding.shift ? { shift: true } : {}),
    ...(binding.alt ? { alt: true } : {}),
  };
}

export function buildDefaultKeybindingPreferences(): KeybindingPreferences {
  return {
    bindings: Object.fromEntries(
      SHORTCUT_DEFINITIONS.map((definition) => [definition.id, { ...definition.defaultBinding }]),
    ),
  };
}

export function getShortcutBinding(
  preferences: KeybindingPreferences | undefined,
  shortcutId: string,
): ShortcutBinding | null {
  const custom = normalizeShortcutBinding(preferences?.bindings?.[shortcutId]);
  if (custom) return custom;
  return SHORTCUT_DEFINITION_MAP[shortcutId]?.defaultBinding ?? null;
}

export function eventMatchesShortcut(
  event: KeyboardEvent,
  binding: ShortcutBinding | null | undefined,
) {
  const normalized = normalizeShortcutBinding(binding);
  if (!normalized) return false;
  return (
    normalizeKey(event.key) === normalized.key &&
    Boolean(event.ctrlKey || event.metaKey) === Boolean(normalized.primary) &&
    Boolean(event.shiftKey) === Boolean(normalized.shift) &&
    Boolean(event.altKey) === Boolean(normalized.alt)
  );
}

export function eventToShortcutBinding(event: KeyboardEvent): ShortcutBinding | null {
  const key = normalizeKey(event.key);
  if (['control', 'meta', 'shift', 'alt'].includes(key)) return null;
  return {
    key,
    ...(event.ctrlKey || event.metaKey ? { primary: true } : {}),
    ...(event.shiftKey ? { shift: true } : {}),
    ...(event.altKey ? { alt: true } : {}),
  };
}

export function formatShortcutBinding(binding: ShortcutBinding | null | undefined): string {
  const normalized = normalizeShortcutBinding(binding);
  if (!normalized) return 'Unassigned';
  const parts: string[] = [];
  if (normalized.primary) parts.push(navigator.platform.startsWith('Mac') ? 'Cmd' : 'Ctrl');
  if (normalized.alt) parts.push(navigator.platform.startsWith('Mac') ? 'Option' : 'Alt');
  if (normalized.shift) parts.push('Shift');
  parts.push(formatKeyLabel(normalized.key));
  return parts.join(' + ');
}

export function areShortcutBindingsEqual(
  left: ShortcutBinding | null | undefined,
  right: ShortcutBinding | null | undefined,
): boolean {
  const normalizedLeft = normalizeShortcutBinding(left);
  const normalizedRight = normalizeShortcutBinding(right);
  return (
    normalizedLeft?.key === normalizedRight?.key &&
    Boolean(normalizedLeft?.primary) === Boolean(normalizedRight?.primary) &&
    Boolean(normalizedLeft?.shift) === Boolean(normalizedRight?.shift) &&
    Boolean(normalizedLeft?.alt) === Boolean(normalizedRight?.alt)
  );
}

export function assignShortcutBinding(
  preferences: KeybindingPreferences,
  shortcutId: string,
  binding: ShortcutBinding,
): KeybindingPreferences {
  const nextBinding = normalizeShortcutBinding(binding);
  if (!nextBinding) return preferences;

  const nextEntries = Object.fromEntries(
    Object.entries(preferences.bindings).map(([id, existing]) => [
      id,
      id !== shortcutId && areShortcutBindingsEqual(existing, nextBinding) ? null : existing,
    ]),
  );

  return {
    bindings: {
      ...nextEntries,
      [shortcutId]: nextBinding,
    },
  };
}

function formatKeyLabel(key: string): string {
  if (key === 'space') return 'Space';
  if (key === 'escape') return 'Esc';
  if (key === 'delete') return 'Delete';
  if (key === 'backspace') return 'Backspace';
  if (key === 'enter') return 'Enter';
  return key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1);
}
