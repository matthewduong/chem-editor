import { useEffect, useMemo, useState } from 'react';
import {
  assignShortcutBinding,
  buildDefaultKeybindingPreferences,
  eventToShortcutBinding,
  formatShortcutBinding,
  SHORTCUT_CATEGORIES,
  SHORTCUT_DEFINITIONS,
  type ShortcutCategory,
} from '../lib/keybindings';
import type { AppPreferences } from '../types/settings';
import type { AppTheme } from './ViewerPanel';
import { FloatingPanel } from './FloatingPanel';

interface KeybindingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  appPreferences: AppPreferences;
  setAppPreferences: (preferences: AppPreferences) => void;
  theme: AppTheme;
  isDarkMode: boolean;
}

export function KeybindingsPanel({
  isOpen,
  onClose,
  appPreferences,
  setAppPreferences,
  theme,
  isDarkMode,
}: KeybindingsPanelProps) {
  const [panelPos, setPanelPos] = useState(() => ({
    x: Math.max(24, Math.round((window.innerWidth - 760) / 2)),
    y: Math.max(24, Math.round((window.innerHeight - 640) / 2)),
  }));
  const [panelSize, setPanelSize] = useState({ width: 760, height: 640 });
  const [recordingShortcutId, setRecordingShortcutId] = useState<string | null>(null);

  useEffect(() => {
    if (!recordingShortcutId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const binding = eventToShortcutBinding(event);
      if (!binding) return;
      setAppPreferences({
        ...appPreferences,
        keybindings: assignShortcutBinding(
          appPreferences.keybindings,
          recordingShortcutId,
          binding,
        ),
      });
      setRecordingShortcutId(null);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [appPreferences, recordingShortcutId, setAppPreferences]);

  const groupedShortcuts = useMemo(
    () =>
      SHORTCUT_CATEGORIES.map((category) => ({
        category,
        items: SHORTCUT_DEFINITIONS.filter((definition) => definition.category === category),
      })).filter((section) => section.items.length > 0),
    [],
  );

  if (!isOpen) return null;

  const badgeStyle = (category: ShortcutCategory) => ({
    padding: '2px 6px',
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    color:
      category === 'Atoms' || category === 'Bonds & Rings' || category === 'Fragments'
        ? '#0d5aa7'
        : isDarkMode
          ? '#d2d2d2'
          : '#555',
    background:
      category === 'Atoms' || category === 'Bonds & Rings' || category === 'Fragments'
        ? isDarkMode
          ? 'rgba(54, 134, 214, 0.2)'
          : '#e7f1ff'
        : isDarkMode
          ? '#363636'
          : '#efefef',
  });

  return (
    <FloatingPanel
      pos={panelPos}
      size={panelSize}
      minWidth={560}
      minHeight={420}
      title="Keyboard Shortcuts"
      theme={theme}
      isDarkMode={isDarkMode}
      zIndex={3200}
      positionMode="fixed"
      onClose={() => {
        setRecordingShortcutId(null);
        onClose();
      }}
      onPosChange={setPanelPos}
      onSizeChange={setPanelSize}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
        <div
          style={{
            padding: '12px 14px',
            borderBottom: `1px solid ${theme.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ fontSize: 12, color: isDarkMode ? '#b8b8b8' : '#666', lineHeight: 1.45 }}>
            This list is generated from the live shortcut registry, so new shortcuts added in code
            will show up here automatically. Click a shortcut to record a new binding.
          </div>
          <button
            type="button"
            onClick={() =>
              setAppPreferences({
                ...appPreferences,
                keybindings: buildDefaultKeybindingPreferences(),
              })
            }
            style={{
              padding: '6px 10px',
              borderRadius: 6,
              border: `1px solid ${theme.border}`,
              background: isDarkMode ? '#2d2d2d' : '#fff',
              color: theme.text,
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Reset All
          </button>
        </div>
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            padding: 14,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {groupedShortcuts.map((section) => (
            <div
              key={section.category}
              style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                  color: isDarkMode ? '#8f8f8f' : '#6b6b6b',
                }}
              >
                {section.category}
              </div>
              {section.items.map((shortcut) => {
                const activeBinding = appPreferences.keybindings.bindings[shortcut.id];
                const isRecording = recordingShortcutId === shortcut.id;
                return (
                  <div
                    key={shortcut.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(0, 1fr) auto auto',
                      gap: 10,
                      alignItems: 'center',
                      padding: '10px 12px',
                      border: `1px solid ${theme.border}`,
                      borderRadius: 8,
                      background: isDarkMode ? '#262626' : '#fcfcfc',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                      <div
                        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
                      >
                        <span style={{ color: theme.text, fontSize: 13, fontWeight: 700 }}>
                          {shortcut.label}
                        </span>
                        <span style={badgeStyle(section.category)}>{shortcut.context}</span>
                      </div>
                      <div style={{ fontSize: 11, color: isDarkMode ? '#b5b5b5' : '#666' }}>
                        {shortcut.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        setRecordingShortcutId((current) =>
                          current === shortcut.id ? null : shortcut.id,
                        )
                      }
                      style={{
                        minWidth: 140,
                        padding: '8px 10px',
                        borderRadius: 7,
                        border: `1px solid ${isRecording ? '#007acc' : theme.border}`,
                        background: isRecording ? '#007acc' : isDarkMode ? '#333' : '#fff',
                        color: isRecording ? '#fff' : theme.text,
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {isRecording ? 'Press keys…' : formatShortcutBinding(activeBinding)}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setAppPreferences({
                          ...appPreferences,
                          keybindings: assignShortcutBinding(
                            appPreferences.keybindings,
                            shortcut.id,
                            shortcut.defaultBinding,
                          ),
                        })
                      }
                      style={{
                        padding: '8px 10px',
                        borderRadius: 7,
                        border: `1px solid ${theme.border}`,
                        background: 'transparent',
                        color: theme.text,
                        cursor: 'pointer',
                        fontSize: 12,
                      }}
                    >
                      Reset
                    </button>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </FloatingPanel>
  );
}
