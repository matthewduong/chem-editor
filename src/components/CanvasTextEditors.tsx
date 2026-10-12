import { type ClipboardEvent as ReactClipboardEvent } from 'react';
import { resolveAliasChemistry } from '../lib/aliasChemistry';
import { getOrientationPreviewLabel } from '../lib/atomLabelPresentation';
import { aliasResolutionMessage } from '../lib/canvasChemistry';
import { getCornerPanelX } from '../lib/canvasPanels';
import { resolveDocumentLabelTextStyle } from '../lib/chemdrawMetrics';
import { getAtomLabelBoxWidth, getAtomLabelLayoutMetrics } from '../lib/renderGeometry';
import type { EditPanelLayout } from '../types/canvas';
import type {
  ArrowType,
  Atom,
  AtomLabelOrientation,
  Bond,
  BondDisplayStyle,
  TextBox,
} from '../types/chemistry';
import { DeferredNumberInput } from './DeferredNumberInput';
import { FloatingPanel } from './FloatingPanel';
import { SelectMenu } from './SelectMenu';

interface CanvasTextEditorsProps {
  editingAtomId: string | null;
  atoms: Atom[];
  nativeNodes: Map<string, import('../types/chemdraw').ChemDrawNode>;
  documentStyleSettings: import('../types/settings').DocumentStyleSettings;
  stageScale: number;
  stagePos: { x: number; y: number };
  atomTool: import('../tools/useAtomTool').AtomToolOverlay &
    import('../tools/useAtomTool').AtomToolActions;
  isDarkMode: boolean;
  editingTextBoxId: string | null;
  textBoxes: TextBox[];
  editOverlayRef: import('react').RefObject<HTMLDivElement | null>;
  handleTextEditBlur: () => void;
  handleTextEditPaste: (event: ReactClipboardEvent<HTMLDivElement>) => void;
  ignoreNextBlurRef: import('react').RefObject<boolean>;
  setSelectedTextBoxIds: (ids: Set<string>) => void;
  editMenusHidden: boolean;
  editingAtomLabel: {
    id: string;
    value: string;
    fontFamily: string;
    fontSize: number;
    color: string;
    defaultColor: string;
    colorExplicit: boolean;
    orientation: AtomLabelOrientation;
    resolution: ReturnType<typeof resolveAliasChemistry> | null;
    selectedCandidateId?: string;
    screenX: number;
    screenY: number;
  } | null;
  atomLabelPanelLayout: EditPanelLayout | null;
  setEditMenusHidden: (hidden: boolean) => void;
  setAtomLabelPanelLayout: import('react').Dispatch<
    import('react').SetStateAction<EditPanelLayout | null>
  >;
  width: number;
  setEditingAtomLabel: import('react').Dispatch<
    import('react').SetStateAction<{
      id: string;
      value: string;
      fontFamily: string;
      fontSize: number;
      color: string;
      defaultColor: string;
      colorExplicit: boolean;
      orientation: AtomLabelOrientation;
      resolution: ReturnType<typeof resolveAliasChemistry> | null;
      selectedCandidateId?: string;
      screenX: number;
      screenY: number;
    } | null>
  >;
  commitAtomLabelEdit: () => void;
  aliasValidator:
    | ((
        fragmentSmiles: string,
      ) =>
        | { error: string; canonicalSmiles?: undefined }
        | { canonicalSmiles: string; error?: undefined })
    | undefined;
  bonds: Bond[];
  showHydrogens: boolean;
  editingArrowStyle: {
    id: string;
    type: ArrowType;
    color: string;
    lineWidth: number;
    lineStyle: 'solid' | 'dashed' | 'bold';
    curveEnabled: boolean;
  } | null;
  arrowStylePanelLayout: EditPanelLayout | null;
  setArrowStylePanelLayout: import('react').Dispatch<
    import('react').SetStateAction<EditPanelLayout | null>
  >;
  setEditingArrowStyle: import('react').Dispatch<
    import('react').SetStateAction<{
      id: string;
      type: ArrowType;
      color: string;
      lineWidth: number;
      lineStyle: 'solid' | 'dashed' | 'bold';
      curveEnabled: boolean;
    } | null>
  >;
  commitArrowStyleEdit: () => void;
  editingBondStyle: {
    id: string;
    order: number;
    color: string;
    lineWidth: number;
    display: BondDisplayStyle;
    doubleBondMode: 'auto' | 'flipped' | 'symmetric';
  } | null;
  bondStylePanelLayout: EditPanelLayout | null;
  setBondStylePanelLayout: import('react').Dispatch<
    import('react').SetStateAction<EditPanelLayout | null>
  >;
  setEditingBondStyle: import('react').Dispatch<
    import('react').SetStateAction<{
      id: string;
      order: number;
      color: string;
      lineWidth: number;
      display: BondDisplayStyle;
      doubleBondMode: 'auto' | 'flipped' | 'symmetric';
    } | null>
  >;
  reorderEditingBond: (direction: 'front' | 'back') => void;
  canBringBondToFront: boolean;
  canBringBondToBack: boolean;
  commitBondStyleEdit: () => void;
  editingArrowLabels: {
    id: string;
    above: string;
    below: string;
    fontSize: number;
    color: string;
    screenX: number;
    screenY: number;
  } | null;
  arrowLabelsPanelLayout: EditPanelLayout | null;
  setArrowLabelsPanelLayout: import('react').Dispatch<
    import('react').SetStateAction<EditPanelLayout | null>
  >;
  setEditingArrowLabels: import('react').Dispatch<
    import('react').SetStateAction<{
      id: string;
      above: string;
      below: string;
      fontSize: number;
      color: string;
      screenX: number;
      screenY: number;
    } | null>
  >;
  commitArrowLabels: () => void;
}

