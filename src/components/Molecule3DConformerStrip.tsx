import type { Viewer3DMolecule } from '../lib/viewer3d';

interface Props {
  isDarkMode: boolean;
  borderColor: string;
  conformers: Viewer3DMolecule[];
  confIndex: number;
  setConfIndex: (index: number) => void;
}

export function Molecule3DConformerStrip({
  isDarkMode,
  borderColor,
  conformers,
  confIndex,
  setConfIndex,
}: Props) {
  if (conformers.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        background: isDarkMode ? '#1a1a1a' : '#f0f0f0',
        padding: '6px',
        display: 'flex',
        gap: '8px',
        overflowX: 'auto',
        borderTop: `1px solid ${borderColor}`,
        scrollbarWidth: 'none',
        minHeight: '40px',
        flexShrink: 0,
        zIndex: 10,
      }}
    >
      {conformers.map((conformer, index) => (
        <button
          key={index}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            setConfIndex(index);
          }}
          style={{
            fontSize: '10px',
            padding: '4px 10px',
            whiteSpace: 'nowrap',
            background: confIndex === index ? '#007acc' : isDarkMode ? '#333' : '#fff',
            color: confIndex === index ? '#fff' : isDarkMode ? '#ccc' : '#333',
            border: `1px solid ${confIndex === index ? '#007acc' : borderColor}`,
            borderRadius: '4px',
            cursor: 'pointer',
            fontWeight: 'bold',
            height: '28px',
            display: 'flex',
            alignItems: 'center',
            flexDirection: 'column',
            justifyContent: 'center',
          }}
          title={`Energy: ${conformer.energy?.toFixed(2)} kcal/mol`}
        >
          <span style={{ fontSize: '9px' }}>#{index + 1}</span>
          <span style={{ fontSize: '8px', opacity: 0.8 }}>
            {index === 0
              ? 'Best'
              : typeof conformer.delta_e === 'number'
                ? `ΔE: ${conformer.delta_e.toFixed(1)}`
                : 'Alt'}
          </span>
        </button>
      ))}
    </div>
  );
}
