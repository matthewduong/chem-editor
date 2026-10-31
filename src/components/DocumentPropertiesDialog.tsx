import { useState } from 'react';
import { createSelectionEditCommand } from '../editor/commands';
import {
  READ_ONLY_DOCUMENT_PROPERTIES,
  readDocumentProperties,
  setDocumentProperties,
  type EditableDocumentProperty,
} from '../lib/documentProperties';
import { useStore } from '../store';
import { FloatingPanel } from './FloatingPanel';

type PanelTheme = Parameters<typeof FloatingPanel>[0]['theme'];

const LABELS: Record<string, string> = {
  Name: 'Name',
  Comment: 'Comment',
  CreationUserName: 'Author',
  CreationProgram: 'Created with',
  CreationDate: 'Created',
  ModificationProgram: 'Last saved with',
  ModificationDate: 'Last saved',
  ModificationUserName: 'Last saved by',
};

/** File > Document Properties: see `documentProperties.ts`. Each edit is one undo step. */
export function DocumentPropertiesDialog({
  theme,
  isDarkMode,
  onClose,
}: {
  theme: PanelTheme;
  isDarkMode: boolean;
  onClose: () => void;
}) {
  const [pos, setPos] = useState({ x: 260, y: 120 });
  const [size, setSize] = useState({ width: 320, height: 330 });
  const document = useStore((s) => s.chemDrawDocument);
  const properties = readDocumentProperties(document);
  const commit = (name: EditableDocumentProperty, value: string) =>
    useStore
      .getState()
      .dispatchEditorCommand(
        createSelectionEditCommand('document-properties', (doc) =>
          setDocumentProperties(doc, { [name]: value }),
        ),
      );
  const field = (name: EditableDocumentProperty, multiline = false) => {
    const props = {
      'aria-label': LABELS[name],
      defaultValue: properties[name] ?? '',
      onFocus: () => useStore.getState().setIsInputFocused(true),
      onBlur: (event: { target: { value: string } }) => {
        useStore.getState().setIsInputFocused(false);
        commit(name, event.target.value);
      },
      style: { width: '100%', boxSizing: 'border-box' as const },
    };
    return (
      <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {LABELS[name]}
        {multiline ? (
          <textarea key={`${name}:${properties[name] ?? ''}`} rows={3} {...props} />
        ) : (
          <input key={`${name}:${properties[name] ?? ''}`} {...props} />
        )}
      </label>
    );
  };
  return (
    <FloatingPanel
      pos={pos}
      size={size}
      minWidth={260}
      minHeight={200}
      title="Document Properties"
      theme={theme}
      isDarkMode={isDarkMode}
      onClose={onClose}
      onPosChange={setPos}
      onSizeChange={setSize}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: 10,
          fontSize: 12,
          color: theme.text,
          overflowY: 'auto',
        }}
      >
        {field('Name')}
        {field('CreationUserName')}
        {field('Comment', true)}
        {READ_ONLY_DOCUMENT_PROPERTIES.filter((name) => properties[name]).map((name) => (
          <div key={name} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ opacity: 0.7 }}>{LABELS[name]}</span>
            <span>{properties[name]}</span>
          </div>
        ))}
      </div>
    </FloatingPanel>
  );
}
