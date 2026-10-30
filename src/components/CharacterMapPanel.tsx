import { useState } from 'react';
import { FloatingPanel } from './FloatingPanel';
import { insertIntoFocusedEditor } from './insertIntoFocusedEditor';

type PanelTheme = Parameters<typeof FloatingPanel>[0]['theme'];

/** The characters chemists reach for, grouped as ChemDraw's map shows them by use. */
const CHARACTER_GROUPS: Array<{ label: string; characters: string }> = [
  { label: 'Greek', characters: 'αβγδεζηθικλμνξοπρστυφχψωΓΔΘΛΞΠΣΦΨΩ' },
  { label: 'Arrows', characters: '→←↑↓↔⇌⇄⇒⇐⇔⟶' },
  { label: 'Math', characters: '±×÷·≈≠≤≥∞∝√∑∂∫°′″‰' },
  { label: 'Marks', characters: '†‡§¶•‹›«»…–—' },
  { label: 'Super', characters: '⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻' },
  { label: 'Sub', characters: '₀₁₂₃₄₅₆₇₈₉₊₋' },
  { label: 'Other', characters: 'ÅℏℓµΩ℃℉ⒸⓇ™' },
];

/**
 * The character map (ChemDraw 17.1 guide, "Character Map"): click a character to enter it in the
 * text being edited; the eight most recent come first. Buttons never take focus, so the editor
 * keeps its caret.
 */
export function CharacterMapPanel({
  theme,
  isDarkMode,
  onClose,
}: {
  theme: PanelTheme;
  isDarkMode: boolean;
  onClose: () => void;
}) {
  const [pos, setPos] = useState({ x: 220, y: 120 });
  const [size, setSize] = useState({ width: 300, height: 330 });
  const [recent, setRecent] = useState<string[]>([]);
  const [hovered, setHovered] = useState<string | null>(null);
  const [notice, setNotice] = useState(false);
  const insert = (character: string) => {
    if (!insertIntoFocusedEditor(character)) {
      setNotice(true);
      return;
    }
    setNotice(false);
    setRecent((previous) => [character, ...previous.filter((c) => c !== character)].slice(0, 8));
  };
  const cell = (character: string, key: string) => (
    <button
      key={key}
      type="button"
      title={`U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`}
      onMouseDown={(event) => event.preventDefault()}
      onMouseEnter={() => setHovered(character)}
      onClick={() => insert(character)}
      style={{
        width: 26,
        height: 26,
        padding: 0,
        border: `1px solid ${isDarkMode ? '#444' : '#ddd'}`,
        borderRadius: 3,
        background: isDarkMode ? '#2a2a2a' : '#fff',
        color: theme.text,
        fontSize: 15,
        cursor: 'pointer',
      }}
    >
      {character}
    </button>
  );
  return (
    <FloatingPanel
      pos={pos}
      size={size}
      minWidth={240}
      minHeight={200}
      title="Character Map"
      theme={theme}
      isDarkMode={isDarkMode}
      onClose={onClose}
      onPosChange={setPos}
      onSizeChange={setSize}
    >
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 8, overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minHeight: 36 }}>
          <span style={{ fontSize: 30, width: 36, textAlign: 'center', color: theme.text }}>
            {hovered ?? ''}
          </span>
          <span style={{ fontSize: 11, opacity: 0.75, color: theme.text }}>
            {notice
              ? 'Open a label or caption for editing first.'
              : 'Click a character to type it into the text being edited.'}
          </span>
        </div>
        {recent.length > 0 && (
          <div>
            <div style={{ fontSize: 11, opacity: 0.7, color: theme.text }}>Recent</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {recent.map((character) => cell(character, `recent-${character}`))}
            </div>
          </div>
        )}
        {CHARACTER_GROUPS.map((group) => (
          <div key={group.label}>
            <div style={{ fontSize: 11, opacity: 0.7, color: theme.text }}>{group.label}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
              {[...group.characters].map((character) =>
                cell(character, `${group.label}-${character}`),
              )}
            </div>
          </div>
        ))}
      </div>
    </FloatingPanel>
  );
}
