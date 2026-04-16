import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../store';
import { useDebouncedValue } from '../hooks/useDebouncedValue';
import { useSmilesCache } from '../hooks/useSmilesCache';
import { FloatingPanel } from './FloatingPanel';
import type { NmrSignal, NmrSpectrum } from '../types/chemistry';
import type { PanelTheme } from '../types/panelTheme';
import { invokeTauri, listenTauri } from '../lib/tauri';

interface Props {
  theme: PanelTheme;
  isDarkMode: boolean;
  viewerSmiles: string;
}

interface SidecarNmrResult extends NmrSpectrum {
  error?: string;
  fallback?: boolean;
}

type Nucleus = '1H' | '13C';
type Method = 'hose' | 'dft';

const CHART_MARGIN = { top: 16, right: 18, bottom: 54, left: 42 };
const PPM_LIMITS: Record<Nucleus, { max: number; min: number }> = {
  '1H': { max: 12, min: 0 },
  '13C': { max: 220, min: 0 },
};
const DFT_PROGRESS_STEPS = [
  { key: 'embedding', label: 'Embedding 3D geometry' },
  { key: 'optimizing', label: 'Optimizing conformer' },
  { key: 'shielding', label: 'Running shielding calculation' },
  { key: 'scaling', label: 'Applying DELTA50 linear scaling' },
  { key: 'finishing', label: 'Finishing spectrum' },
] as const;
const MIN_WINDOW_SPAN: Record<Nucleus, number> = {
  '1H': 0.6,
  '13C': 12,
};
const DFT_SHIFT_PRESET_LABEL = 'B3LYP/cc-pVTZ';
const DFT_SHIFT_SCALING = {
  '1H': 'd = (31.6889 - s) / 1.0450',
  '13C': 'd = (181.5727 - s) / 1.0364',
} as const;

type PpmWindow = { max: number; min: number };

function formatPpm(value: number, nucleus: Nucleus) {
  return nucleus === '1H' ? value.toFixed(2) : value.toFixed(1);
}

function formatSignalLabel(signal: NmrSignal, nucleus: Nucleus) {
  if (nucleus === '13C') {
    return `${formatPpm(signal.center_ppm, nucleus)} ppm`;
  }
  const integral = signal.integral > 0 ? `, ${signal.integral}H` : '';
  const mult = signal.multiplicity ? `, ${signal.multiplicity}` : '';
  return `${formatPpm(signal.center_ppm, nucleus)} ppm${mult}${integral}`;
}

function formatAtomLabel(signal: NmrSignal) {
  return signal.atom_idxs.map((idx) => idx + 1).join(', ');
}

function formatCouplings(signal: NmrSignal) {
  if (!signal.couplings_hz.length) {
    return 'None';
  }
  return `${signal.couplings_hz.map((j) => j.toFixed(1)).join(', ')} Hz`;
}

function formatTableCouplings(signal: NmrSignal) {
  if (!signal.couplings_hz.length) {
    return '—';
  }
  return signal.couplings_hz.map((j) => j.toFixed(1)).join(', ');
}

function summarizeSource(signal: NmrSignal) {
  if (signal.source.startsWith('dft')) {
    return 'DFT';
  }
  if (signal.source.startsWith('hose-')) {
    return signal.source.replace('hose-', 'HOSE ');
  }
  return signal.source;
}

function windowRangeLabel(window: PpmWindow, nucleus: Nucleus) {
  return `${formatPpm(window.max, nucleus)}-${formatPpm(window.min, nucleus)} ppm`;
}

function signalTrace(signal: NmrSignal) {
  return signal.explanation?.filter(Boolean).slice(0, 5) ?? [];
}

function findSignalIndexByAtom(signals: NmrSignal[], atomIdx: number | null) {
  if (atomIdx === null) {
    return null;
  }
  const index = signals.findIndex((signal) => signal.atom_idxs.includes(atomIdx));
  return index >= 0 ? index : null;
}

function formatElapsedSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)} s`;
}

type DftProgressKey = (typeof DFT_PROGRESS_STEPS)[number]['key'];

type DftProgressEvent = {
  request_id: string;
  stage: DftProgressKey;
  label: string;
};

function getDftProgressSteps(
  elapsedMs: number,
  stageStartedAtMs: Partial<Record<DftProgressKey, number>>,
  activeStage: DftProgressKey | null,
) {
  const activeIndex =
    activeStage === null ? -1 : DFT_PROGRESS_STEPS.findIndex((step) => step.key === activeStage);

  return DFT_PROGRESS_STEPS.map((step, index) => {
    const startedAtMs = stageStartedAtMs[step.key];
    const completed = activeIndex > index;
    const active = activeIndex === index;
    const durationLabel =
      startedAtMs === undefined
        ? null
        : formatElapsedSeconds(
            Math.max(
              0,
              (completed
                ? (stageStartedAtMs[DFT_PROGRESS_STEPS[index + 1]?.key] ?? elapsedMs)
                : elapsedMs) - startedAtMs,
            ),
          );

    return {
      label: step.label,
      completed,
      active,
      durationLabel,
    };
  });
}

function clampWindow(nucleus: Nucleus, window: PpmWindow): PpmWindow {
  const limits = PPM_LIMITS[nucleus];
  const minSpan = MIN_WINDOW_SPAN[nucleus];
  let { max, min } = window;
  if (max - min < minSpan) {
    const center = (max + min) / 2;
    max = center + minSpan / 2;
    min = center - minSpan / 2;
  }
  if (max > limits.max) {
    const shift = max - limits.max;
    max -= shift;
    min -= shift;
  }
  if (min < limits.min) {
    const shift = limits.min - min;
    max += shift;
    min += shift;
  }
  return {
    max: Math.min(limits.max, max),
    min: Math.max(limits.min, min),
  };
}

function zoomWindow(
  nucleus: Nucleus,
  window: PpmWindow,
  factor: number,
  anchorPpm?: number,
): PpmWindow {
  const span = window.max - window.min;
  const nextSpan = span * factor;
  const limits = PPM_LIMITS[nucleus];
  if (nextSpan >= limits.max - limits.min) {
    return limits;
  }
  const anchor = anchorPpm ?? (window.max + window.min) / 2;
  const leftRatio = (window.max - anchor) / span;
  const rightRatio = (anchor - window.min) / span;
  return clampWindow(nucleus, {
    max: anchor + nextSpan * leftRatio,
    min: anchor - nextSpan * rightRatio,
  });
}

function makeTicks(window: PpmWindow, nucleus: Nucleus) {
  const count = nucleus === '1H' ? 7 : 6;
  return Array.from({ length: count }, (_, index) => {
    const ratio = index / (count - 1);
    const ppm = window.max - ratio * (window.max - window.min);
    return Number(formatPpm(ppm, nucleus));
  });
}

function pickLabels(
  signals: NmrSignal[],
  nucleus: Nucleus,
  ppmWindow: PpmWindow,
  width: number,
  activeIndex: number | null,
) {
  const { max, min } = ppmWindow;
  const ppmToX = (ppm: number) => ((max - ppm) / (max - min)) * width;
  const minGap = nucleus === '13C' ? 34 : 44;
  const preferred = signals
    .map((signal, index) => ({
      signal,
      index,
      score: (index === activeIndex ? 10000 : 0) + signal.confidence + signal.integral * 10,
    }))
    .sort((a, b) => b.score - a.score);

  const accepted: Array<{ signal: NmrSignal; index: number; x: number }> = [];
  for (const candidate of preferred) {
    if (accepted.length >= (nucleus === '13C' ? 8 : 6) && candidate.index !== activeIndex) {
      continue;
    }
    const x = ppmToX(candidate.signal.center_ppm);
    if (
      accepted.some(
        (item) =>
          Math.abs(item.x - x) < minGap &&
          item.index !== activeIndex &&
          candidate.index !== activeIndex,
      )
    ) {
      continue;
    }
    accepted.push({ signal: candidate.signal, index: candidate.index, x });
  }

  return accepted.sort((a, b) => b.signal.center_ppm - a.signal.center_ppm);
}

function SpectrumChart({
  signals,
  nucleus,
  width,
  height,
  isDarkMode,
  ppmWindow,
  hoveredSignalIndex,
  selectedSignalIndex,
  linkedSignalIndex,
  onHoverSignal,
  onSelectSignal,
}: {
  signals: NmrSignal[];
  nucleus: Nucleus;
  width: number;
  height: number;
  isDarkMode: boolean;
  ppmWindow: PpmWindow;
  hoveredSignalIndex: number | null;
  selectedSignalIndex: number | null;
  linkedSignalIndex: number | null;
  onHoverSignal: (index: number | null) => void;
  onSelectSignal: (index: number) => void;
}) {
  const chartW = width - CHART_MARGIN.left - CHART_MARGIN.right;
  const chartH = height - CHART_MARGIN.top - CHART_MARGIN.bottom;
  const { max, min } = ppmWindow;
  const ppmToX = (ppm: number) => ((max - ppm) / (max - min)) * chartW;
  const activeIndex = hoveredSignalIndex ?? selectedSignalIndex ?? linkedSignalIndex;
  const labels = useMemo(
    () => pickLabels(signals, nucleus, ppmWindow, chartW, activeIndex),
    [activeIndex, chartW, nucleus, ppmWindow, signals],
  );
  const ticks = useMemo(() => makeTicks(ppmWindow, nucleus), [nucleus, ppmWindow]);

  const palette = isDarkMode
    ? {
        bg: '#0f1520',
        panel: '#17202c',
        axis: '#45556a',
        grid: 'rgba(108, 129, 156, 0.22)',
        text: '#d7e0ec',
        trace: '#7dd3fc',
        stick: '#f8c15c',
        linked: '#a78bfa',
        active: '#34d399',
        labelBg: 'rgba(9, 14, 22, 0.92)',
      }
    : {
        bg: '#fbfdff',
        panel: '#eef5fb',
        axis: '#cad7e4',
        grid: 'rgba(103, 125, 151, 0.16)',
        text: '#415063',
        trace: '#0f5fa8',
        stick: '#b6671f',
        linked: '#7c63ff',
        active: '#18865c',
        labelBg: 'rgba(255, 255, 255, 0.94)',
      };

  return (
    <svg
      width={width}
      height={height}
      style={{ display: 'block' }}
      onMouseLeave={() => onHoverSignal(null)}
    >
      <rect width={width} height={height} rx={12} fill={palette.bg} />
      <g transform={`translate(${CHART_MARGIN.left},${CHART_MARGIN.top})`}>
        <rect width={chartW} height={chartH} rx={10} fill={palette.panel} />
        {[0.25, 0.5, 0.75].map((tick) => {
          const y = chartH * (1 - tick);
          return (
            <line
              key={tick}
              x1={0}
              y1={y}
              x2={chartW}
              y2={y}
              stroke={palette.grid}
              strokeWidth={1}
            />
          );
        })}
        <line x1={0} y1={chartH} x2={chartW} y2={chartH} stroke={palette.axis} strokeWidth={1.5} />
        <line x1={0} y1={0} x2={0} y2={chartH} stroke={palette.axis} strokeWidth={1} />

        {ticks.map((ppm) => {
          const x = ppmToX(ppm);
          return (
            <g key={ppm} transform={`translate(${x},${chartH})`}>
              <line y2={6} stroke={palette.axis} strokeWidth={1} />
              <line y1={-chartH} y2={0} stroke={palette.grid} strokeWidth={1} />
              <text y={18} textAnchor="middle" fontSize={10} fill={palette.text}>
                {ppm}
              </text>
            </g>
          );
        })}

        <text x={chartW / 2} y={chartH + 34} textAnchor="middle" fontSize={11} fill={palette.text}>
          Chemical shift (ppm)
        </text>

        {signals.map((signal, index) => {
          const mad = signal.mad ?? 0;
          if (mad > 0 && signal.source !== 'heuristic') {
            const x1 = ppmToX(signal.center_ppm + mad);
            const x2 = ppmToX(signal.center_ppm - mad);
            return (
              <rect
                key={`mad-${index}`}
                x={Math.min(x1, x2)}
                y={0}
                width={Math.abs(x2 - x1)}
                height={chartH}
                fill={palette.stick}
                fillOpacity={0.08}
                rx={2}
                style={{ pointerEvents: 'none' }}
              />
            );
          }
          return null;
        })}

        {signals.map((signal, index) => {
          const x = ppmToX(signal.center_ppm);
          const stateColor =
            index === hoveredSignalIndex || index === selectedSignalIndex
              ? palette.active
              : index === linkedSignalIndex
                ? palette.linked
                : palette.stick;
          const peakHeight = nucleus === '13C' ? chartH * 0.84 : chartH * 0.16;
          const markerY = nucleus === '13C' ? chartH - peakHeight : chartH * 0.2;

          return (
            <g
              key={`${signal.center_ppm}-${index}`}
              onMouseEnter={() => onHoverSignal(index)}
              onClick={() => onSelectSignal(index)}
              style={{ cursor: 'pointer' }}
            >
              {nucleus === '13C' && (
                <line
                  x1={x}
                  y1={chartH}
                  x2={x}
                  y2={chartH - peakHeight}
                  stroke={stateColor}
                  strokeWidth={2}
                />
              )}
              {nucleus === '1H' &&
                signal.transitions.map((transition, transitionIndex) => {
                  const tx = ppmToX(transition.ppm);
                  const tHeight = chartH - transition.intensity * chartH * 0.5;
                  return (
                    <line
                      key={`${transition.ppm}-${transitionIndex}`}
                      x1={tx}
                      y1={chartH}
                      x2={tx}
                      y2={tHeight}
                      stroke={stateColor}
                      strokeWidth={1}
                      strokeOpacity={0.7}
                    />
                  );
                })}
              <circle cx={x} cy={markerY} r={index === activeIndex ? 3.2 : 2.2} fill={stateColor} />
              <rect x={x - 8} y={0} width={16} height={chartH} fill="transparent" />
            </g>
          );
        })}

        {labels.map(({ signal, index, x }) => {
          const emphasized = index === activeIndex || index === linkedSignalIndex;
          const y = nucleus === '13C' ? 18 : 24 + (index % 2) * 16;
          const label =
            nucleus === '13C'
              ? `${formatPpm(signal.center_ppm, nucleus)}`
              : `${formatPpm(signal.center_ppm, nucleus)} ${signal.multiplicity}`;
          return (
            <g key={`label-${index}`}>
              <line
                x1={x}
                y1={chartH - (nucleus === '13C' ? chartH * 0.84 : chartH * 0.38)}
                x2={x}
                y2={y + 8}
                stroke={emphasized ? palette.active : palette.axis}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <rect
                x={Math.max(4, Math.min(chartW - 64, x - 30))}
                y={y - 11}
                width={60}
                height={16}
                rx={6}
                fill={palette.labelBg}
                stroke={emphasized ? palette.active : palette.axis}
              />
              <text x={x} y={y} textAnchor="middle" fontSize={9} fill={palette.text}>
                {label}
              </text>
            </g>
          );
        })}

        {activeIndex !== null &&
          signals[activeIndex] &&
          (() => {
            const signal = signals[activeIndex];
            const x = ppmToX(signal.center_ppm);
            const labelX = Math.max(72, Math.min(chartW - 72, x));
            const madLabel =
              signal.mad && signal.mad > 0 && signal.source !== 'heuristic'
                ? ` ±${nucleus === '1H' ? signal.mad.toFixed(2) : signal.mad.toFixed(1)}`
                : '';
            const hasThirdLine = nucleus === '1H' && signal.couplings_hz.length > 0;
            const hasFourthLine = signal.mad && signal.mad > 0 && signal.source !== 'heuristic';
            const rectH = hasThirdLine && hasFourthLine ? 66 : 52;
            return (
              <g>
                <line
                  x1={x}
                  y1={0}
                  x2={x}
                  y2={chartH}
                  stroke={palette.active}
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                />
                <rect
                  x={labelX - 70}
                  y={chartH - rectH - 10}
                  width={140}
                  height={rectH}
                  rx={10}
                  fill={palette.labelBg}
                  stroke={palette.active}
                />
                <text
                  x={labelX}
                  y={chartH - rectH + 8}
                  textAnchor="middle"
                  fontSize={10}
                  fill={palette.text}
                >
                  {formatSignalLabel(signal, nucleus)}
                  {madLabel}
                </text>
                <text
                  x={labelX}
                  y={chartH - rectH + 23}
                  textAnchor="middle"
                  fontSize={9}
                  fill={palette.text}
                >
                  Atoms {formatAtomLabel(signal)}
                </text>
                {hasThirdLine && (
                  <text
                    x={labelX}
                    y={chartH - rectH + 37}
                    textAnchor="middle"
                    fontSize={9}
                    fill={palette.text}
                  >
                    J = {formatCouplings(signal)}
                  </text>
                )}
                {hasFourthLine && (
                  <text
                    x={labelX}
                    y={chartH - rectH + (hasThirdLine ? 51 : 37)}
                    textAnchor="middle"
                    fontSize={9}
                    fill={palette.text}
                    fillOpacity={0.7}
                  >
                    {summarizeSource(signal)}, MAD ±
                    {nucleus === '1H' ? signal.mad!.toFixed(2) : signal.mad!.toFixed(1)} ppm
                  </text>
                )}
              </g>
            );
          })()}

        {!signals.length && (
          <text x={chartW / 2} y={chartH / 2} textAnchor="middle" fontSize={12} fill={palette.text}>
            No predicted signals
          </text>
        )}
      </g>
    </svg>
  );
}

export function NmrPanel({ theme, isDarkMode, viewerSmiles }: Props) {
  const {
    nmrSpectrum,
    nmrPos,
    nmrSize,
    viewerMolblock,
    viewerStructureStatus,
    viewerAtomIndexById,
    hoveredCanvasAtomId,
    setNmrSpectrum,
    setNmrPos,
    setNmrSize,
    setShowNmrPanel,
    setViewerHoveredAtomIdx,
    setViewerSelectedAtomIdx,
  } = useStore();

  const [nucleus, setNucleus] = useState<Nucleus>('1H');
  const [method, setMethod] = useState<Method>('hose');
  const [solvent, setSolvent] = useState('CDCl3');
  const [includeHeuristicJ, setIncludeHeuristicJ] = useState(false);
  const [completedRequestKey, setCompletedRequestKey] = useState('');
  const [predictionError, setPredictionError] = useState<string | null>(null);
  const [predictionElapsedMs, setPredictionElapsedMs] = useState(0);
  const [dftStageStartedAtMs, setDftStageStartedAtMs] = useState<
    Partial<Record<DftProgressKey, number>>
  >({});
  const [activeDftStage, setActiveDftStage] = useState<DftProgressKey | null>(null);
  const [hoveredSignalIndex, setHoveredSignalIndex] = useState<number | null>(null);
  const [selectedSignalIndex, setSelectedSignalIndex] = useState<number | null>(null);
  const predictionStartedAtRef = useRef<number | null>(null);
  const requestSerialRef = useRef(0);
  const activeDftRequestKeyRef = useRef<string | null>(null);
  const activeProgressRequestIdRef = useRef<string | null>(null);
  const [ppmWindows, setPpmWindows] = useState<Record<Nucleus, PpmWindow>>(() => ({
    '1H': PPM_LIMITS['1H'],
    '13C': PPM_LIMITS['13C'],
  }));

  const nmrCache = useSmilesCache<NmrSpectrum>();

  const rawStructureKey = viewerMolblock || viewerSmiles;
  const debouncedStructureKey = useDebouncedValue(rawStructureKey, 500);
  const structureKey = debouncedStructureKey;
  const requestKey = structureKey
    ? `${structureKey}::${method}::${method === 'hose' ? solvent : includeHeuristicJ ? 'heur-j' : 'shift-only'}`
    : '';
  const activeSignals = useMemo(
    () =>
      nmrSpectrum ? (nucleus === '1H' ? nmrSpectrum.signals_1h : nmrSpectrum.signals_13c) : [],
    [nmrSpectrum, nucleus],
  );
  const hoveredViewerAtomIdx = hoveredCanvasAtomId
    ? (viewerAtomIndexById[hoveredCanvasAtomId] ?? null)
    : null;
  const linkedSignalIndex = useMemo(
    () => findSignalIndexByAtom(activeSignals, hoveredViewerAtomIdx),
    [activeSignals, hoveredViewerAtomIdx],
  );
  const activeSignal =
    (hoveredSignalIndex ?? selectedSignalIndex ?? linkedSignalIndex) !== null
      ? activeSignals[(hoveredSignalIndex ?? selectedSignalIndex ?? linkedSignalIndex) as number]
      : null;
  const isPredicting = Boolean(requestKey) && completedRequestKey !== requestKey;
  const ppmWindow = ppmWindows[nucleus];

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void listenTauri<DftProgressEvent>('nmr-progress', (event) => {
      if (disposed) {
        return;
      }
      const payload = event.payload;
      if (payload.request_id !== activeProgressRequestIdRef.current) {
        return;
      }
      const startedAt =
        predictionStartedAtRef.current === null ? 0 : Date.now() - predictionStartedAtRef.current;
      setActiveDftStage(payload.stage);
      setDftStageStartedAtMs((current) =>
        current[payload.stage] === undefined ? { ...current, [payload.stage]: startedAt } : current,
      );
    }).then((fn) => {
      if (disposed) {
        void fn();
        return;
      }
      unlisten = fn;
    });

    return () => {
      disposed = true;
      if (unlisten) {
        void unlisten();
      }
    };
  }, []);

  useEffect(
    () => () => {
      if (activeDftRequestKeyRef.current) {
        activeDftRequestKeyRef.current = null;
        activeProgressRequestIdRef.current = null;
        predictionStartedAtRef.current = null;
        void invokeTauri('cancel_nmr_prediction');
      }
    },
    [],
  );

  useEffect(() => {
    if (!requestKey) {
      queueMicrotask(() => {
        if (viewerStructureStatus.kind === 'display-only') {
          setPredictionError(
            viewerStructureStatus.message ?? 'NMR prediction is unavailable for this structure.',
          );
          setNmrSpectrum(null);
          setCompletedRequestKey('');
        }
      });
      predictionStartedAtRef.current = null;
      activeProgressRequestIdRef.current = null;
      queueMicrotask(() => {
        setDftStageStartedAtMs({});
        setActiveDftStage(null);
      });
      return;
    }

    if (!viewerStructureStatus.chemistryAvailable) {
      predictionStartedAtRef.current = null;
      activeProgressRequestIdRef.current = null;
      queueMicrotask(() => {
        setPredictionError(
          viewerStructureStatus.message ?? 'NMR prediction is unavailable for this structure.',
        );
        setNmrSpectrum(null);
        setCompletedRequestKey('');
        setDftStageStartedAtMs({});
        setActiveDftStage(null);
      });
      return;
    }

    const cached = nmrCache.get(requestKey);
    if (cached) {
      queueMicrotask(() => {
        setCompletedRequestKey(requestKey);
        setNmrSpectrum(cached);
        setPredictionError(null);
      });
      return;
    }

    if (method === 'dft') {
      if (activeDftRequestKeyRef.current === requestKey) {
        return;
      }
      if (activeDftRequestKeyRef.current && activeDftRequestKeyRef.current !== requestKey) {
        return;
      }
    }

    const serial = requestSerialRef.current + 1;
    const requestId = `nmr-${serial}`;
    requestSerialRef.current = serial;
    predictionStartedAtRef.current = Date.now();
    activeProgressRequestIdRef.current = requestId;
    queueMicrotask(() => {
      setPredictionElapsedMs(0);
      setDftStageStartedAtMs({});
      setActiveDftStage(null);
    });
    if (method === 'dft') {
      activeDftRequestKeyRef.current = requestKey;
    }

    invokeTauri<SidecarNmrResult>('predict_nmr', {
      smiles: viewerSmiles || undefined,
      molblock: viewerMolblock || undefined,
      method,
      solvent: method === 'hose' ? solvent : undefined,
      includeJ: method === 'dft' ? includeHeuristicJ : undefined,
      requestId,
    })
      .then((result) => {
        if (requestSerialRef.current !== serial) {
          return;
        }
        predictionStartedAtRef.current = null;
        activeProgressRequestIdRef.current = null;
        if (activeDftRequestKeyRef.current === requestKey) {
          activeDftRequestKeyRef.current = null;
        }
        setCompletedRequestKey(requestKey);
        setHoveredSignalIndex(null);
        setSelectedSignalIndex(null);
        setViewerHoveredAtomIdx(null);
        setViewerSelectedAtomIdx(null);
        setPpmWindows({
          '1H': PPM_LIMITS['1H'],
          '13C': PPM_LIMITS['13C'],
        });
        setPredictionError(result.error ?? null);
        setActiveDftStage(null);
        if (!result.error) {
          const spectrum: NmrSpectrum = {
            signals_1h: result.signals_1h ?? [],
            signals_13c: result.signals_13c ?? [],
            dft_geometry_refinement: result.dft_geometry_refinement,
          };
          nmrCache.set(requestKey, spectrum);
          setNmrSpectrum(spectrum);
        } else {
          setNmrSpectrum(null);
        }
      })
      .catch((error) => {
        if (requestSerialRef.current !== serial) {
          return;
        }
        predictionStartedAtRef.current = null;
        activeProgressRequestIdRef.current = null;
        if (activeDftRequestKeyRef.current === requestKey) {
          activeDftRequestKeyRef.current = null;
        }
        setCompletedRequestKey(requestKey);
        setHoveredSignalIndex(null);
        setSelectedSignalIndex(null);
        setViewerHoveredAtomIdx(null);
        setViewerSelectedAtomIdx(null);
        setPpmWindows({
          '1H': PPM_LIMITS['1H'],
          '13C': PPM_LIMITS['13C'],
        });
        setPredictionError(error instanceof Error ? error.message : 'NMR prediction failed');
        setActiveDftStage(null);
        setNmrSpectrum(null);
      });
  }, [
    includeHeuristicJ,
    method,
    solvent,
    nmrCache,
    requestKey,
    setViewerHoveredAtomIdx,
    setViewerSelectedAtomIdx,
    setNmrSpectrum,
    viewerMolblock,
    viewerStructureStatus,
    viewerSmiles,
  ]);

  useEffect(() => {
    if (!isPredicting) {
      return;
    }
    const interval = window.setInterval(() => {
      if (predictionStartedAtRef.current !== null) {
        setPredictionElapsedMs(Date.now() - predictionStartedAtRef.current);
      }
    }, 200);
    return () => window.clearInterval(interval);
  }, [isPredicting]);

  useEffect(() => {
    const atomIdx =
      hoveredSignalIndex !== null
        ? (activeSignals[hoveredSignalIndex]?.atom_idxs[0] ?? null)
        : null;
    setViewerHoveredAtomIdx(atomIdx);
  }, [activeSignals, hoveredSignalIndex, setViewerHoveredAtomIdx]);

  useEffect(() => {
    const atomIdx =
      selectedSignalIndex !== null
        ? (activeSignals[selectedSignalIndex]?.atom_idxs[0] ?? null)
        : null;
    setViewerSelectedAtomIdx(atomIdx);
  }, [activeSignals, selectedSignalIndex, setViewerSelectedAtomIdx]);

  const controlBg = isDarkMode ? '#17202c' : '#f4f8fc';
  const controlBorder = isDarkMode ? '#2d3a4a' : '#d3deea';
  const textColor = isDarkMode ? '#d7e0ec' : '#425468';
  const mutedText = isDarkMode ? '#93a3b8' : '#6e8093';
  const buttonSurface = isDarkMode ? '#111927' : '#ffffff';
  const cardBg = isDarkMode ? '#111823' : '#f8fbff';
  const panelBg = isDarkMode ? '#0d131d' : theme.bg;
  const dftProgressSteps = getDftProgressSteps(
    predictionElapsedMs,
    dftStageStartedAtMs,
    activeDftStage,
  );
  const chartWidth = Math.max(540, nmrSize.width - 28);
  const chartHeight = Math.max(240, Math.min(320, nmrSize.height - 430));
  const tableSignals = activeSignals;
  const totalIntegral = activeSignals.reduce((sum, signal) => sum + signal.integral, 0);
  const selectionLocked = selectedSignalIndex !== null;
  const selectionDescriptor = activeSignal
    ? `${formatPpm(activeSignal.center_ppm, nucleus)} ppm`
    : 'None';
  const zoomDisabled =
    ppmWindow.max === PPM_LIMITS[nucleus].max && ppmWindow.min === PPM_LIMITS[nucleus].min;
  const dftGeometryLabel =
    nmrSpectrum?.dft_geometry_refinement === 'xtb'
      ? 'Geometry refined with xTB'
      : nmrSpectrum?.dft_geometry_refinement === 'mmff94s'
        ? 'Geometry optimized with MMFF94s only'
        : null;
  const dftGeometryTone =
    nmrSpectrum?.dft_geometry_refinement === 'mmff94s'
      ? {
          bg: isDarkMode ? 'rgba(191, 142, 43, 0.16)' : '#fff4d6',
          border: isDarkMode ? '#8f6f24' : '#e2c15e',
          color: isDarkMode ? '#f3d98b' : '#8a6400',
        }
      : {
          bg: isDarkMode ? 'rgba(52, 211, 153, 0.14)' : '#e8fbf3',
          border: isDarkMode ? '#1f7a5b' : '#86d6b1',
          color: isDarkMode ? '#9ae6c3' : '#1c7a57',
        };

  const updateWindow = (updater: (current: PpmWindow) => PpmWindow) => {
    setPpmWindows((current) => ({
      ...current,
      [nucleus]: clampWindow(nucleus, updater(current[nucleus])),
    }));
  };

  const nmrHeaderChildren = (
    <>
      <div style={{ fontSize: 15, fontWeight: 700, color: textColor, flexShrink: 0 }}>
        NMR Prediction
      </div>
      <div style={{ display: 'flex', gap: 10, marginLeft: 4 }}>
        {(['1H', '13C'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setNucleus(value);
            }}
            style={{
              border: 'none',
              borderBottom: nucleus === value ? '3px solid #1f8fff' : '3px solid transparent',
              background: 'transparent',
              color: nucleus === value ? '#1f8fff' : mutedText,
              fontWeight: 700,
              fontSize: 18,
              padding: '0 4px 6px',
              cursor: 'pointer',
            }}
          >
            {value === '1H' ? '¹H' : '¹³C'}
          </button>
        ))}
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        {method === 'dft' && (
          <>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                borderRadius: 999,
                border: `1px solid ${includeHeuristicJ ? '#1f8fff' : controlBorder}`,
                background: includeHeuristicJ ? '#e8f3ff' : controlBg,
                color: includeHeuristicJ ? '#1f6fd1' : textColor,
                padding: '7px 10px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={includeHeuristicJ}
                onChange={(event) => {
                  event.stopPropagation();
                  setIncludeHeuristicJ(event.target.checked);
                }}
              />
              Heuristic J
            </label>
          </>
        )}
        <div style={{ display: 'flex', gap: 6 }}>
          {(['hose', 'dft'] as const).map((value) => {
            const active = method === value;
            return (
              <button
                key={value}
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setMethod(value);
                }}
                style={{
                  borderRadius: 9,
                  border: `1px solid ${active ? '#1f8fff' : controlBorder}`,
                  background: active ? '#1f8fff' : buttonSurface,
                  color: active ? '#ffffff' : textColor,
                  fontSize: 13,
                  fontWeight: 700,
                  padding: '8px 12px',
                  cursor: 'pointer',
                }}
              >
                {value === 'hose' ? 'HOSE' : 'DFT'}
              </button>
            );
          })}
        </div>
        {method === 'hose' && (
          <div style={{ display: 'flex', gap: 4 }}>
            {(['CDCl3', 'DMSO-d6', 'D2O', 'acetone-d6', 'C6D6'] as const).map((sv) => {
              const active = solvent === sv;
              return (
                <button
                  key={sv}
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    setSolvent(sv);
                  }}
                  style={{
                    borderRadius: 7,
                    border: `1px solid ${active ? '#1f8fff' : controlBorder}`,
                    background: active ? '#1f8fff22' : 'transparent',
                    color: active ? '#1f8fff' : textColor,
                    fontSize: 11,
                    fontWeight: active ? 700 : 400,
                    padding: '4px 7px',
                    cursor: 'pointer',
                  }}
                >
                  {sv}
                </button>
              );
            })}
          </div>
        )}
        <button
          type="button"
          onClick={() => setShowNmrPanel(false)}
          style={{
            border: 'none',
            background: 'transparent',
            color: textColor,
            fontSize: 24,
            lineHeight: 1,
            cursor: 'pointer',
            padding: 0,
            width: 24,
            height: 24,
          }}
        >
          ×
        </button>
      </div>
    </>
  );

  return (
    <FloatingPanel
      pos={nmrPos}
      size={nmrSize}
      minWidth={620}
      minHeight={420}
      title=""
      theme={theme}
      isDarkMode={isDarkMode}
      zIndex={1200}
      borderRadius={12}
      background={panelBg}
      boxShadow={isDarkMode ? '0 18px 45px rgba(0,0,0,0.42)' : '0 16px 38px rgba(44,64,91,0.18)'}
      onClose={() => setShowNmrPanel(false)}
      onPosChange={setNmrPos}
      onSizeChange={setNmrSize}
      headerChildren={nmrHeaderChildren}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          color: textColor,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px 0',
            flexWrap: 'wrap',
          }}
        >
          <span
            style={{
              background: controlBg,
              border: `1px solid ${controlBorder}`,
              borderRadius: 999,
              padding: '6px 12px',
              fontWeight: 700,
              color: method === 'dft' ? '#1f8fff' : '#2f7b41',
            }}
          >
            {method === 'dft' ? `DFT shifts · ${DFT_SHIFT_PRESET_LABEL}` : 'HOSE lookup'}
          </span>
          <span
            style={{
              background: controlBg,
              border: `1px solid ${controlBorder}`,
              borderRadius: 999,
              padding: '6px 12px',
              color: mutedText,
              fontWeight: 600,
            }}
          >
            {nucleus === '1H' ? 'Proton view' : 'Carbon view'}
          </span>
          <span
            style={{
              background: controlBg,
              border: `1px solid ${controlBorder}`,
              borderRadius: 999,
              padding: '6px 12px',
              color: mutedText,
              fontWeight: 600,
            }}
          >
            Window {windowRangeLabel(ppmWindow, nucleus)}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              onClick={() => updateWindow((current) => zoomWindow(nucleus, current, 1.22))}
              style={{
                borderRadius: 999,
                border: `1px solid ${controlBorder}`,
                background: buttonSurface,
                color: textColor,
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => updateWindow((current) => zoomWindow(nucleus, current, 0.82))}
              style={{
                borderRadius: 999,
                border: `1px solid ${controlBorder}`,
                background: buttonSurface,
                color: textColor,
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              +
            </button>
            <button
              type="button"
              disabled={zoomDisabled}
              onClick={() =>
                setPpmWindows((current) => ({ ...current, [nucleus]: PPM_LIMITS[nucleus] }))
              }
              style={{
                borderRadius: 999,
                border: `1px solid ${controlBorder}`,
                background: zoomDisabled ? controlBg : buttonSurface,
                color: zoomDisabled ? mutedText : textColor,
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 700,
                cursor: zoomDisabled ? 'default' : 'pointer',
              }}
            >
              Reset Zoom
            </button>
          </div>
          {hoveredViewerAtomIdx !== null && (
            <span
              style={{
                background: controlBg,
                border: `1px solid ${controlBorder}`,
                borderRadius: 999,
                padding: '6px 12px',
                color: mutedText,
                fontWeight: 600,
              }}
            >
              Hovered atom {hoveredViewerAtomIdx + 1}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setHoveredSignalIndex(null);
              setSelectedSignalIndex(null);
              setViewerHoveredAtomIdx(null);
              setViewerSelectedAtomIdx(null);
            }}
            style={{
              marginLeft: 'auto',
              borderRadius: 999,
              border: `1px solid ${controlBorder}`,
              background: buttonSurface,
              color: textColor,
              padding: '6px 12px',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Clear Selection
          </button>
        </div>

        {isPredicting && method === 'dft' && (
          <div
            style={{
              background: controlBg,
              border: `1px solid ${controlBorder}`,
              borderRadius: 12,
              padding: 12,
              margin: '10px 14px 0',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12,
                marginBottom: 10,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 700, color: textColor }}>
                Calculation progress
              </div>
              <div style={{ fontSize: 12, color: mutedText }}>
                Elapsed {formatElapsedSeconds(predictionElapsedMs)}
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {dftProgressSteps.map((step) => (
                <div
                  key={step.label}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '18px minmax(0, 1fr) auto',
                    alignItems: 'center',
                    gap: 10,
                    color: step.completed || step.active ? textColor : mutedText,
                  }}
                >
                  <div
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      border: `1px solid ${step.completed ? '#34d399' : step.active ? '#1f8fff' : controlBorder}`,
                      background: step.completed
                        ? '#34d399'
                        : step.active
                          ? '#1f8fff'
                          : 'transparent',
                      color: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {step.completed ? '✓' : step.active ? '•' : ''}
                  </div>
                  <div style={{ fontSize: 13, fontWeight: step.active ? 700 : 500 }}>
                    {step.label}
                  </div>
                  <div style={{ fontSize: 12, color: mutedText }}>
                    {step.durationLabel ?? 'pending'}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            padding: 14,
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          <div style={{ display: 'flex', gap: 8, fontSize: 13 }}>
            <span style={{ color: mutedText }}>
              Signals: <strong style={{ color: '#1f8fff' }}>{activeSignals.length}</strong>
            </span>
            <span style={{ color: mutedText }}>·</span>
            <span style={{ color: mutedText }}>
              {nucleus === '1H' ? 'Total integral' : 'Assigned carbons'}:{' '}
              <strong style={{ color: '#34d399' }}>
                {nucleus === '1H' ? `${totalIntegral} H` : activeSignals.length}
              </strong>
            </span>
          </div>
          {method === 'dft' && dftGeometryLabel && (
            <div
              style={{
                alignSelf: 'flex-start',
                borderRadius: 999,
                border: `1px solid ${dftGeometryTone.border}`,
                background: dftGeometryTone.bg,
                color: dftGeometryTone.color,
                padding: '6px 10px',
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              {dftGeometryLabel}
            </div>
          )}
          <div
            style={{
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              flex: '0 0 auto',
            }}
          >
            <div
              style={{
                border: `1px solid ${controlBorder}`,
                borderRadius: 14,
                overflow: 'hidden',
                background: cardBg,
              }}
              onWheel={(event) => {
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const localX = Math.max(
                  CHART_MARGIN.left,
                  Math.min(rect.width - CHART_MARGIN.right, event.clientX - rect.left),
                );
                const chartW = chartWidth - CHART_MARGIN.left - CHART_MARGIN.right;
                const ratio = (localX - CHART_MARGIN.left) / chartW;
                const anchorPpm = ppmWindow.max - ratio * (ppmWindow.max - ppmWindow.min);
                updateWindow((current) =>
                  zoomWindow(nucleus, current, event.deltaY < 0 ? 0.82 : 1.22, anchorPpm),
                );
              }}
            >
              <SpectrumChart
                signals={activeSignals}
                nucleus={nucleus}
                width={chartWidth}
                height={chartHeight}
                isDarkMode={isDarkMode}
                ppmWindow={ppmWindow}
                hoveredSignalIndex={hoveredSignalIndex}
                selectedSignalIndex={selectedSignalIndex}
                linkedSignalIndex={linkedSignalIndex}
                onHoverSignal={setHoveredSignalIndex}
                onSelectSignal={setSelectedSignalIndex}
              />
            </div>

            <div
              style={{
                background: controlBg,
                border: `1px solid ${controlBorder}`,
                borderRadius: 12,
                padding: 12,
                display: 'grid',
                gap: 6,
                fontSize: 13,
                color: textColor,
              }}
            >
              <div>
                Selection: <strong>{selectionDescriptor}</strong>
                {selectionLocked ? ' locked' : activeSignal ? ' active' : ''}
              </div>
              <div>
                Hover atoms in the structure to highlight linked assignments. Hover rows or peaks to
                drive molecule highlighting.
              </div>
            </div>

            {!structureKey && (
              <div
                style={{
                  background: controlBg,
                  border: `1px solid ${controlBorder}`,
                  borderRadius: 12,
                  padding: 22,
                  textAlign: 'center',
                  color: mutedText,
                }}
              >
                Draw or select a structure to predict NMR.
              </div>
            )}

            {predictionError && !isPredicting && (
              <div
                style={{
                  background: controlBg,
                  border: `1px solid ${controlBorder}`,
                  borderRadius: 12,
                  padding: 22,
                  textAlign: 'center',
                }}
              >
                <div style={{ color: textColor, fontWeight: 700, marginBottom: 6 }}>
                  Prediction unavailable
                </div>
                <div style={{ color: mutedText }}>{predictionError}</div>
              </div>
            )}
          </div>

          <div
            style={{
              background: controlBg,
              border: `1px solid ${controlBorder}`,
              borderRadius: 12,
              display: 'flex',
              flexDirection: 'column',
              flex: '0 0 auto',
            }}
          >
            <div
              style={{
                padding: '12px 12px 8px',
                borderBottom: `1px solid ${controlBorder}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700, color: mutedText }}>
                Assignment table
              </div>
              <div style={{ fontSize: 11, color: mutedText }}>{tableSignals.length} rows</div>
            </div>
            <div
              style={{
                overflowX: 'auto',
                overflowY: 'visible',
                scrollbarGutter: 'stable both-edges',
              }}
            >
              {tableSignals.length === 0 ? (
                <div style={{ padding: 16, color: mutedText, fontSize: 13 }}>
                  No signals to show.
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: isDarkMode ? '#121a25' : '#edf4fb' }}>
                      {[
                        'Shift',
                        '±MAD',
                        'Atoms',
                        nucleus === '1H' ? 'Int.' : 'Count',
                        'Mult.',
                        'J (Hz)',
                        'Source',
                      ].map((label) => (
                        <th
                          key={label}
                          style={{
                            textAlign: 'left',
                            padding: '10px 12px',
                            color: mutedText,
                            fontSize: 11,
                            textTransform: 'uppercase',
                            letterSpacing: 0.4,
                            borderBottom: `1px solid ${controlBorder}`,
                            position: 'sticky',
                            top: 0,
                            background: isDarkMode ? '#121a25' : '#edf4fb',
                            zIndex: 1,
                          }}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableSignals.map((signal, index) => {
                      const highlighted =
                        index === hoveredSignalIndex ||
                        index === selectedSignalIndex ||
                        index === linkedSignalIndex;
                      return (
                        <tr
                          key={`row-${signal.center_ppm}-${index}`}
                          onMouseEnter={() => setHoveredSignalIndex(index)}
                          onMouseLeave={() =>
                            setHoveredSignalIndex((current) => (current === index ? null : current))
                          }
                          onClick={() => setSelectedSignalIndex(index)}
                          style={{
                            background: highlighted
                              ? isDarkMode
                                ? '#1c2735'
                                : '#eaf4ff'
                              : 'transparent',
                            cursor: 'pointer',
                          }}
                        >
                          <td
                            style={{
                              padding: '10px 12px',
                              borderBottom: `1px solid ${controlBorder}`,
                              fontWeight: 700,
                              color: textColor,
                            }}
                          >
                            {formatPpm(signal.center_ppm, nucleus)}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              borderBottom: `1px solid ${controlBorder}`,
                              color: mutedText,
                              fontSize: 12,
                            }}
                          >
                            {signal.mad && signal.mad > 0 && signal.source !== 'heuristic'
                              ? `±${nucleus === '1H' ? signal.mad.toFixed(2) : signal.mad.toFixed(1)}`
                              : '—'}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              borderBottom: `1px solid ${controlBorder}`,
                              color: textColor,
                            }}
                          >
                            {formatAtomLabel(signal)}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              borderBottom: `1px solid ${controlBorder}`,
                              color: textColor,
                            }}
                          >
                            {nucleus === '1H' ? signal.integral : signal.atom_idxs.length}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              borderBottom: `1px solid ${controlBorder}`,
                              color: textColor,
                            }}
                          >
                            {signal.multiplicity || '—'}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              borderBottom: `1px solid ${controlBorder}`,
                              color: textColor,
                            }}
                          >
                            {nucleus === '1H' ? formatTableCouplings(signal) : '—'}
                          </td>
                          <td
                            style={{
                              padding: '10px 12px',
                              borderBottom: `1px solid ${controlBorder}`,
                              color: mutedText,
                            }}
                            title={signalTrace(signal).join('\n')}
                          >
                            {summarizeSource(signal)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {method === 'dft' && (
            <div
              style={{
                background: controlBg,
                border: `1px solid ${controlBorder}`,
                borderRadius: 12,
                padding: '10px 12px',
                display: 'grid',
                gap: 4,
                fontSize: 12,
                color: mutedText,
                flex: '0 0 auto',
              }}
            >
              <div style={{ color: textColor, fontWeight: 700 }}>Level of theory</div>
              <div>Shieldings: {DFT_SHIFT_PRESET_LABEL}</div>
              <div>
                Linear scaling: 1H {DFT_SHIFT_SCALING['1H']} ; 13C {DFT_SHIFT_SCALING['13C']}
              </div>
            </div>
          )}
        </div>
      </div>
    </FloatingPanel>
  );
}
