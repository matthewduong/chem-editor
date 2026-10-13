import { useRef, useState } from 'react';
import { useStore } from '../store';
import { useRDKit } from '../hooks/useRDKit';
import { checkStructure } from '../lib/chemistry/diagnostics';
import { createRDKitChemistryService } from '../lib/chemistry/rdkit';
import type { ChemistryDiagnostic } from '../lib/chemistry/service';
import type { ChemDrawDocument } from '../types/chemdraw';

export function StructureDiagnostics({ reveal }: { reveal: (ids: string[]) => void }) {
  const document = useStore((s) => s.chemDrawDocument);
  const { rdkit, loading } = useRDKit();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<{
    source: ChemDrawDocument;
    issues: ChemistryDiagnostic[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const serial = useRef(0);
  const current = result?.source === document ? result : null;
  const check = async () => {
    setOpen(true);
    if (!document) return;
    const request = ++serial.current;
    setBusy(true);
    try {
      const issues = await checkStructure(document, createRDKitChemistryService(rdkit));
      if (request === serial.current && document === useStore.getState().chemDrawDocument)
        setResult({ source: document, issues });
    } finally {
      if (request === serial.current) setBusy(false);
    }
  };
  return (
    <>
      <button onClick={() => void check()} disabled={busy} title="Check Structure">
        Check Structure
      </button>
      {open && (
        <aside
          aria-label="Structure diagnostics"
          style={{
            position: 'fixed',
            top: 50,
            right: 12,
            zIndex: 2500,
            maxHeight: '65vh',
            overflow: 'auto',
            width: 360,
            background: '#fff',
            color: '#222',
            padding: 12,
            border: '1px solid #888',
            borderRadius: 6,
          }}
        >
          <button onClick={() => setOpen(false)} aria-label="Close diagnostics">
            ×
          </button>
          <strong>Structure diagnostics</strong>
          {busy ? (
            <p>Checking…</p>
          ) : !current ? (
            <p>Document changed. Run Check Structure again.</p>
          ) : (
            <>
              {!current.issues.some((i) => i.severity === 'error' || i.severity === 'warning') && (
                <p>No issues found by the available checks.</p>
              )}
              {current.issues.map((issue, i) => (
                <div key={i} style={{ marginTop: 10 }}>
                  <button
                    disabled={!issue.objectIds.length}
                    onClick={() => reveal(issue.objectIds)}
                    style={{ textAlign: 'left' }}
                  >
                    {issue.severity}: {issue.message}
                  </button>
                  {issue.availability === 'unavailable' && <small> Check unavailable</small>}
                </div>
              ))}
            </>
          )}
          {loading && <p>RDKit is still loading. Local checks remain available.</p>}
        </aside>
      )}
    </>
  );
}