export function CanvasTextEditors({
  editingAtomId,
  atoms,
  nativeNodes,
  documentStyleSettings,
  stageScale,
  stagePos,
  atomTool,
  isDarkMode,
  editingTextBoxId,
  textBoxes,
  editOverlayRef,
  handleTextEditBlur,
  handleTextEditPaste,
  ignoreNextBlurRef,
  setSelectedTextBoxIds,
  editMenusHidden,
  editingAtomLabel,
  atomLabelPanelLayout,
  setEditMenusHidden,
  setAtomLabelPanelLayout,
  width,
  setEditingAtomLabel,
  commitAtomLabelEdit,
  aliasValidator,
  bonds,
  showHydrogens,
  editingArrowStyle,
  arrowStylePanelLayout,
  setArrowStylePanelLayout,
  setEditingArrowStyle,
  commitArrowStyleEdit,
  editingBondStyle,
  bondStylePanelLayout,
  setBondStylePanelLayout,
  setEditingBondStyle,
  reorderEditingBond,
  canBringBondToFront,
  canBringBondToBack,
  commitBondStyleEdit,
  editingArrowLabels,
  arrowLabelsPanelLayout,
  setArrowLabelsPanelLayout,
  setEditingArrowLabels,
  commitArrowLabels,
}: CanvasTextEditorsProps) {
  return (
    <>
      {editingAtomId &&
        (() => {
          const a = atoms.find((x) => x.id === editingAtomId);
          if (!a) return null;
          const nativeNode = nativeNodes.get(a.id);
          const { fontSize } = resolveDocumentLabelTextStyle(documentStyleSettings, {
            authored: { fontSize: a.labelFontSize },
            nativeStyle: nativeNode?.style,
          });
          const labelLayout = getAtomLabelLayoutMetrics(
            fontSize,
            getAtomLabelBoxWidth(fontSize, fontSize),
            documentStyleSettings,
          );
          const sX = a.x * stageScale + stagePos.x,
            sY = a.y * stageScale + stagePos.y;
          return (
            <input
              autoFocus
              value={atomTool.editingValue}
              onChange={(ev) => atomTool.setEditingValue(ev.target.value)}
              onFocus={(ev) => ev.target.select()}
              onKeyDown={(ev) => {
                ev.stopPropagation();
                ev.nativeEvent.stopImmediatePropagation();
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  atomTool.handleFinishEditing();
                }
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  atomTool.closeEditor();
                }
              }}
              onBlur={atomTool.handleFinishEditing}
              style={{
                position: 'absolute',
                top: sY - (labelLayout.boxHeight * stageScale) / 2,
                left: sX - (labelLayout.boxWidth * stageScale) / 2,
                width: `${Math.max(56, labelLayout.boxWidth * stageScale + 12)}px`,
                textAlign: 'center',
                border: '1px solid #2196F3',
                borderRadius: '3px',
                fontSize: `${Math.max(14, fontSize * stageScale * 0.8)}px`,
                outline: 'none',
                background: isDarkMode ? '#2d2d2d' : '#fff',
                color: isDarkMode ? '#fff' : '#000',
                zIndex: 2000,
              }}
            />
          );
        })()}

      {editingTextBoxId &&
        (() => {
          const tb = textBoxes.find((t) => t.id === editingTextBoxId);
          if (!tb) return null;
          const screenX = tb.x * stageScale + stagePos.x;
          const screenY = tb.y * stageScale + stagePos.y;
          const scaledFontSize = tb.fontSize * stageScale;
          const align = tb.textAlign ?? 'center';
          const transformX = align === 'center' ? '-50%' : align === 'right' ? '-100%' : '0%';
          const rotation = tb.rotation ?? 0;
          const overlayWidth = tb.width ? tb.width * stageScale : undefined;
          return (
            <div
              ref={editOverlayRef}
              contentEditable
              suppressContentEditableWarning
              role="textbox"
              aria-multiline="true"
              spellCheck={false}
              onFocus={() => {
                if (!editOverlayRef.current) return;
                const range = document.createRange();
                range.selectNodeContents(editOverlayRef.current);
                range.collapse(false);
                window.getSelection()?.removeAllRanges();
                window.getSelection()?.addRange(range);
              }}
              onBlur={handleTextEditBlur}
              onPaste={handleTextEditPaste}
              onKeyDown={(ev) => {
                ev.stopPropagation();
                ev.nativeEvent.stopImmediatePropagation();
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  ignoreNextBlurRef.current = false;
                  handleTextEditBlur();
                  ignoreNextBlurRef.current = true;
                  setSelectedTextBoxIds(new Set());
                }
              }}
              style={{
                position: 'absolute',
                left: screenX,
                top: screenY - 2,
                transform: `translateX(${transformX}) rotate(${rotation}deg)`,
                transformOrigin:
                  align === 'left' ? 'top left' : align === 'right' ? 'top right' : 'top center',
                minWidth: overlayWidth ?? 80,
                width: overlayWidth,
                minHeight: scaledFontSize + 4,
                fontSize: scaledFontSize,
                lineHeight: `${scaledFontSize}px`,
                fontFamily: tb.fontFamily,
                color: tb.color,
                textAlign: align,
                background: 'transparent',
                border: '1px dashed #2196F3',
                outline: 'none',
                zIndex: 2000,
                padding: '2px 4px',
                whiteSpace: tb.width ? 'pre-wrap' : 'nowrap',
                overflowWrap: tb.width ? 'anywhere' : 'normal',
                boxSizing: 'border-box' as const,
              }}
            />
          );
        })()}

      {!editMenusHidden && editingAtomLabel && atomLabelPanelLayout && (
        <FloatingPanel
          pos={atomLabelPanelLayout.pos}
          size={atomLabelPanelLayout.size}
          minWidth={220}
          minHeight={280}
          title="Atom Label"
          theme={{
            bg: '',
            sidebar: '',
            header: isDarkMode ? '#2d2d2d' : '#f6f6f6',
            text: isDarkMode ? '#fff' : '#000',
            canvas: '',
            border: '#2196F3',
          }}
          isDarkMode={isDarkMode}
          zIndex={2000}
          background={isDarkMode ? '#2d2d2d' : '#fff'}
          boxShadow="2px 4px 12px rgba(0,0,0,0.2)"
          onClose={() => setEditMenusHidden(true)}
          onPosChange={(pos) => setAtomLabelPanelLayout((prev) => (prev ? { ...prev, pos } : prev))}
          onSizeChange={(size) =>
            setAtomLabelPanelLayout((prev) => (prev ? { ...prev, size } : prev))
          }
          headerExtra={
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                const nextAlign = atomLabelPanelLayout.align === 'right' ? 'left' : 'right';
                setAtomLabelPanelLayout((prev) =>
                  prev
                    ? {
                        ...prev,
                        align: nextAlign,
                        pos: { x: getCornerPanelX(width, prev.size.width, nextAlign), y: 12 },
                      }
                    : prev,
                );
              }}
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: 13,
                lineHeight: 1,
                padding: '0 2px',
                opacity: 0.8,
              }}
              title={
                atomLabelPanelLayout.align === 'right'
                  ? 'Attach to top left'
                  : 'Attach to top right'
              }
            >
              {atomLabelPanelLayout.align === 'right' ? '⇤' : '⇥'}
            </button>
          }
        >
          <div
            onMouseDown={(ev) => {
              ev.stopPropagation();
            }}
            onClick={(ev) => {
              ev.stopPropagation();
            }}
            style={{
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            <input
              autoFocus
              value={editingAtomLabel.value}
              onChange={(ev) =>
                setEditingAtomLabel((prev) =>
                  prev ? { ...prev, value: ev.target.value, selectedCandidateId: undefined } : null,
                )
              }
              onKeyDown={(ev) => {
                ev.stopPropagation();
                ev.nativeEvent.stopImmediatePropagation();
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  commitAtomLabelEdit();
                }
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  setEditingAtomLabel(null);
                }
              }}
              style={{
                width: '100%',
                border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                borderRadius: 3,
                padding: '3px 6px',
                background: isDarkMode ? '#333' : '#fff',
                color: isDarkMode ? '#fff' : '#000',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
            {editingAtomLabel.resolution && editingAtomLabel.value.trim() && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div
                  style={{
                    fontSize: 11,
                    color:
                      editingAtomLabel.resolution.selected?.semanticKind === 'coordination' ||
                      editingAtomLabel.resolution.reason
                        ? '#ff8a65'
                        : '#888',
                  }}
                >
                  {editingAtomLabel.resolution.selected?.semanticKind === 'coordination'
                    ? 'Coordination-style ligand detected'
                    : editingAtomLabel.resolution.reason
                      ? aliasResolutionMessage(editingAtomLabel.resolution)
                      : editingAtomLabel.resolution.selected
                        ? `Resolved to ${editingAtomLabel.resolution.selected.subsSmiles ?? editingAtomLabel.resolution.selected.displayLabel}`
                        : 'Alias resolution pending'}
                </div>
                {editingAtomLabel.resolution.candidates.length > 1 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 11, color: '#888' }}>Interpretation</div>
                    {editingAtomLabel.resolution.candidates.slice(0, 4).map((candidate) => (
                      <button
                        key={candidate.id}
                        type="button"
                        onMouseDown={(ev) => {
                          ev.stopPropagation();
                        }}
                        onClick={() =>
                          setEditingAtomLabel((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  selectedCandidateId: candidate.id,
                                  resolution: resolveAliasChemistry(prev.value.trim() || 'C', {
                                    validateSmiles: aliasValidator,
                                    preferredCandidateId: candidate.id,
                                  }),
                                }
                              : null,
                          )
                        }
                        style={{
                          textAlign: 'left',
                          padding: '4px 6px',
                          background:
                            editingAtomLabel.selectedCandidateId === candidate.id
                              ? '#2196F3'
                              : isDarkMode
                                ? '#333'
                                : '#f5f5f5',
                          color:
                            editingAtomLabel.selectedCandidateId === candidate.id
                              ? '#fff'
                              : isDarkMode
                                ? '#fff'
                                : '#000',
                          border: `1px solid ${editingAtomLabel.selectedCandidateId === candidate.id ? '#2196F3' : isDarkMode ? '#555' : '#ccc'}`,
                          borderRadius: 3,
                          cursor: 'pointer',
                          fontSize: 11,
                        }}
                      >
                        {candidate.displayLabel}
                        {candidate.subsSmiles
                          ? ` -> ${candidate.subsSmiles}`
                          : ` (${candidate.semanticKind})`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div style={{ display: 'flex', gap: 6 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Font</div>
                <input
                  value={editingAtomLabel.fontFamily}
                  onChange={(ev) =>
                    setEditingAtomLabel((prev) =>
                      prev ? { ...prev, fontFamily: ev.target.value } : null,
                    )
                  }
                  onKeyDown={(ev) => {
                    ev.stopPropagation();
                    ev.nativeEvent.stopImmediatePropagation();
                  }}
                  style={{
                    width: '100%',
                    border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                    borderRadius: 3,
                    padding: '3px 6px',
                    background: isDarkMode ? '#333' : '#fff',
                    color: isDarkMode ? '#fff' : '#000',
                    fontSize: 12,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
              <div style={{ width: 54 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Size</div>
                <DeferredNumberInput
                  value={editingAtomLabel.fontSize}
                  min={6}
                  max={72}
                  step={1}
                  integer
                  onCommit={(fontSize) =>
                    setEditingAtomLabel((prev) =>
                      prev
                        ? {
                            ...prev,
                            fontSize,
                          }
                        : null,
                    )
                  }
                  onKeyDown={(ev) => {
                    ev.stopPropagation();
                    ev.nativeEvent.stopImmediatePropagation();
                  }}
                  style={{
                    width: '100%',
                    border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                    borderRadius: 3,
                    padding: '3px 6px',
                    background: isDarkMode ? '#333' : '#fff',
                    color: isDarkMode ? '#fff' : '#000',
                    fontSize: 12,
                    outline: 'none',
                    boxSizing: 'border-box',
                  }}
                />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, color: '#888' }}>Color</div>
              <input
                type="color"
                value={editingAtomLabel.color}
                onChange={(ev) =>
                  setEditingAtomLabel((prev) =>
                    prev
                      ? {
                          ...prev,
                          color: ev.target.value,
                          colorExplicit: true,
                        }
                      : null,
                  )
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 30,
                  height: 24,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: 1,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              />
              <div style={{ fontSize: 11, color: '#888' }}>Order</div>
              <div style={{ flex: 1 }}>
                {(() => {
                  const currentAtom = atoms.find((atom) => atom.id === editingAtomLabel.id);
                  const labelFirstPreview = currentAtom
                    ? getOrientationPreviewLabel(
                        currentAtom,
                        editingAtomLabel.value,
                        'label-first',
                        atoms,
                        bonds,
                        showHydrogens,
                      )
                    : 'Label first';
                  const hydrogenFirstPreview = currentAtom
                    ? getOrientationPreviewLabel(
                        currentAtom,
                        editingAtomLabel.value,
                        'hydrogen-first',
                        atoms,
                        bonds,
                        showHydrogens,
                      )
                    : 'Hydrogen first';
                  return (
                    <SelectMenu
                      value={editingAtomLabel.orientation}
                      options={[
                        { value: 'auto', label: 'Auto' },
                        { value: 'label-first', label: `Label first: ${labelFirstPreview}` },
                        {
                          value: 'hydrogen-first',
                          label: `Hydrogen first: ${hydrogenFirstPreview}`,
                        },
                      ]}
                      onChange={(orientation) =>
                        setEditingAtomLabel((prev) =>
                          prev
                            ? { ...prev, orientation: orientation as AtomLabelOrientation }
                            : null,
                        )
                      }
                      isDarkMode={isDarkMode}
                      textColor={isDarkMode ? '#fff' : '#000'}
                      borderColor={isDarkMode ? '#555' : '#ccc'}
                      backgroundColor={isDarkMode ? '#333' : '#fff'}
                      fontSize={12}
                      padding="3px 4px"
                    />
                  );
                })()}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button
                type="button"
                onClick={() => setEditMenusHidden(true)}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  background: 'transparent',
                  color: isDarkMode ? '#fff' : '#000',
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={commitAtomLabelEdit}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  background: '#2196F3',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </FloatingPanel>
      )}

      {!editMenusHidden && editingArrowStyle && arrowStylePanelLayout && (
        <FloatingPanel
          pos={arrowStylePanelLayout.pos}
          size={arrowStylePanelLayout.size}
          minWidth={210}
          minHeight={230}
          title={`Arrow · ${editingArrowStyle.type.replace(/-/g, ' ')}`}
          theme={{
            bg: '',
            sidebar: '',
            header: isDarkMode ? '#2d2d2d' : '#f6f6f6',
            text: isDarkMode ? '#fff' : '#000',
            canvas: '',
            border: '#2196F3',
          }}
          isDarkMode={isDarkMode}
          zIndex={2000}
          background={isDarkMode ? '#2d2d2d' : '#fff'}
          boxShadow="2px 4px 12px rgba(0,0,0,0.2)"
          onClose={() => setEditMenusHidden(true)}
          onPosChange={(pos) =>
            setArrowStylePanelLayout((prev) => (prev ? { ...prev, pos } : prev))
          }
          onSizeChange={(size) =>
            setArrowStylePanelLayout((prev) => (prev ? { ...prev, size } : prev))
          }
          headerExtra={
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                const nextAlign = arrowStylePanelLayout.align === 'right' ? 'left' : 'right';
                setArrowStylePanelLayout((prev) =>
                  prev
                    ? {
                        ...prev,
                        align: nextAlign,
                        pos: { x: getCornerPanelX(width, prev.size.width, nextAlign), y: 12 },
                      }
                    : prev,
                );
              }}
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: 13,
                lineHeight: 1,
                padding: '0 2px',
                opacity: 0.8,
              }}
              title={
                arrowStylePanelLayout.align === 'right'
                  ? 'Attach to top left'
                  : 'Attach to top right'
              }
            >
              {arrowStylePanelLayout.align === 'right' ? '⇤' : '⇥'}
            </button>
          }
        >
          <div
            onMouseDown={(ev) => {
              ev.stopPropagation();
            }}
            onClick={(ev) => {
              ev.stopPropagation();
            }}
            style={{
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, color: '#888' }}>Color</div>
              <input
                type="color"
                value={editingArrowStyle.color}
                onChange={(ev) =>
                  setEditingArrowStyle((prev) =>
                    prev ? { ...prev, color: ev.target.value } : null,
                  )
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 30,
                  height: 24,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: 1,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              />
              <div style={{ fontSize: 11, color: '#888' }}>Width</div>
              <DeferredNumberInput
                value={editingArrowStyle.lineWidth}
                min={1}
                max={20}
                step={0.1}
                onCommit={(lineWidth) =>
                  setEditingArrowStyle((prev) =>
                    prev
                      ? {
                          ...prev,
                          lineWidth,
                        }
                      : null,
                  )
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 52,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: '3px 6px',
                  background: isDarkMode ? '#333' : '#fff',
                  color: isDarkMode ? '#fff' : '#000',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Stroke</div>
              <SelectMenu
                value={editingArrowStyle.lineStyle}
                options={[
                  { value: 'solid', label: 'Solid' },
                  { value: 'dashed', label: 'Dashed' },
                  { value: 'bold', label: 'Bold' },
                ]}
                onChange={(lineStyle) =>
                  setEditingArrowStyle((prev) =>
                    prev ? { ...prev, lineStyle: lineStyle as 'solid' | 'dashed' | 'bold' } : null,
                  )
                }
                isDarkMode={isDarkMode}
                textColor={isDarkMode ? '#fff' : '#000'}
                borderColor={isDarkMode ? '#555' : '#ccc'}
                backgroundColor={isDarkMode ? '#333' : '#fff'}
                fontSize={12}
                padding="3px 4px"
                width="100%"
              />
            </div>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 12,
                color: isDarkMode ? '#fff' : '#000',
                cursor:
                  editingArrowStyle.type === 'curved' || editingArrowStyle.type === 'half-curved'
                    ? 'default'
                    : 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={editingArrowStyle.curveEnabled}
                disabled={
                  editingArrowStyle.type === 'curved' || editingArrowStyle.type === 'half-curved'
                }
                onChange={(ev) =>
                  setEditingArrowStyle((prev) =>
                    prev ? { ...prev, curveEnabled: ev.target.checked } : null,
                  )
                }
              />
              Bend handle
            </label>
            <div style={{ fontSize: 11, color: '#888', lineHeight: 1.35 }}>
              {editingArrowStyle.type === 'curved' || editingArrowStyle.type === 'half-curved'
                ? 'This arrow always uses the star handle.'
                : editingArrowStyle.curveEnabled
                  ? 'Drag the star handle on-canvas to bend the arrow.'
                  : 'Turn this on to bend the arrow with the star handle.'}
            </div>
            <div style={{ fontSize: 11, color: '#888', lineHeight: 1.35 }}>
              Double-click the arrow to edit labels above and below it.
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button
                type="button"
                onClick={() => setEditMenusHidden(true)}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  background: 'transparent',
                  color: isDarkMode ? '#fff' : '#000',
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={commitArrowStyleEdit}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  background: '#2196F3',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </FloatingPanel>
      )}

      {!editMenusHidden && editingBondStyle && bondStylePanelLayout && (
        <FloatingPanel
          pos={bondStylePanelLayout.pos}
          size={bondStylePanelLayout.size}
          minWidth={220}
          minHeight={280}
          title="Bond Style"
          theme={{
            bg: '',
            sidebar: '',
            header: isDarkMode ? '#2d2d2d' : '#f6f6f6',
            text: isDarkMode ? '#fff' : '#000',
            canvas: '',
            border: '#2196F3',
          }}
          isDarkMode={isDarkMode}
          zIndex={2000}
          background={isDarkMode ? '#2d2d2d' : '#fff'}
          boxShadow="2px 4px 12px rgba(0,0,0,0.2)"
          onClose={() => setEditMenusHidden(true)}
          onPosChange={(pos) => setBondStylePanelLayout((prev) => (prev ? { ...prev, pos } : prev))}
          onSizeChange={(size) =>
            setBondStylePanelLayout((prev) => (prev ? { ...prev, size } : prev))
          }
          headerExtra={
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                const nextAlign = bondStylePanelLayout.align === 'right' ? 'left' : 'right';
                setBondStylePanelLayout((prev) =>
                  prev
                    ? {
                        ...prev,
                        align: nextAlign,
                        pos: { x: getCornerPanelX(width, prev.size.width, nextAlign), y: 12 },
                      }
                    : prev,
                );
              }}
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: 13,
                lineHeight: 1,
                padding: '0 2px',
                opacity: 0.8,
              }}
              title={
                bondStylePanelLayout.align === 'right'
                  ? 'Attach to top left'
                  : 'Attach to top right'
              }
            >
              {bondStylePanelLayout.align === 'right' ? '⇤' : '⇥'}
            </button>
          }
        >
          <div
            style={{
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ fontSize: 11, color: '#888' }}>Color</div>
              <input
                type="color"
                value={editingBondStyle.color}
                onChange={(ev) =>
                  setEditingBondStyle((prev) => (prev ? { ...prev, color: ev.target.value } : null))
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 30,
                  height: 24,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: 1,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              />
              <div style={{ fontSize: 11, color: '#888' }}>Width</div>
              <DeferredNumberInput
                value={editingBondStyle.lineWidth}
                min={1}
                max={12}
                step={0.1}
                onCommit={(lineWidth) =>
                  setEditingBondStyle((prev) =>
                    prev
                      ? {
                          ...prev,
                          lineWidth,
                        }
                      : null,
                  )
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 52,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: '3px 6px',
                  background: isDarkMode ? '#333' : '#fff',
                  color: isDarkMode ? '#fff' : '#000',
                  fontSize: 12,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Display</div>
              <SelectMenu
                value={editingBondStyle.display}
                options={[
                  { value: 'solid', label: 'Solid' },
                  { value: 'dash', label: 'Dashed' },
                  { value: 'bold', label: 'Bold' },
                  { value: 'wavy', label: 'Wavy' },
                  { value: 'crossed', label: 'Crossed' },
                  { value: 'dative', label: 'Dative' },
                ]}
                onChange={(display) =>
                  setEditingBondStyle((prev) =>
                    prev ? { ...prev, display: display as BondDisplayStyle } : null,
                  )
                }
                isDarkMode={isDarkMode}
                textColor={isDarkMode ? '#fff' : '#000'}
                borderColor={isDarkMode ? '#555' : '#ccc'}
                backgroundColor={isDarkMode ? '#333' : '#fff'}
                fontSize={12}
                padding="3px 4px"
                width="100%"
              />
            </div>
            {editingBondStyle.order === 2 && (
              <div>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 2 }}>Double Bond</div>
                <SelectMenu
                  value={editingBondStyle.doubleBondMode}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'flipped', label: 'Short Line Opposite Side' },
                    { value: 'symmetric', label: 'Equal Length' },
                  ]}
                  onChange={(doubleBondMode) =>
                    setEditingBondStyle((prev) =>
                      prev
                        ? {
                            ...prev,
                            doubleBondMode: doubleBondMode as 'auto' | 'flipped' | 'symmetric',
                          }
                        : null,
                    )
                  }
                  isDarkMode={isDarkMode}
                  textColor={isDarkMode ? '#fff' : '#000'}
                  borderColor={isDarkMode ? '#555' : '#ccc'}
                  backgroundColor={isDarkMode ? '#333' : '#fff'}
                  fontSize={12}
                  padding="3px 4px"
                  width="100%"
                />
              </div>
            )}
            <div>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>Order</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => reorderEditingBond('front')}
                  disabled={!canBringBondToFront}
                  style={{
                    flex: 1,
                    padding: '4px 0',
                    background: 'transparent',
                    color: !canBringBondToFront ? '#888' : isDarkMode ? '#fff' : '#000',
                    border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                    borderRadius: 3,
                    cursor: canBringBondToFront ? 'pointer' : 'default',
                    fontSize: 12,
                    opacity: canBringBondToFront ? 1 : 0.6,
                  }}
                >
                  Bring to Front
                </button>
                <button
                  type="button"
                  onClick={() => reorderEditingBond('back')}
                  disabled={!canBringBondToBack}
                  style={{
                    flex: 1,
                    padding: '4px 0',
                    background: 'transparent',
                    color: !canBringBondToBack ? '#888' : isDarkMode ? '#fff' : '#000',
                    border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                    borderRadius: 3,
                    cursor: canBringBondToBack ? 'pointer' : 'default',
                    fontSize: 12,
                    opacity: canBringBondToBack ? 1 : 0.6,
                  }}
                >
                  Bring to Back
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
              <button
                type="button"
                onClick={() => setEditMenusHidden(true)}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  background: 'transparent',
                  color: isDarkMode ? '#fff' : '#000',
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Close
              </button>
              <button
                type="button"
                onClick={commitBondStyleEdit}
                style={{
                  flex: 1,
                  padding: '4px 0',
                  background: '#2196F3',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 3,
                  cursor: 'pointer',
                  fontSize: 12,
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </FloatingPanel>
      )}

      {!editMenusHidden && editingArrowLabels && arrowLabelsPanelLayout && (
        <FloatingPanel
          pos={arrowLabelsPanelLayout.pos}
          size={arrowLabelsPanelLayout.size}
          minWidth={176}
          minHeight={190}
          title="Arrow Labels"
          theme={{
            bg: '',
            sidebar: '',
            header: isDarkMode ? '#2d2d2d' : '#f6f6f6',
            text: isDarkMode ? '#fff' : '#000',
            canvas: '',
            border: '#2196F3',
          }}
          isDarkMode={isDarkMode}
          zIndex={2000}
          background={isDarkMode ? '#2d2d2d' : '#fff'}
          boxShadow="2px 4px 12px rgba(0,0,0,0.2)"
          onClose={() => setEditMenusHidden(true)}
          onPosChange={(pos) =>
            setArrowLabelsPanelLayout((prev) => (prev ? { ...prev, pos } : prev))
          }
          onSizeChange={(size) =>
            setArrowLabelsPanelLayout((prev) => (prev ? { ...prev, size } : prev))
          }
          headerExtra={
            <button
              type="button"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={() => {
                const nextAlign = arrowLabelsPanelLayout.align === 'right' ? 'left' : 'right';
                setArrowLabelsPanelLayout((prev) =>
                  prev
                    ? {
                        ...prev,
                        align: nextAlign,
                        pos: { x: getCornerPanelX(width, prev.size.width, nextAlign), y: 12 },
                      }
                    : prev,
                );
              }}
              style={{
                marginLeft: 'auto',
                border: 'none',
                background: 'transparent',
                color: isDarkMode ? '#fff' : '#000',
                cursor: 'pointer',
                fontSize: 13,
                lineHeight: 1,
                padding: '0 2px',
                opacity: 0.8,
              }}
              title={
                arrowLabelsPanelLayout.align === 'right'
                  ? 'Attach to top left'
                  : 'Attach to top right'
              }
            >
              {arrowLabelsPanelLayout.align === 'right' ? '⇤' : '⇥'}
            </button>
          }
        >
          <div
            style={{
              padding: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            <div style={{ fontSize: 11, color: '#888' }}>Above</div>
            <input
              autoFocus
              value={editingArrowLabels.above}
              onChange={(ev) =>
                setEditingArrowLabels((prev) => (prev ? { ...prev, above: ev.target.value } : null))
              }
              onKeyDown={(ev) => {
                ev.stopPropagation();
                ev.nativeEvent.stopImmediatePropagation();
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  commitArrowLabels();
                }
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  setEditingArrowLabels(null);
                }
              }}
              style={{
                width: 130,
                border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                borderRadius: 3,
                padding: '2px 4px',
                background: isDarkMode ? '#333' : '#fff',
                color: isDarkMode ? '#fff' : '#000',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <div style={{ fontSize: 11, color: '#888' }}>Below</div>
            <input
              value={editingArrowLabels.below}
              onChange={(ev) =>
                setEditingArrowLabels((prev) => (prev ? { ...prev, below: ev.target.value } : null))
              }
              onKeyDown={(ev) => {
                ev.stopPropagation();
                ev.nativeEvent.stopImmediatePropagation();
                if (ev.key === 'Enter') {
                  ev.preventDefault();
                  commitArrowLabels();
                }
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  setEditingArrowLabels(null);
                }
              }}
              style={{
                width: 130,
                border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                borderRadius: 3,
                padding: '2px 4px',
                background: isDarkMode ? '#333' : '#fff',
                color: isDarkMode ? '#fff' : '#000',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              <div style={{ fontSize: 11, color: '#888' }}>Size</div>
              <DeferredNumberInput
                value={editingArrowLabels.fontSize}
                min={6}
                max={72}
                step={1}
                integer
                onCommit={(fontSize) =>
                  setEditingArrowLabels((prev) =>
                    prev
                      ? {
                          ...prev,
                          fontSize,
                        }
                      : null,
                  )
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 44,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: '2px 4px',
                  background: isDarkMode ? '#333' : '#fff',
                  color: isDarkMode ? '#fff' : '#000',
                  fontSize: 12,
                  outline: 'none',
                }}
              />
              <div style={{ fontSize: 11, color: '#888' }}>Color</div>
              <input
                type="color"
                value={editingArrowLabels.color || (isDarkMode ? '#ffffff' : '#000000')}
                onChange={(ev) =>
                  setEditingArrowLabels((prev) =>
                    prev ? { ...prev, color: ev.target.value } : null,
                  )
                }
                onKeyDown={(ev) => {
                  ev.stopPropagation();
                  ev.nativeEvent.stopImmediatePropagation();
                }}
                style={{
                  width: 28,
                  height: 22,
                  border: `1px solid ${isDarkMode ? '#555' : '#ccc'}`,
                  borderRadius: 3,
                  padding: 1,
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              />
            </div>
            <button
              onClick={commitArrowLabels}
              style={{
                marginTop: 4,
                padding: '3px 0',
                background: '#2196F3',
                color: '#fff',
                border: 'none',
                borderRadius: 3,
                cursor: 'pointer',
                fontSize: 12,
              }}
            >
              OK
            </button>
          </div>
        </FloatingPanel>
      )}
    </>
  );
}
