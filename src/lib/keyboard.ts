type ContainmentTarget = {
  contains?(candidate: unknown): boolean;
};

type KeyboardTargetLike = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
  getAttribute?: (name: string) => string | null;
  closest?: (selector: string) => unknown;
};

type ModifierStateTargetLike = {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  getModifierState?: (key: string) => boolean;
};

const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

function isWithinShortcutScope(target: unknown, root?: ContainmentTarget | null) {
  if (!root?.contains) return true;
  try {
    return root.contains(target);
  } catch {
    return false;
  }
}

export function isKeyboardTextEntryTarget(target: unknown): boolean {
  if (!target || typeof target !== 'object') return false;
  const candidate = target as KeyboardTargetLike;
  const tagName = typeof candidate.tagName === 'string' ? candidate.tagName.toUpperCase() : '';

  if (candidate.isContentEditable) return true;
  if (typeof candidate.closest === 'function' && candidate.closest('[contenteditable="true"]')) {
    return true;
  }

  if (tagName === 'TEXTAREA' || tagName === 'SELECT') return true;
  if (tagName === 'INPUT') {
    const type = typeof candidate.type === 'string' ? candidate.type.toLowerCase() : 'text';
    return !NON_TEXT_INPUT_TYPES.has(type);
  }

  if (typeof candidate.getAttribute === 'function') {
    const role = candidate.getAttribute('role');
    if (role === 'textbox' || role === 'searchbox' || role === 'combobox') return true;
  }

  return false;
}

export function shouldIgnoreKeyboardShortcuts(
  eventTarget: unknown,
  activeElement?: unknown,
  root?: ContainmentTarget | null,
) {
  if (isWithinShortcutScope(eventTarget, root) && isKeyboardTextEntryTarget(eventTarget)) {
    return true;
  }
  if (
    activeElement &&
    activeElement !== eventTarget &&
    isWithinShortcutScope(activeElement, root) &&
    isKeyboardTextEntryTarget(activeElement)
  ) {
    return true;
  }
  return false;
}

export function readModifierKeyState(target: unknown) {
  if (!target || typeof target !== 'object') {
    return { primary: false, shift: false };
  }

  const candidate = target as ModifierStateTargetLike;
  const readModifier = (key: string, fallback: boolean) => {
    if (typeof candidate.getModifierState !== 'function') return fallback;
    try {
      return candidate.getModifierState(key);
    } catch {
      return fallback;
    }
  };

  const ctrl = readModifier('Control', !!candidate.ctrlKey);
  const meta = readModifier('Meta', !!candidate.metaKey);
  const shift = readModifier('Shift', !!candidate.shiftKey);
  return {
    primary: ctrl || meta,
    shift,
  };
}
