import React, { useMemo, useEffect } from 'react';
import { useRDKit } from '../hooks/useRDKit';
import type { RdkitMol } from '../types/rdkit';

interface Props {
  smiles: string;
  molblock?: string;
  width?: number;
  height?: number;
  isDarkMode?: boolean;
  hoveredAtomIdx?: number | null;
  selectedAtomIdx?: number | null;
}

export const Molecule: React.FC<Props> = ({
  smiles,
  molblock = '',
  width = 300,
  height = 200,
  isDarkMode = false,
  hoveredAtomIdx = null,
  selectedAtomIdx = null,
}) => {
  const { rdkit, loading, failed } = useRDKit();

  const svg = useMemo(() => {
    if (loading || !rdkit || (!smiles && !molblock)) return null;

    try {
      let mol: RdkitMol | null = null;
      if (molblock) {
        try {
          mol = rdkit.get_mol(molblock, JSON.stringify({ sanitize: false, removeHs: false }));
        } catch {
          mol = rdkit.get_mol(molblock);
        }
      }
      if (!mol && smiles) {
        mol = rdkit.get_mol(smiles);
      }
      if (!mol) return 'Invalid SMILES';

      // For Dark Mode, we explicitly set colors to pure white [1,1,1]
      // For Light Mode, we use black [0,0,0]
      const color = isDarkMode ? [1, 1, 1, 1] : [0, 0, 0, 1];

      const params: Record<string, unknown> = {
        width: Math.round(width),
        height: Math.round(height),
        backgroundColour: [1, 1, 1, 0], // Always transparent
        bondLineWidth: 2.0,
        additionalAtomLabelPadding: 0.066,
        clearBackground: true,
        symbolColour: color,
        legendColour: color,
        annotationColour: color,
        // In dark mode, override carbon (6) to light gray so bonds are visible
        ...(isDarkMode && { atomColourPalette: { 6: [0.75, 0.75, 0.75] } }),
      };

      const highlightAtoms = [selectedAtomIdx, hoveredAtomIdx]
        .filter((idx): idx is number => idx !== null)
        .filter((idx, index, arr) => arr.indexOf(idx) === index);
      const atomHighlights = Object.fromEntries(
        highlightAtoms.map((idx) => [
          idx,
          idx === selectedAtomIdx
            ? isDarkMode
              ? [0.96, 0.7, 0.2, 0.85]
              : [0.98, 0.55, 0.08, 0.85]
            : isDarkMode
              ? [0.49, 0.83, 0.98, 0.75]
              : [0.12, 0.53, 0.9, 0.7],
        ]),
      );

      let svgString = '';
      try {
        svgString =
          mol.get_svg_with_highlights?.(
            JSON.stringify({
              ...params,
              atoms: highlightAtoms,
              highlightAtomColors: atomHighlights,
            }),
          ) ?? '';
      } catch {
        svgString = '';
      }
      if (!svgString) {
        svgString = mol.get_svg(width, height);
      }

      mol.delete();
      return svgString;
    } catch (e) {
      console.error('RDKit SVG error:', e);
      return 'Error rendering molecule';
    }
  }, [
    rdkit,
    loading,
    smiles,
    molblock,
    width,
    height,
    isDarkMode,
    hoveredAtomIdx,
    selectedAtomIdx,
  ]);

  const imgUrl = useMemo(() => {
    if (!svg || typeof svg !== 'string' || !svg.startsWith('<')) return null;
    return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  }, [svg]);

  useEffect(() => {
    return () => {
      if (imgUrl) URL.revokeObjectURL(imgUrl);
    };
  }, [imgUrl]);

  if (loading)
    return (
      <div style={{ color: isDarkMode ? '#fff' : '#000', padding: 10 }}>Loading Engine...</div>
    );
  if (failed)
    return (
      <div style={{ color: '#f55', padding: 10, fontSize: 12 }}>Chemistry engine unavailable</div>
    );

  const bg = isDarkMode ? '#1e1e1e' : '#f5f5f5';

  return (
    <div
      className="molecule-2d-container"
      style={{
        width,
        height,
        background: bg,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
        borderRadius: '4px',
      }}
    >
      {imgUrl ? (
        <img
          src={imgUrl}
          width={width}
          height={height}
          style={{
            display: 'block',
            filter: isDarkMode ? 'brightness(1.1) saturate(1.2)' : 'none',
          }}
        />
      ) : svg && typeof svg === 'string' && !svg.startsWith('<') ? (
        <div style={{ color: '#f55', fontSize: 11 }}>{svg}</div>
      ) : null}
    </div>
  );
};
