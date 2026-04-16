import { Suspense, forwardRef, lazy, useCallback, useImperativeHandle, useRef } from 'react';
import { useStore } from '../store';
import { Molecule3DHartreeFockPopup } from './Molecule3DHartreeFockPopup';
import { useHartreeFockGeometryOptimization } from '../hooks/useHartreeFockGeometryOptimization';
import { useHartreeFockOrbitals } from '../hooks/useHartreeFockOrbitals';
import { useMolecule3DData } from '../hooks/useMolecule3DData';
import { resolveViewerBackgroundColor, viewer3DFormalChargeFromMolblock } from '../lib/viewer3d';
import type { Molecule3DThreeRef } from './Molecule3DThree';
import type { Molecule3DRef } from './Molecule3DRef';
import { Molecule3DConformerStrip } from './Molecule3DConformerStrip';
import { Molecule3DViewerControls } from './Molecule3DViewerControls';

const Molecule3DThree = lazy(() =>
  import('./Molecule3DThree').then((module) => ({ default: module.Molecule3DThree })),
);

interface Props {
  smiles: string;
  width?: number;
  height?: number;
  isDarkMode?: boolean;
  hoveredAtomIdx?: number | null;
  selectedAtomIdx?: number | null;
  selectedAtomIndices?: number[];
  hoveredBondAtoms?: [number, number] | null;
  selectedBondAtoms?: Array<[number, number]>;
}

