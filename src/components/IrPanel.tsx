import { useCallback, useState } from 'react';
import { useStore } from '../store';
import { useCachedStructureTask } from '../hooks/useCachedStructureTask';
import { FloatingPanel } from './FloatingPanel';
import { assignIrPeak } from '../lib/irAssignments';
import type { IrPeak } from '../types/chemistry';
import type { PanelTheme } from '../types/panelTheme';
import { invokeTauri } from '../lib/tauri';

interface Props {
  theme: PanelTheme;
  isDarkMode: boolean;
  viewerSmiles: string;
}

interface SidecarIrResult {
  error?: string;
  fallback?: boolean;
  peaks?: IrPeak[];
}

const CHART_MARGIN = { top: 10, right: 14, bottom: 30, left: 36 };
const WAVENUMBER_MAX = 4000;
const WAVENUMBER_MIN = 400;
const GAMMA = 20;
const N_POINTS = 500;

function IrChart({
  peaks,
  isDarkMode,
  width,
  height,
}: {
  peaks: IrPeak[];
  isDarkMode: boolean;
  width: number;
  height: number;
}) {
  const [hoveredPeakIdx, setHoveredPeakIdx] = useState<number | null>(null);

  const chartW = width - CHART_MARGIN.left - CHART_MARGIN.right;
  const chartH = height - CHART_MARGIN.top - CHART_MARGIN.bottom;
  if (chartW <= 0 || chartH <= 0 || peaks.length === 0) return null;

  const halfGamma = GAMMA / 2;
  const absorbance = new Float64Array(N_POINTS);
  for (const { wavenumber, intensity } of peaks) {
    for (let i = 0; i < N_POINTS; i++) {
      const x = WAVENUMBER_MAX - (i / (N_POINTS - 1)) * (WAVENUMBER_MAX - WAVENUMBER_MIN);
      const dx = x - wavenumber;
      absorbance[i] += (intensity * halfGamma * halfGamma) / (dx * dx + halfGamma * halfGamma);
    }
  }

  let maxAbs = 0;
  for (let i = 0; i < N_POINTS; i++) if (absorbance[i] > maxAbs) maxAbs = absorbance[i];
  const scale = maxAbs > 0 ? 3 / maxAbs : 1;

  const waveToX = (wn: number) =>
    ((WAVENUMBER_MAX - wn) / (WAVENUMBER_MAX - WAVENUMBER_MIN)) * chartW;

  const pts: string[] = [];
  for (let i = 0; i < N_POINTS; i++) {
    const wn = WAVENUMBER_MAX - (i / (N_POINTS - 1)) * (WAVENUMBER_MAX - WAVENUMBER_MIN);
    const t = 100 * Math.exp(-absorbance[i] * scale);
    pts.push(`${waveToX(wn).toFixed(1)},${(chartH * (1 - t / 100)).toFixed(1)}`);
  }

  const textColor = isDarkMode ? '#aaa' : '#555';
  const axisColor = isDarkMode ? '#555' : '#ccc';
  const bgColor = isDarkMode ? '#1e1e1e' : '#fff';
  const lineColor = isDarkMode ? '#4fc3f7' : '#1565c0';
  const tooltipBg = isDarkMode ? 'rgba(30,30,30,0.95)' : 'rgba(255,255,255,0.95)';
  const tooltipBorder = isDarkMode ? '#555' : '#ccc';
  const xTicks = [4000, 3500, 3000, 2500, 2000, 1500, 1000, 500];

  const hoveredPeak = hoveredPeakIdx !== null ? peaks[hoveredPeakIdx] : null;
  const assignment = hoveredPeak ? assignIrPeak(hoveredPeak.wavenumber) : null;

  // Tooltip positioning: flip to left if too close to right edge
  const TOOLTIP_W = 140;
  let tooltipX = 0;
  if (hoveredPeak) {
    const px = waveToX(hoveredPeak.wavenumber);
    tooltipX = px + TOOLTIP_W + 10 > chartW ? px - TOOLTIP_W - 6 : px + 6;
  }

  return (
    <svg
      width={width}
      height={height}
      style={{ display: 'block' }}
      onMouseLeave={() => setHoveredPeakIdx(null)}
    >
      <rect x={0} y={0} width={width} height={height} fill={bgColor} />
      <g transform={`translate(${CHART_MARGIN.left},${CHART_MARGIN.top})`}>
        <text
          transform={`translate(-28,${chartH / 2}) rotate(-90)`}
          textAnchor="middle"
          fontSize={9}
          fill={textColor}
        >
          T%
        </text>
        {[0, 50, 100].map((t) => {
          const y = chartH * (1 - t / 100);
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
        <line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke={axisColor} strokeWidth={1} />
        <line x1={0} y1={0} x2={chartW} y2={0} stroke={axisColor} strokeWidth={0.5} />
        <line x1={0} y1={0} x2={0} y2={chartH} stroke={axisColor} strokeWidth={1} />
        {xTicks.map((wn) => {
          const x = waveToX(wn);
          return (
            <g key={wn} transform={`translate(${x},${chartH})`}>
              <line y1={0} y2={4} stroke={axisColor} strokeWidth={1} />
              <text y={14} textAnchor="middle" fontSize={8} fill={textColor}>
                {wn}
              </text>
            </g>
          );
        })}
        <text x={chartW / 2} y={chartH + 26} textAnchor="middle" fontSize={9} fill={textColor}>
          Wavenumber (cm⁻¹)
        </text>
        <polyline points={pts.join(' ')} fill="none" stroke={lineColor} strokeWidth={1.5} />

        {/* Invisible hit targets per peak */}
        {peaks.map((peak, i) => {
          const x = waveToX(peak.wavenumber);
          return (
            <rect
              key={i}
              x={x - 6}
              y={0}
              width={12}
              height={chartH}
              fill="transparent"
              style={{ cursor: 'crosshair' }}
              onMouseEnter={() => setHoveredPeakIdx(i)}
            />
          );
        })}

        {/* Tooltip */}
        {hoveredPeak && (
          <g>
            <line
              x1={waveToX(hoveredPeak.wavenumber)}
              y1={0}
              x2={waveToX(hoveredPeak.wavenumber)}
              y2={chartH}
              stroke={isDarkMode ? '#ffd54f' : '#f57f17'}
              strokeWidth={1}
              strokeDasharray="3,2"
            />
            <rect
              x={tooltipX}
              y={8}
              width={TOOLTIP_W}
              height={assignment ? 38 : 22}
              rx={4}
              fill={tooltipBg}
              stroke={tooltipBorder}
              strokeWidth={1}
            />
            <text x={tooltipX + 6} y={21} fontSize={9} fill={textColor} fontWeight="bold">
              {hoveredPeak.wavenumber.toFixed(0)} cm⁻¹
            </text>
            {assignment && (
              <text x={tooltipX + 6} y={36} fontSize={9} fill={isDarkMode ? '#80cbc4' : '#00695c'}>
                {assignment.label}
              </text>
            )}
          </g>
        )}
      </g>
    </svg>
  );
}

export function IrPanel({ theme, isDarkMode, viewerSmiles }: Props) {
  const { irPos, irSize, setIrPos, setIrSize, setShowIrPanel, viewerStructureStatus } = useStore();
  const run = useCallback(
    (smiles: string) => invokeTauri<SidecarIrResult>('predict_ir', { smiles }),
    [],
  );
  const selectData = useCallback((response: SidecarIrResult) => {
    if (response.fallback) {
      return { error: 'xtb not found — install with: conda install -c conda-forge xtb' };
    }
    if (!response.error && response.peaks) {
      return { data: response.peaks };
    }
    return { error: response.error ?? 'Computation failed.' };
  }, []);
  const state = useCachedStructureTask({
    viewerSmiles,
    viewerStructureStatus,
    unavailableMessage: 'IR prediction is unavailable for this structure.',
    run,
    selectData,
  });

  const headerH = 28;
  const chartH = irSize.height - headerH - 24;

  return (
    <FloatingPanel
      pos={irPos}
      size={irSize}
      minWidth={300}
      minHeight={150}
      title="IR Spectrum (GFN-FF/xtb)"
      theme={theme}
      isDarkMode={isDarkMode}
      onClose={() => setShowIrPanel(false)}
      onPosChange={setIrPos}
      onSizeChange={setIrSize}
    >
      <div style={{ flex: 1, overflow: 'hidden', padding: '8px 8px 0' }}>
        {state.status === 'idle' && (
          <div style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 20 }}>
            Draw a structure to see IR prediction.
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
        {state.status === 'success' && state.data && state.data.length === 0 && (
          <div style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 20 }}>
            No vibrational modes found.
          </div>
        )}
        {state.status === 'success' && state.data && state.data.length > 0 && (
          <IrChart
            peaks={state.data}
            isDarkMode={isDarkMode}
            width={irSize.width - 16}
            height={chartH}
          />
        )}
      </div>
    </FloatingPanel>
  );
}
