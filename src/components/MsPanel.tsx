import { useCallback } from 'react';
import { useStore } from '../store';
import { useCachedStructureTask } from '../hooks/useCachedStructureTask';
import { FloatingPanel } from './FloatingPanel';
import type { MsSpectrum } from '../types/chemistry';
import type { PanelTheme } from '../types/panelTheme';
import { invokeTauri } from '../lib/tauri';

interface Props {
  theme: PanelTheme;
  isDarkMode: boolean;
  viewerSmiles: string;
}

interface SidecarMsResult {
  error?: string;
  peaks?: MsSpectrum['peaks'];
  exact_mass?: number;
  formula?: string;
}

const CHART_MARGIN = { top: 10, right: 14, bottom: 30, left: 44 };

function MsChart({
  spectrum,
  isDarkMode,
  width,
  height,
}: {
  spectrum: MsSpectrum;
  isDarkMode: boolean;
  width: number;
  height: number;
}) {
  const chartW = width - CHART_MARGIN.left - CHART_MARGIN.right;
  const chartH = height - CHART_MARGIN.top - CHART_MARGIN.bottom;
  if (chartW <= 0 || chartH <= 0 || spectrum.peaks.length === 0) return null;

  const mzValues = spectrum.peaks.map((p) => p.mz);
  const minMz = Math.min(...mzValues) - 0.8;
  const maxMz = Math.max(...mzValues) + 0.8;
  const mzRange = maxMz - minMz;

  const mzToX = (mz: number) => ((mz - minMz) / mzRange) * chartW;
  const intToY = (pct: number) => chartH * (1 - pct / 100);

  const textColor = isDarkMode ? '#aaa' : '#555';
  const axisColor = isDarkMode ? '#555' : '#ccc';
  const bgColor = isDarkMode ? '#1e1e1e' : '#fff';
  const barColor = isDarkMode ? '#4fc3f7' : '#1565c0';
  const labelColor = isDarkMode ? '#80cbc4' : '#00695c';

  const xTicks = spectrum.peaks.map((p) => Math.round(p.mz));
  const yTicks = [0, 25, 50, 75, 100];

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <rect x={0} y={0} width={width} height={height} fill={bgColor} />
      <g transform={`translate(${CHART_MARGIN.left},${CHART_MARGIN.top})`}>
        <line x1={0} y1={0} x2={0} y2={chartH} stroke={axisColor} strokeWidth={1} />
        <line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke={axisColor} strokeWidth={1} />
        <text
          transform={`translate(-36,${chartH / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize={9}
          fill={textColor}
        >
          Rel. Int. (%)
        </text>
        {yTicks.map((t) => {
          const y = intToY(t);
          return (
            <g key={t}>
              <line x1={-3} y1={y} x2={0} y2={y} stroke={axisColor} strokeWidth={1} />
              <text x={-5} y={y + 3} textAnchor="end" fontSize={7} fill={textColor}>
                {t}
              </text>
              {t > 0 && t < 100 && (
                <line
                  x1={0}
                  y1={y}
                  x2={chartW}
                  y2={y}
                  stroke={axisColor}
                  strokeWidth={0.5}
                  strokeDasharray="2,3"
                />
              )}
            </g>
          );
        })}
        {xTicks.map((nom) => {
          const x = mzToX(nom);
          return (
            <g key={nom} transform={`translate(${x},${chartH})`}>
              <line y1={0} y2={4} stroke={axisColor} strokeWidth={1} />
              <text y={14} textAnchor="middle" fontSize={8} fill={textColor}>
                {nom}
              </text>
            </g>
          );
        })}
        <text x={chartW / 2} y={chartH + 26} textAnchor="middle" fontSize={9} fill={textColor}>
          m/z
        </text>
        {spectrum.peaks.map((peak, i) => {
          const x = mzToX(peak.mz);
          const y = intToY(peak.intensity);
          return (
            <g key={i}>
              <line x1={x} y1={chartH} x2={x} y2={y} stroke={barColor} strokeWidth={2} />
              {peak.intensity > 5 && (
                <text x={x} y={y - 3} textAnchor="middle" fontSize={7} fill={labelColor}>
                  {peak.intensity.toFixed(1)}%
                </text>
              )}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

export function MsPanel({ theme, isDarkMode, viewerSmiles }: Props) {
  const { msPos, msSize, setMsPos, setMsSize, setShowMsPanel, viewerStructureStatus } = useStore();
  const run = useCallback(
    (smiles: string) => invokeTauri<SidecarMsResult>('predict_ms', { smiles }),
    [],
  );
  const selectData = useCallback((response: SidecarMsResult) => {
    if (
      !response.error &&
      response.peaks &&
      response.exact_mass !== undefined &&
      response.formula
    ) {
      return {
        data: {
          peaks: response.peaks,
          exact_mass: response.exact_mass,
          formula: response.formula,
        } satisfies MsSpectrum,
      };
    }
    return { error: response.error ?? 'Computation failed.' };
  }, []);
  const state = useCachedStructureTask({
    viewerSmiles,
    viewerStructureStatus,
    unavailableMessage: 'Mass prediction is unavailable for this structure.',
    run,
    selectData,
  });

  const spectrum = state.data;
  const headerH = 28;
  const infoH = spectrum ? 18 : 0;
  const chartH = msSize.height - headerH - infoH - 16;

  return (
    <FloatingPanel
      pos={msPos}
      size={msSize}
      minWidth={300}
      minHeight={160}
      title="Mass Spectrum (isotope pattern)"
      theme={theme}
      isDarkMode={isDarkMode}
      onClose={() => setShowMsPanel(false)}
      onPosChange={setMsPos}
      onSizeChange={setMsSize}
    >
      {spectrum && (
        <div
          style={{
            padding: '2px 8px',
            fontSize: 10,
            color: theme.text,
            opacity: 0.7,
            flexShrink: 0,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {spectrum.formula} &nbsp;·&nbsp; M = {spectrum.exact_mass.toFixed(4)} Da
        </div>
      )}
      <div style={{ flex: 1, overflow: 'hidden', padding: '0 8px 8px' }}>
        {state.status === 'idle' && (
          <div style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 20 }}>
            Draw a structure to see isotope pattern.
          </div>
        )}
        {state.status === 'loading' && (
          <div style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 20 }}>
            Computing…
          </div>
        )}
        {state.status === 'error' && (
          <div
            style={{
              fontSize: 11,
              color: '#c0392b',
              textAlign: 'center',
              marginTop: 8,
              padding: '6px 8px',
              border: '1px solid #c0392b',
              borderRadius: 4,
              background: isDarkMode ? 'rgba(192,57,43,0.12)' : 'rgba(192,57,43,0.06)',
              margin: 8,
            }}
          >
            {state.error}
          </div>
        )}
        {state.status === 'success' && spectrum && spectrum.peaks.length > 0 && (
          <MsChart
            spectrum={spectrum}
            isDarkMode={isDarkMode}
            width={msSize.width - 16}
            height={chartH}
          />
        )}
      </div>
    </FloatingPanel>
  );
}