export const Molecule3DThreePanel = forwardRef<Molecule3DRef, Props>(
  (
    {
      smiles,
      width = 150,
      height = 120,
      isDarkMode = false,
      hoveredAtomIdx = null,
      selectedAtomIdx = null,
      selectedAtomIndices = [],
      hoveredBondAtoms = null,
      selectedBondAtoms = [],
    },
    ref,
  ) => {
    const innerRef = useRef<Molecule3DThreeRef>(null);

    const minimizeGeometry = useStore((store) => store.minimizeGeometry);
    const setMinimizeGeometry = useStore((store) => store.setMinimizeGeometry);
    const setRawConformer = useStore((store) => store.setRawConformer);
    const representation = useStore((store) => store.viewerRepresentation);
    const spin = useStore((store) => store.viewerSpin);
    const spinSpeed = useStore((store) => store.viewerSpinSpeed);
    const forceField = useStore((store) => store.viewerForceField);
    const multiConformer = useStore((store) => store.viewerMultiConformer);
    const maxConformers = useStore((store) => store.viewerMaxConformers);
    const showAtomNumbers = useStore((store) => store.viewerShowAtomNumbers);
    const showAtomLabels = useStore((store) => store.viewerShowAtomLabels);
    const showMeasureToolbar = useStore((store) => store.viewerShowMeasureToolbar);
    const atomScale = useStore((store) => store.viewerAtomScale);
    const bondScale = useStore((store) => store.viewerBondScale);
    const perspectiveFov = useStore((store) => store.viewerPerspectiveFov);
    const backgroundColor = useStore((store) => store.viewerBackgroundColor);
    const viewerBondColor = useStore((store) => store.viewerBondColor);
    const ambientLightIntensity = useStore((store) => store.viewerAmbientLightIntensity);
    const hemiLightIntensity = useStore((store) => store.viewerHemiLightIntensity);
    const keyLightIntensity = useStore((store) => store.viewerKeyLightIntensity);
    const fillLightIntensity = useStore((store) => store.viewerFillLightIntensity);
    const rimLightIntensity = useStore((store) => store.viewerRimLightIntensity);
    const orbitalBasis = useStore((store) => store.viewerOrbitalBasis);
    const orbitalOpacity = useStore((store) => store.viewerOrbitalOpacity);
    const orbitalPositiveColor = useStore((store) => store.viewerOrbitalPositiveColor);
    const orbitalNegativeColor = useStore((store) => store.viewerOrbitalNegativeColor);
    const orbitalMaterial = useStore((store) => store.viewerOrbitalMaterial);
    const orbitalOutline = useStore((store) => store.viewerOrbitalOutline);
    const orbitalIsovalue = useStore((store) => store.viewerOrbitalIsovalue);
    const orbitalShowPositivePhase = useStore((store) => store.viewerOrbitalShowPositivePhase);
    const orbitalShowNegativePhase = useStore((store) => store.viewerOrbitalShowNegativePhase);
    const setForceField = useStore((store) => store.setViewerForceField);
    const setMultiConformer = useStore((store) => store.setViewerMultiConformer);
    const setMaxConformers = useStore((store) => store.setViewerMaxConformers);
    const setShowAtomNumbers = useStore((store) => store.setViewerShowAtomNumbers);
    const setShowAtomLabels = useStore((store) => store.setViewerShowAtomLabels);
    const setShowMeasureToolbar = useStore((store) => store.setViewerShowMeasureToolbar);
    const setRepresentation = useStore((store) => store.setViewerRepresentation);
    const setSpin = useStore((store) => store.setViewerSpin);
    const setSpinSpeed = useStore((store) => store.setViewerSpinSpeed);
    const setAtomScale = useStore((store) => store.setViewerAtomScale);
    const setBondScale = useStore((store) => store.setViewerBondScale);
    const setPerspectiveFov = useStore((store) => store.setViewerPerspectiveFov);
    const setBackgroundColor = useStore((store) => store.setViewerBackgroundColor);
    const setViewerBondColor = useStore((store) => store.setViewerBondColor);
    const setAmbientLightIntensity = useStore((store) => store.setViewerAmbientLightIntensity);
    const setHemiLightIntensity = useStore((store) => store.setViewerHemiLightIntensity);
    const setKeyLightIntensity = useStore((store) => store.setViewerKeyLightIntensity);
    const setFillLightIntensity = useStore((store) => store.setViewerFillLightIntensity);
    const setRimLightIntensity = useStore((store) => store.setViewerRimLightIntensity);
    const setOrbitalBasis = useStore((store) => store.setViewerOrbitalBasis);
    const setOrbitalOpacity = useStore((store) => store.setViewerOrbitalOpacity);
    const setOrbitalPositiveColor = useStore((store) => store.setViewerOrbitalPositiveColor);
    const setOrbitalNegativeColor = useStore((store) => store.setViewerOrbitalNegativeColor);
    const setOrbitalMaterial = useStore((store) => store.setViewerOrbitalMaterial);
    const setOrbitalOutline = useStore((store) => store.setViewerOrbitalOutline);
    const setOrbitalIsovalue = useStore((store) => store.setViewerOrbitalIsovalue);
    const setOrbitalShowPositivePhase = useStore(
      (store) => store.setViewerOrbitalShowPositivePhase,
    );
    const setOrbitalShowNegativePhase = useStore(
      (store) => store.setViewerOrbitalShowNegativePhase,
    );
    const geometrySmiles = useStore((store) => store.viewerGeometrySmiles);
    const geometryMolblock = useStore((store) => store.viewerGeometryMolblock);
    const viewerMolblock = useStore((store) => store.viewerMolblock);
    const orbitalSourceMolblock = geometryMolblock || viewerMolblock;
    const orbitalSourceCharge = viewer3DFormalChargeFromMolblock(orbitalSourceMolblock);
    const preferSmilesGeometry = geometrySmiles.trim().length > 0;
    const isHartreeFock = forceField === 'hartree-fock';

    const { conformers, confIndex, setConfIndex, loading, error, molecule } = useMolecule3DData({
      smiles,
      geometrySmiles,
      preferSmilesGeometry,
      forceField,
      multiConformer,
      maxConformers,
    });

    const {
      orbitals,
      warnings: orbitalWarnings,
      selectedOrbitalKey,
      setSelectedOrbitalKey,
      selectedMesh,
      loading: orbitalLoading,
      error: orbitalError,
      stale: orbitalStale,
      calculate: calculateOrbitals,
    } = useHartreeFockOrbitals({
      enabled: isHartreeFock,
      smiles,
      molblock: orbitalSourceMolblock,
      molecule,
      basis: orbitalBasis,
      isovalue: orbitalIsovalue,
      charge: orbitalSourceCharge,
    });

    const {
      warnings: optimizeWarnings,
      loading: optimizeLoading,
      error: optimizeError,
      optimize: optimizeGeometry,
    } = useHartreeFockGeometryOptimization({
      enabled: isHartreeFock,
      smiles,
      molblock: orbitalSourceMolblock,
      molecule,
      basis: orbitalBasis,
      charge: orbitalSourceCharge,
    });

    const handleOptimizeGeometry = useCallback(async () => {
      const optimized = await optimizeGeometry();
      if (!optimized) return;
      setRawConformer(optimized);
    }, [optimizeGeometry, setRawConformer]);

    useImperativeHandle(ref, () => ({
      captureViewer: () => innerRef.current?.captureViewer() ?? null,
    }));

    const borderColor = isDarkMode ? '#444444' : '#cccccc';
    const effectiveBackgroundColor = resolveViewerBackgroundColor(backgroundColor, isDarkMode);
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: effectiveBackgroundColor,
          borderRadius: 4,
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <Molecule3DViewerControls
          isDarkMode={isDarkMode}
          minimizeGeometry={minimizeGeometry}
          spin={spin}
          forceField={forceField}
          multiConformer={multiConformer}
          maxConformers={maxConformers}
          showAtomNumbers={showAtomNumbers}
          showAtomLabels={showAtomLabels}
          showMeasureToolbar={showMeasureToolbar}
          representation={representation}
          spinSpeed={spinSpeed}
          atomScale={atomScale}
          bondScale={bondScale}
          perspectiveFov={perspectiveFov}
          backgroundColor={effectiveBackgroundColor}
          viewerBondColor={viewerBondColor}
          ambientLightIntensity={ambientLightIntensity}
          hemiLightIntensity={hemiLightIntensity}
          keyLightIntensity={keyLightIntensity}
          fillLightIntensity={fillLightIntensity}
          rimLightIntensity={rimLightIntensity}
          setMinimizeGeometry={setMinimizeGeometry}
          setRawConformer={setRawConformer}
          setSpin={setSpin}
          setForceField={setForceField}
          setMultiConformer={setMultiConformer}
          setMaxConformers={setMaxConformers}
          setShowAtomNumbers={setShowAtomNumbers}
          setShowAtomLabels={setShowAtomLabels}
          setShowMeasureToolbar={setShowMeasureToolbar}
          setRepresentation={setRepresentation}
          setSpinSpeed={setSpinSpeed}
          setAtomScale={setAtomScale}
          setBondScale={setBondScale}
          setPerspectiveFov={setPerspectiveFov}
          setBackgroundColor={setBackgroundColor}
          setViewerBondColor={setViewerBondColor}
          setAmbientLightIntensity={setAmbientLightIntensity}
          setHemiLightIntensity={setHemiLightIntensity}
          setKeyLightIntensity={setKeyLightIntensity}
          setFillLightIntensity={setFillLightIntensity}
          setRimLightIntensity={setRimLightIntensity}
          onRecenter={() => innerRef.current?.recenterView()}
        />

        <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
          {loading && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                color: isDarkMode ? '#fff' : '#000',
                fontSize: '11px',
                zIndex: 10,
                background: isDarkMode ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)',
                padding: '8px 16px',
                borderRadius: 6,
                border: `1px solid ${borderColor}`,
              }}
            >
              Generating...
            </div>
          )}
          {error && !loading && (
            <div
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                color: '#ff5555',
                fontSize: '11px',
                zIndex: 10,
                textAlign: 'center',
                padding: '0 10px',
                fontWeight: 'bold',
              }}
            >
              {error}
            </div>
          )}
          {orbitalLoading && molecule && !loading && (
            <div
              style={{
                position: 'absolute',
                left: 10,
                bottom: 12,
                color: isDarkMode ? '#fff' : '#000',
                fontSize: '10px',
                zIndex: 10,
                background: isDarkMode ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.88)',
                padding: '5px 8px',
                borderRadius: 5,
                border: `1px solid ${borderColor}`,
              }}
            >
              Calculating HF orbitals...
            </div>
          )}
          {optimizeLoading && molecule && !loading && !orbitalLoading && (
            <div
              style={{
                position: 'absolute',
                left: 10,
                bottom: 12,
                color: isDarkMode ? '#fff' : '#000',
                fontSize: '10px',
                zIndex: 10,
                background: isDarkMode ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.88)',
                padding: '5px 8px',
                borderRadius: 5,
                border: `1px solid ${borderColor}`,
              }}
            >
              Optimizing HF geometry...
            </div>
          )}
          {orbitalError && molecule && !loading && !orbitalLoading && (
            <div
              style={{
                position: 'absolute',
                left: 10,
                bottom: 12,
                color: '#ff5555',
                fontSize: '10px',
                zIndex: 10,
                background: isDarkMode ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.92)',
                padding: '5px 8px',
                borderRadius: 5,
                border: `1px solid ${borderColor}`,
                maxWidth: '70%',
              }}
            >
              {orbitalError}
            </div>
          )}
          {optimizeError && molecule && !loading && !optimizeLoading && !orbitalLoading && (
            <div
              style={{
                position: 'absolute',
                left: 10,
                bottom: 12,
                color: '#ff5555',
                fontSize: '10px',
                zIndex: 10,
                background: isDarkMode ? 'rgba(0,0,0,0.78)' : 'rgba(255,255,255,0.92)',
                padding: '5px 8px',
                borderRadius: 5,
                border: `1px solid ${borderColor}`,
                maxWidth: '70%',
              }}
            >
              {optimizeError}
            </div>
          )}
          <Suspense fallback={null}>
            <Molecule3DThree
              ref={innerRef}
              molecule={molecule}
              width={width}
              height={height}
              isDarkMode={isDarkMode}
              hoveredAtomIdx={hoveredAtomIdx}
              selectedAtomIdx={selectedAtomIdx}
              selectedAtomIndices={selectedAtomIndices}
              hoveredBondAtoms={hoveredBondAtoms}
              selectedBondAtoms={selectedBondAtoms}
              showAtomNumbers={showAtomNumbers}
              showAtomLabels={showAtomLabels}
              representation={representation}
              spin={spin}
              spinSpeed={spinSpeed}
              atomScale={atomScale}
              bondScale={bondScale}
              perspectiveFov={perspectiveFov}
              backgroundColor={effectiveBackgroundColor}
              bondColor={viewerBondColor}
              ambientLightIntensity={ambientLightIntensity}
              hemiLightIntensity={hemiLightIntensity}
              keyLightIntensity={keyLightIntensity}
              fillLightIntensity={fillLightIntensity}
              rimLightIntensity={rimLightIntensity}
              measureToolbarAddon={
                isHartreeFock ? (
                  <Molecule3DHartreeFockPopup
                    isDarkMode={isDarkMode}
                    disabled={!molecule}
                    orbitalBasis={orbitalBasis}
                    orbitalOpacity={orbitalOpacity}
                    orbitalPositiveColor={orbitalPositiveColor}
                    orbitalNegativeColor={orbitalNegativeColor}
                    orbitalMaterial={orbitalMaterial}
                    orbitalOutline={orbitalOutline}
                    orbitalIsovalue={orbitalIsovalue}
                    orbitalShowPositivePhase={orbitalShowPositivePhase}
                    orbitalShowNegativePhase={orbitalShowNegativePhase}
                    orbitalOptions={orbitals}
                    selectedOrbitalKey={selectedOrbitalKey}
                    orbitalLoading={orbitalLoading}
                    orbitalError={orbitalError}
                    orbitalWarnings={orbitalWarnings}
                    orbitalStale={orbitalStale}
                    optimizeLoading={optimizeLoading}
                    optimizeError={optimizeError}
                    optimizeWarnings={optimizeWarnings}
                    setOrbitalBasis={setOrbitalBasis}
                    setOrbitalOpacity={setOrbitalOpacity}
                    setOrbitalPositiveColor={setOrbitalPositiveColor}
                    setOrbitalNegativeColor={setOrbitalNegativeColor}
                    setOrbitalMaterial={setOrbitalMaterial}
                    setOrbitalOutline={setOrbitalOutline}
                    setOrbitalIsovalue={setOrbitalIsovalue}
                    setOrbitalShowPositivePhase={setOrbitalShowPositivePhase}
                    setOrbitalShowNegativePhase={setOrbitalShowNegativePhase}
                    setSelectedOrbitalKey={setSelectedOrbitalKey}
                    onCalculateOrbitals={calculateOrbitals}
                    onOptimizeGeometry={handleOptimizeGeometry}
                  />
                ) : null
              }
              orbitalMesh={selectedMesh}
              orbitalAppearance={{
                basis: orbitalBasis,
                opacity: orbitalOpacity,
                positiveColor: orbitalPositiveColor,
                negativeColor: orbitalNegativeColor,
                material: orbitalMaterial,
                outline: orbitalOutline,
                isovalue: orbitalIsovalue,
                showPositivePhase: orbitalShowPositivePhase,
                showNegativePhase: orbitalShowNegativePhase,
              }}
              showMeasureToolbar={showMeasureToolbar}
            />
          </Suspense>
        </div>

        {multiConformer && (
          <Molecule3DConformerStrip
            isDarkMode={isDarkMode}
            borderColor={borderColor}
            conformers={conformers}
            confIndex={confIndex}
            setConfIndex={setConfIndex}
          />
        )}
      </div>
    );
  },
);

export default Molecule3DThreePanel;
