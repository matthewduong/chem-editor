import { memo, useMemo, useState } from 'react';
import { useStore } from '../store';
import { useTemplateLibrary } from '../hooks/useTemplateLibrary';
import { buildBuiltinTemplates, isBuiltinTemplate } from '../lib/builtinTemplates';
import { saveSelectionTemplate, type UserTemplate } from '../lib/templates';
import { generateDocumentSVG } from '../lib/svgExport';

const PAGE_SIZE = 24;

const TemplateThumbnail = memo(function TemplateThumbnail({
  template,
}: {
  template: UserTemplate;
}) {
  const src = useMemo(
    () =>
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(generateDocumentSVG(template.fragment, { transparent: true }))}`,
    [template.fragment],
  );
  return (
    <img
      alt={`${template.name} preview`}
      width={110}
      height={70}
      style={{ objectFit: 'contain' }}
      src={src}
    />
  );
});

export function TemplatesPanel({ insert }: { insert: (template: UserTemplate) => void }) {
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState(''),
    [name, setName] = useState(''),
    [tags, setTags] = useState(''),
    [attachment, setAttachment] = useState(''),
    [showAll, setShowAll] = useState(false);
  const { library, error, busy, update, persistent } = useTemplateLibrary();
  const document = useStore((s) => s.chemDrawDocument);
  const bondLength = useStore((s) => s.documentStyleSettings.bondLength);
  // Built-ins are generated at the document's bond length, so they match its style.
  const builtins = useMemo(() => buildBuiltinTemplates(bondLength), [bondLength]);
  const [selected, setSelected] = useState<string | null>(null);
  const selection = () => {
    const s = useStore.getState();
    return new Set([
      ...s.selectedObjectIds,
      ...s.selectedAtomIds,
      ...s.selectedBondIds,
      ...s.selectedArrowIds,
      ...s.selectedTextBoxIds,
    ]);
  };
  const save = async () => {
    if (!library || !document) return;
    try {
      const point = attachment
        ? document.pages[0]?.objects.find((o) => o.id === attachment)?.type === 'node'
          ? { atomId: attachment }
          : { bondId: attachment }
        : undefined;
      const template = saveSelectionTemplate(
        document,
        selection(),
        name,
        tags
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean),
        point,
      );
      await update({ ...library, templates: [...library.templates, template] });
    } catch (error) {
      useStore
        .getState()
        .showToast(error instanceof Error ? error.message : 'Cannot save template.');
    }
  };
  const current = library?.templates.find((t) => t.id === selected);
  // Thumbnails are generated on render, so only the first page is drawn until asked for more.
  const matches = useMemo(
    () =>
      [...(library?.templates ?? []), ...builtins].filter((t) =>
        `${t.name} ${t.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [library, builtins, query],
  );
  const shown = showAll || query.trim() ? matches : matches.slice(0, PAGE_SIZE);
  return (
    <>
      <button title="Templates" onClick={() => setOpen(!open)}>
        Templates
      </button>
      {open && (
        <aside
          aria-label="Templates"
          style={{
            position: 'fixed',
            top: 80,
            right: 12,
            zIndex: 2400,
            width: 350,
            maxHeight: '70vh',
            overflow: 'auto',
            padding: 12,
            background: '#fff',
            color: '#222',
            border: '1px solid #888',
            borderRadius: 6,
          }}
        >
          <button aria-label="Close templates" onClick={() => setOpen(false)}>
            ×
          </button>
          <strong>Templates</strong>
          {!persistent && (
            <p>
              Browser templates last for this session. Desktop templates are saved in the
              application library.
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          {!library && !error && <p>Loading…</p>}
          <input
            aria-label="Template search"
            placeholder="Search name or tags"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <p>Ring presets</p>
          {[3, 4, 5, 6].map((size) => (
            <button
              key={size}
              onClick={() => {
                const s = useStore.getState();
                s.setRingPreset('polygon');
                s.setRingSize(size);
                s.setTool('ring');
                setOpen(false);
              }}
            >
              {size}-Membered Ring
            </button>
          ))}
          {(['chair', 'chair-flipped'] as const).map((preset) => (
            <button
              key={preset}
              onClick={() => {
                const s = useStore.getState();
                s.setRingPreset(preset);
                s.setTool('ring');
                setOpen(false);
              }}
            >
              {preset === 'chair' ? 'Chair' : 'Flipped chair'}
            </button>
          ))}
          <hr />
          <input
            aria-label="Template name"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            aria-label="Template tags"
            placeholder="Tags, separated by commas"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
          />
          <select
            aria-label="Template attachment point"
            value={attachment}
            onChange={(e) => setAttachment(e.target.value)}
          >
            <option value="">Standalone</option>
            {document?.pages[0]?.objects
              .filter((o) => o.type === 'node' || o.type === 'bond')
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.type} {o.id}
                </option>
              ))}
          </select>
          <button disabled={!library || busy || !name.trim()} onClick={() => void save()}>
            Save selection
          </button>
          <div>
            {shown.map((t) => (
              <div
                key={t.id}
                style={{
                  border: selected === t.id ? '2px solid #1565c0' : '1px solid #ccc',
                  marginTop: 8,
                  padding: 6,
                }}
              >
                <button
                  onClick={() => {
                    setSelected(t.id);
                    setName(t.name);
                    setTags(t.tags.join(', '));
                  }}
                >
                  {t.name}
                </button>
                <TemplateThumbnail template={t} />
                <small>
                  {isBuiltinTemplate(t) ? 'Built-in · ' : ''}
                  {t.tags.join(', ')}
                </small>
                <button
                  onClick={() => {
                    insert(t);
                    setOpen(false);
                  }}
                >
                  Insert
                </button>
              </div>
            ))}
            {matches.length > shown.length && (
              <button style={{ marginTop: 8 }} onClick={() => setShowAll(true)}>
                Show all {matches.length} templates
              </button>
            )}
          </div>
          {current && library && (
            <>
              <button
                disabled={busy || !name.trim()}
                onClick={() =>
                  void update({
                    ...library,
                    templates: library.templates.map((t) =>
                      t.id === current.id
                        ? {
                            ...t,
                            name: name.trim(),
                            tags: tags
                              .split(',')
                              .map((t) => t.trim())
                              .filter(Boolean),
                          }
                        : t,
                    ),
                  })
                }
              >
                Rename / update tags
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  void update({
                    ...library,
                    templates: library.templates.filter((t) => t.id !== current.id),
                  })
                }
              >
                Delete template
              </button>
            </>
          )}
        </aside>
      )}
    </>
  );
}
