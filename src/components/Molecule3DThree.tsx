import {
  forwardRef,
  type ReactNode,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as THREE from 'three';
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js';
import { ELEMENT_COLORS } from '../lib/elements';
import type {
  Viewer3DMeasureMode,
  Viewer3DMolecule,
  ViewerOrbitalAppearance,
  ViewerOrbitalMesh,
  ViewerRepresentation,
} from '../lib/viewer3d';
import {
  resolveViewerBackgroundColor,
  viewer3dAngle,
  viewer3dAtomRadius,
  viewer3dDihedral,
  viewer3dDistance,
  viewer3dFitDistance,
  viewer3dHasMatchingTopology,
} from '../lib/viewer3d';

interface Props {
  molecule: Viewer3DMolecule | null;
  width?: number;
  height?: number;
  isDarkMode?: boolean;
  hoveredAtomIdx?: number | null;
  selectedAtomIdx?: number | null;
  selectedAtomIndices?: number[];
  hoveredBondAtoms?: [number, number] | null;
  selectedBondAtoms?: Array<[number, number]>;
  representation?: ViewerRepresentation;
  spin?: boolean;
  spinSpeed?: number;
  showAtomNumbers?: boolean;
  showAtomLabels?: boolean;
  atomScale?: number;
  bondScale?: number;
  perspectiveFov?: number;
  backgroundColor?: string;
  bondColor?: string;
  ambientLightIntensity?: number;
  hemiLightIntensity?: number;
  keyLightIntensity?: number;
  fillLightIntensity?: number;
  rimLightIntensity?: number;
  showMeasureToolbar?: boolean;
  measureToolbarAddon?: ReactNode;
  orbitalMesh?: ViewerOrbitalMesh | null;
  orbitalAppearance?: ViewerOrbitalAppearance | null;
}

export interface Molecule3DThreeRef {
  captureViewer: () => string | null;
  recenterView: () => void;
}

interface MeasurementRecord {
  id: number;
  mode: Viewer3DMeasureMode;
  atomIndices: number[];
  label: string;
}

interface MeasurementDraft {
  mode: Viewer3DMeasureMode;
  pickedAtomIndices: number[];
  label: string | null;
}

type ThreeVector3 = InstanceType<typeof THREE.Vector3>;
type ThreeObject3D = InstanceType<typeof THREE.Object3D>;
type ThreeGroup = InstanceType<typeof THREE.Group>;
type ThreeMaterial = InstanceType<typeof THREE.Material>;
type ThreeMesh = InstanceType<typeof THREE.Mesh>;
type ThreeScene = InstanceType<typeof THREE.Scene>;
type ThreeRenderer = InstanceType<typeof THREE.WebGLRenderer>;
type ThreePerspectiveCamera = InstanceType<typeof THREE.PerspectiveCamera>;
type ThreeAmbientLight = InstanceType<typeof THREE.AmbientLight>;
type ThreeHemisphereLight = InstanceType<typeof THREE.HemisphereLight>;
type ThreeDirectionalLight = InstanceType<typeof THREE.DirectionalLight>;
type ViewerTrackballControls = InstanceType<typeof TrackballControls> & {
  dragging?: boolean;
  handleResize?: () => void;
};

type MeasurementBounds = {
  center: { x: number; y: number; z: number };
  radius: number;
};

type BoundsCarrier = ThreeGroup & {
  userData: ThreeObject3D['userData'] & { bounds?: MeasurementBounds };
};

type DisposableObject3D = ThreeObject3D & {
  geometry?: { dispose?: () => void };
  material?: ThreeMaterial | ThreeMaterial[];
};

const NEEDED_PICKS: Record<Viewer3DMeasureMode, number> = {
  none: 0,
  distance: 2,
  angle: 3,
  dihedral: 4,
};

const DEFAULT_BOND_RADIUS = 0.055;
const MEASUREMENT_COLORS: Record<Exclude<Viewer3DMeasureMode, 'none'>, string> = {
  distance: '#ff8019',
  angle: '#44e870',
  dihedral: '#33ccff',
};
const MAX_VISIBLE_MEASUREMENTS = 4;

function atomColor(element: string, isDarkMode: boolean) {
  if (element === 'H') {
    return isDarkMode ? '#f8fafc' : '#d7dee7';
  }
  return ELEMENT_COLORS[element] ?? '#9ca3af';
}

function atomNumberColor(isDarkMode: boolean) {
  return isDarkMode ? '#e2e8f0' : '#0f172a';
}

function atomRadius(element: string) {
  return viewer3dAtomRadius(element);
}

interface RepresentationProfile {
  atomMultiplier: number;
  bondMultiplier: number;
  minAtomBondRatio: number;
  atomOpacity: number;
  bondOpacity: number;
  shellMultiplier: number;
  shellOpacity: number;
  coreMultiplier: number;
}

function getRepresentationProfile(representation: ViewerRepresentation): RepresentationProfile {
  if (representation === 'spacefill') {
    return {
      atomMultiplier: 1.82,
      bondMultiplier: 0,
      minAtomBondRatio: 0,
      atomOpacity: 1,
      bondOpacity: 0,
      shellMultiplier: 1,
      shellOpacity: 0,
      coreMultiplier: 1,
    };
  }
  if (representation === 'surface') {
    return {
      atomMultiplier: 0.44,
      bondMultiplier: 0.48,
      minAtomBondRatio: 1,
      atomOpacity: 0.94,
      bondOpacity: 0.55,
      shellMultiplier: 1.72,
      shellOpacity: 0.3,
      coreMultiplier: 0.44,
    };
  }
  if (representation === 'licorice') {
    return {
      atomMultiplier: 0.48,
      bondMultiplier: 1.48,
      minAtomBondRatio: 1.18,
      atomOpacity: 1,
      bondOpacity: 1,
      shellMultiplier: 1,
      shellOpacity: 0,
      coreMultiplier: 1,
    };
  }
  return {
    atomMultiplier: 1,
    bondMultiplier: 1,
    minAtomBondRatio: 0,
    atomOpacity: 1,
    bondOpacity: 1,
    shellMultiplier: 1,
    shellOpacity: 0,
    coreMultiplier: 1,
  };
}

function getAtomVisualRadius(
  element: string,
  representation: ViewerRepresentation,
  atomScale: number,
  bondRadius: number,
  profile: RepresentationProfile,
) {
  const baseRadius = atomRadius(element) * atomScale * profile.atomMultiplier;
  if (representation === 'licorice' || representation === 'surface') {
    return Math.max(baseRadius, bondRadius * profile.minAtomBondRatio);
  }
  return baseRadius;
}

function getAtomFitRadius(
  element: string,
  representation: ViewerRepresentation,
  atomScale: number,
  bondRadius: number,
  profile: RepresentationProfile,
) {
  const coreRadius = getAtomVisualRadius(element, representation, atomScale, bondRadius, profile);
  if (representation !== 'surface') return coreRadius;
  return Math.max(coreRadius, atomRadius(element) * atomScale * profile.shellMultiplier);
}

function getBondAnchorRadius(
  element: string,
  representation: ViewerRepresentation,
  atomScale: number,
  bondRadius: number,
  profile: RepresentationProfile,
) {
  if (representation === 'surface') {
    return Math.max(atomRadius(element) * atomScale * 0.58, bondRadius * 1.15);
  }
  return getAtomVisualRadius(element, representation, atomScale, bondRadius, profile);
}

function computeMoleculeVisualBounds(
  molecule: Viewer3DMolecule,
  representation: ViewerRepresentation,
  atomScale: number,
  bondRadius: number,
  profile: RepresentationProfile,
) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const atom of molecule.atoms) {
    const radius = getAtomFitRadius(atom.element, representation, atomScale, bondRadius, profile);
    min.x = Math.min(min.x, atom.x - radius);
    min.y = Math.min(min.y, atom.y - radius);
    min.z = Math.min(min.z, atom.z - radius);
    max.x = Math.max(max.x, atom.x + radius);
    max.y = Math.max(max.y, atom.y + radius);
    max.z = Math.max(max.z, atom.z + radius);
  }
  const center = {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
    z: (min.z + max.z) / 2,
  };
  let radius = 0;
  for (const atom of molecule.atoms) {
    const fitRadius = getAtomFitRadius(
      atom.element,
      representation,
      atomScale,
      bondRadius,
      profile,
    );
    radius = Math.max(radius, viewer3dDistance(atom, center) + fitRadius);
  }
  return {
    center,
    radius: Math.max(radius, 1),
  };
}

function updateDirectionalLightRig(
  camera: ThreePerspectiveCamera,
  target: ThreeVector3,
  targetObject: ThreeObject3D,
  keyLight: ThreeDirectionalLight | null,
  fillLight: ThreeDirectionalLight | null,
  rimLight: ThreeDirectionalLight | null,
) {
  const viewOffset = camera.position.clone().sub(target);
  const viewDistance = Math.max(viewOffset.length(), 6);
  const viewDirection =
    viewOffset.lengthSq() > 1e-8 ? viewOffset.normalize() : new THREE.Vector3(0, 0, 1);
  let right = new THREE.Vector3().crossVectors(camera.up, viewDirection);
  if (right.lengthSq() <= 1e-8) right = new THREE.Vector3(1, 0, 0);
  right.normalize();
  const up = new THREE.Vector3().crossVectors(viewDirection, right).normalize();

  targetObject.position.copy(target);
  targetObject.updateMatrixWorld();
  keyLight?.position
    .copy(target)
    .addScaledVector(viewDirection, viewDistance * 0.92)
    .addScaledVector(right, viewDistance * 0.38)
    .addScaledVector(up, viewDistance * 0.52);
  fillLight?.position
    .copy(target)
    .addScaledVector(viewDirection, viewDistance * 0.74)
    .addScaledVector(right, -viewDistance * 0.48)
    .addScaledVector(up, viewDistance * 0.14);
  rimLight?.position
    .copy(target)
    .addScaledVector(viewDirection, -viewDistance * 0.28)
    .addScaledVector(right, -viewDistance * 0.26)
    .addScaledVector(up, viewDistance * 0.36);
  keyLight?.target.updateMatrixWorld();
  fillLight?.target.updateMatrixWorld();
  rimLight?.target.updateMatrixWorld();
}

function buildMeasurementLabel(
  mode: Viewer3DMeasureMode,
  atomIndices: number[],
  molecule: Viewer3DMolecule,
) {
  const serials = atomIndices.map((index) => {
    const atom = molecule.atoms[index];
    return atom ? index + 1 : '?';
  });
  if (mode === 'distance' && atomIndices.length >= 2) {
    const [a, b] = atomIndices.map((index) => molecule.atoms[index]);
    return `d(${serials[0]},${serials[1]}): ${viewer3dDistance(a, b).toFixed(3)} Å`;
  }
  if (mode === 'angle' && atomIndices.length >= 3) {
    const [a, b, c] = atomIndices.map((index) => molecule.atoms[index]);
    return `∠(${serials[0]},${serials[1]},${serials[2]}): ${viewer3dAngle(a, b, c).toFixed(2)}°`;
  }
  if (mode === 'dihedral' && atomIndices.length >= 4) {
    const [a, b, c, d] = atomIndices.map((index) => molecule.atoms[index]);
    return `⟁(${serials[0]},${serials[1]},${serials[2]},${serials[3]}): ${viewer3dDihedral(a, b, c, d).toFixed(2)}°`;
  }
  return null;
}

function clearGroup(group: ThreeGroup) {
  while (group.children.length > 0) {
    const child = group.children[group.children.length - 1];
    if (!child) break;
    group.remove(child);
    const mesh = child as DisposableObject3D;
    mesh.geometry?.dispose?.();
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach((material: ThreeMaterial) => material.dispose());
    } else {
      mesh.material?.dispose?.();
    }
  }
}

function buildOrbitalSurfaceObjects(
  positions: number[],
  colorHex: string,
  appearance: ViewerOrbitalAppearance,
  isDarkMode: boolean,
) {
  if (positions.length < 9) return [];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();

  const color = new THREE.Color(colorHex);
  const fillOpacity =
    appearance.material === 'wireframe-overlay'
      ? appearance.opacity * 0.42
      : appearance.material === 'glassy'
        ? Math.min(0.92, appearance.opacity * 0.88)
        : appearance.opacity;
  const material = new THREE.MeshPhongMaterial({
    color,
    transparent: true,
    opacity: fillOpacity,
    side: THREE.DoubleSide,
    shininess: appearance.material === 'glassy' ? 68 : appearance.material === 'solid' ? 24 : 12,
    specular: new THREE.Color(appearance.material === 'glassy' ? '#e2e8f0' : '#94a3b8'),
    emissive: color.clone(),
    emissiveIntensity: appearance.material === 'glassy' ? 0.14 : isDarkMode ? 0.1 : 0.05,
    depthWrite: false,
    depthTest: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 6;
  const objects: ThreeObject3D[] = [mesh];

  if (appearance.material === 'wireframe-overlay') {
    const wireframe = new THREE.LineSegments(
      new THREE.WireframeGeometry(geometry),
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: Math.min(1, appearance.opacity * 0.9),
        depthTest: false,
      }),
    );
    wireframe.renderOrder = 7;
    objects.push(wireframe);
  }

  if (appearance.outline) {
    const outlineColor = isDarkMode ? '#f8fafc' : '#0f172a';
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(geometry, 28),
      new THREE.LineBasicMaterial({
        color: new THREE.Color(outlineColor),
        transparent: true,
        opacity: Math.min(0.78, appearance.opacity * 0.78),
        depthTest: false,
      }),
    );
    edges.renderOrder = 8;
    objects.push(edges);
  }

  return objects;
}

function traceRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + clampedRadius, y);
  ctx.lineTo(x + width - clampedRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
  ctx.lineTo(x + width, y + height - clampedRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height);
  ctx.lineTo(x + clampedRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
  ctx.lineTo(x, y + clampedRadius);
  ctx.quadraticCurveTo(x, y, x + clampedRadius, y);
  ctx.closePath();
}

function getBondOffsetVector(start: ThreeVector3, end: ThreeVector3) {
  const direction = new THREE.Vector3().subVectors(end, start).normalize();
  let offset = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0));
  if (offset.lengthSq() < 1e-5) {
    offset = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(1, 0, 0));
  }
  return offset.normalize();
}

function getBondPlaneOffsetVector(
  molecule: Viewer3DMolecule,
  bond: Viewer3DMolecule['bonds'][number],
  start: ThreeVector3,
  end: ThreeVector3,
) {
  const axis = new THREE.Vector3().subVectors(end, start).normalize();
  const normals: ThreeVector3[] = [];

  const collectNormals = (atomIndex: number, excludeIndex: number) => {
    for (const candidate of molecule.bonds) {
      const neighborIndex =
        candidate.a1 === atomIndex ? candidate.a2 : candidate.a2 === atomIndex ? candidate.a1 : -1;
      if (neighborIndex < 0 || neighborIndex === excludeIndex) continue;
      const atom = molecule.atoms[atomIndex];
      const neighbor = molecule.atoms[neighborIndex];
      if (!atom || !neighbor) continue;
      const vector = new THREE.Vector3(
        neighbor.x - atom.x,
        neighbor.y - atom.y,
        neighbor.z - atom.z,
      );
      const projected = vector.clone().sub(axis.clone().multiplyScalar(vector.dot(axis)));
      if (projected.lengthSq() < 1e-5) continue;
      const normal = new THREE.Vector3().crossVectors(axis, projected).normalize();
      if (normal.lengthSq() > 1e-5) normals.push(normal);
    }
  };

  collectNormals(bond.a1, bond.a2);
  collectNormals(bond.a2, bond.a1);

  if (normals.length === 0) {
    return getBondOffsetVector(start, end);
  }

  const reference = normals[0];
  const planeNormal = normals.reduce((sum, normal) => {
    const aligned = normal.dot(reference) < 0 ? normal.clone().multiplyScalar(-1) : normal;
    return sum.add(aligned);
  }, new THREE.Vector3());

  if (planeNormal.lengthSq() < 1e-5) {
    return getBondOffsetVector(start, end);
  }

  const offset = new THREE.Vector3().crossVectors(planeNormal.normalize(), axis);
  return offset.lengthSq() < 1e-5 ? getBondOffsetVector(start, end) : offset.normalize();
}

function buildCylinder(
  start: ThreeVector3,
  end: ThreeVector3,
  radius: number,
  color: string,
  opacity = 1,
) {
  const direction = new THREE.Vector3().subVectors(end, start);
  const length = direction.length();
  if (length <= 1e-6) return null;
  const cylinder = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, length, 20),
    new THREE.MeshPhongMaterial({
      color: new THREE.Color(color),
      shininess: 18,
      specular: new THREE.Color('#7b8794'),
      flatShading: false,
      transparent: opacity < 1,
      opacity,
    }),
  );
  cylinder.position.copy(start).add(end).multiplyScalar(0.5);
  cylinder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  return cylinder;
}

function buildBondHatch(
  start: ThreeVector3,
  end: ThreeVector3,
  radius: number,
  colorHex: string,
  opacity: number,
) {
  const axis = new THREE.Vector3().subVectors(end, start);
  const length = axis.length();
  if (length <= 1e-6) return null;

  const direction = axis.clone().normalize();
  const baseNormal = getBondOffsetVector(start, end);
  const baseBinormal = new THREE.Vector3().crossVectors(direction, baseNormal).normalize();
  const center = start.clone().add(end).multiplyScalar(0.5);
  const group = new THREE.Group();
  const turns = 4.2;
  const steps = 42;
  const strandCount = 6;

  const addStrandSet = (handedness: 1 | -1) => {
    for (let strand = 0; strand < strandCount; strand += 1) {
      const phase = (strand / strandCount) * Math.PI * 2;
      const points: ThreeVector3[] = [];
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const axialOffset = (t - 0.5) * length;
        const theta = phase + Math.PI * 2 * turns * t * handedness;
        const radial = baseNormal
          .clone()
          .multiplyScalar(Math.cos(theta) * radius)
          .add(baseBinormal.clone().multiplyScalar(Math.sin(theta) * radius));
        points.push(center.clone().add(direction.clone().multiplyScalar(axialOffset)).add(radial));
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: new THREE.Color(colorHex),
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );
      group.add(line);
    }
  };

  addStrandSet(1);
  addStrandSet(-1);
  return group;
}

function buildBondSegments(
  molecule: Viewer3DMolecule,
  bond: Viewer3DMolecule['bonds'][number],
  start: ThreeVector3,
  end: ThreeVector3,
  order: number,
  startRadius: number,
  endRadius: number,
  bondRadius: number,
  doubleBondSpacing: number,
  tripleBondSpacing: number,
) {
  const axis = new THREE.Vector3().subVectors(end, start).normalize();
  const insetScale = order >= 3 ? 0.68 : order === 2 ? 0.8 : 0.92;
  const startAtom = molecule.atoms[bond.a1];
  const endAtom = molecule.atoms[bond.a2];
  const startInsetScale = startAtom?.element === 'H' ? 0.56 : insetScale;
  const endInsetScale = endAtom?.element === 'H' ? 0.56 : insetScale;
  const clippedStart = start
    .clone()
    .addScaledVector(axis, Math.max(startRadius * startInsetScale, bondRadius));
  const clippedEnd = end
    .clone()
    .addScaledVector(axis, -Math.max(endRadius * endInsetScale, bondRadius));
  if (clippedStart.distanceTo(clippedEnd) <= 1e-6) return [];
  if (order <= 1) return [{ start: clippedStart, end: clippedEnd }];
  const primaryOffset = getBondPlaneOffsetVector(molecule, bond, start, end);
  if (order === 2) {
    const offset = primaryOffset.multiplyScalar(doubleBondSpacing);
    return [
      { start: clippedStart.clone().add(offset), end: clippedEnd.clone().add(offset) },
      {
        start: clippedStart.clone().addScaledVector(offset, -1),
        end: clippedEnd.clone().addScaledVector(offset, -1),
      },
    ];
  }
  const secondaryOffset = new THREE.Vector3().crossVectors(axis, primaryOffset).normalize();
  const radialOffset = tripleBondSpacing * 0.92;
  return [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3].map((angle) => {
    const offset = primaryOffset
      .clone()
      .multiplyScalar(Math.cos(angle) * radialOffset)
      .add(secondaryOffset.clone().multiplyScalar(Math.sin(angle) * radialOffset));
    return {
      start: clippedStart.clone().add(offset),
      end: clippedEnd.clone().add(offset),
    };
  });
}

function createAtomBadgeSprite(label: string, isDarkMode: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 192;
  canvas.height = 84;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = isDarkMode ? 'rgba(15,23,42,0.78)' : 'rgba(255,255,255,0.86)';
  ctx.strokeStyle = isDarkMode ? 'rgba(148,163,184,0.5)' : 'rgba(51,65,85,0.18)';
  ctx.lineWidth = 2;
  ctx.font = 'bold 28px sans-serif';
  const textWidth = ctx.measureText(label).width;
  const boxWidth = Math.max(68, Math.min(156, textWidth + 34));
  const boxX = (canvas.width - boxWidth) / 2;
  traceRoundedRectPath(ctx, boxX, 16, boxWidth, 48, 12);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = atomNumberColor(isDarkMode);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, canvas.width / 2, 42);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(Math.max(0.62, Math.min(1, boxWidth / 150)), 0.4, 1);
  return sprite;
}

function addAtomHighlight(
  group: ThreeGroup,
  atom: { x: number; y: number; z: number; element: string },
  colorHex: string,
  atomScale: number,
  variant: 'hover' | 'measure' = 'hover',
) {
  const radius = atomRadius(atom.element) * atomScale;
  const color = new THREE.Color(colorHex);
  const aura = new THREE.Mesh(
    new THREE.SphereGeometry(radius * (variant === 'measure' ? 1.28 : 1.32), 30, 22),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: variant === 'measure' ? 0.2 : 0.24,
      depthWrite: false,
      side: THREE.BackSide,
    }),
  );
  aura.position.set(atom.x, atom.y, atom.z);
  group.add(aura);

  const ring = new THREE.Mesh(
    new THREE.SphereGeometry(radius * (variant === 'measure' ? 1.12 : 1.14), 22, 18),
    new THREE.MeshBasicMaterial({
      color,
      wireframe: true,
      transparent: true,
      opacity: variant === 'measure' ? 0.82 : 0.9,
      depthWrite: false,
    }),
  );
  ring.position.set(atom.x, atom.y, atom.z);
  group.add(ring);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(radius * 1.03, 26, 20),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: variant === 'measure' ? 0.08 : 0.1,
      depthWrite: false,
    }),
  );
  core.position.set(atom.x, atom.y, atom.z);
  group.add(core);
}

function addBondHighlight(
  group: ThreeGroup,
  molecule: Viewer3DMolecule,
  bond: Viewer3DMolecule['bonds'][number],
  colorHex: string,
  atomScale: number,
  bondRadius: number,
  doubleBondSpacing: number,
  tripleBondSpacing: number,
  variant: 'hover' | 'measure' = 'hover',
) {
  const start = molecule.atoms[bond.a1];
  const end = molecule.atoms[bond.a2];
  if (!start || !end) return;
  const startVec = new THREE.Vector3(start.x, start.y, start.z);
  const endVec = new THREE.Vector3(end.x, end.y, end.z);
  const startRadius = atomRadius(start.element) * atomScale;
  const endRadius = atomRadius(end.element) * atomScale;
  const segments = buildBondSegments(
    molecule,
    bond,
    startVec,
    endVec,
    Math.max(1, Math.round(bond.order)),
    startRadius,
    endRadius,
    bondRadius,
    doubleBondSpacing,
    tripleBondSpacing,
  );
  const hatchOpacity = variant === 'measure' ? 0.62 : 0.78;

  for (const segment of segments) {
    const hatch = buildBondHatch(
      segment.start,
      segment.end,
      bondRadius * (variant === 'measure' ? 1.4 : 1.52),
      colorHex,
      hatchOpacity,
    );
    if (hatch) {
      group.add(hatch);
    }
  }
}

function findBondBetweenAtoms(molecule: Viewer3DMolecule, a1: number, a2: number) {
  return (
    molecule.bonds.find(
      (bond) => (bond.a1 === a1 && bond.a2 === a2) || (bond.a1 === a2 && bond.a2 === a1),
    ) ?? null
  );
}

function addDistanceHighlight(
  group: ThreeGroup,
  molecule: Viewer3DMolecule,
  startIndex: number,
  endIndex: number,
  colorHex: string,
  atomScale: number,
  bondRadius: number,
  doubleBondSpacing: number,
  tripleBondSpacing: number,
) {
  const bond = findBondBetweenAtoms(molecule, startIndex, endIndex);
  if (bond) {
    addBondHighlight(
      group,
      molecule,
      bond,
      colorHex,
      atomScale,
      bondRadius,
      doubleBondSpacing,
      tripleBondSpacing,
      'measure',
    );
    return;
  }

  const start = molecule.atoms[startIndex];
  const end = molecule.atoms[endIndex];
  if (!start || !end) return;
  const startVec = new THREE.Vector3(start.x, start.y, start.z);
  const endVec = new THREE.Vector3(end.x, end.y, end.z);
  const axis = new THREE.Vector3().subVectors(endVec, startVec).normalize();
  const startInset = Math.max(atomRadius(start.element) * atomScale * 1.02, bondRadius);
  const endInset = Math.max(atomRadius(end.element) * atomScale * 1.02, bondRadius);
  const clippedStart = startVec.clone().addScaledVector(axis, startInset);
  const clippedEnd = endVec.clone().addScaledVector(axis, -endInset);
  if (clippedStart.distanceTo(clippedEnd) <= 1e-6) return;

  const hatch = buildBondHatch(clippedStart, clippedEnd, bondRadius * 1.4, colorHex, 0.62);
  if (hatch) group.add(hatch);
}

function buildArcHatch(
  vertex: ThreeVector3,
  startDirection: ThreeVector3,
  planeNormal: ThreeVector3,
  angle: number,
  radius: number,
  hatchRadius: number,
  colorHex: string,
  opacity: number,
) {
  if (angle <= 1e-6 || radius <= 1e-6) return null;
  const group = new THREE.Group();
  const normal = planeNormal.clone().normalize();
  const startDir = startDirection.clone().normalize();
  const turns = 4.2;
  const steps = 56;
  const strandCount = 6;

  const addStrandSet = (handedness: 1 | -1) => {
    for (let strand = 0; strand < strandCount; strand += 1) {
      const phase = (strand / strandCount) * Math.PI * 2;
      const points: ThreeVector3[] = [];
      for (let i = 0; i <= steps; i += 1) {
        const t = i / steps;
        const radialDir = startDir
          .clone()
          .applyAxisAngle(normal, angle * t)
          .normalize();
        const tangent = normal.clone().cross(radialDir).normalize();
        const center = vertex.clone().add(radialDir.clone().multiplyScalar(radius));
        const theta = phase + Math.PI * 2 * turns * t * handedness;
        const offset = normal
          .clone()
          .multiplyScalar(Math.cos(theta) * hatchRadius)
          .add(radialDir.clone().multiplyScalar(Math.sin(theta) * hatchRadius));
        points.push(center.add(offset));
        if (tangent.lengthSq() < 1e-6) break;
      }
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: new THREE.Color(colorHex),
          transparent: true,
          opacity,
          depthWrite: false,
        }),
      );
      group.add(line);
    }
  };

  addStrandSet(1);
  addStrandSet(-1);
  return group;
}

function addAngleHighlight(
  group: ThreeGroup,
  molecule: Viewer3DMolecule,
  aIndex: number,
  bIndex: number,
  cIndex: number,
  colorHex: string,
  atomScale: number,
  bondRadius: number,
) {
  const a = molecule.atoms[aIndex];
  const b = molecule.atoms[bIndex];
  const c = molecule.atoms[cIndex];
  if (!a || !b || !c) return;

  const vertex = new THREE.Vector3(b.x, b.y, b.z);
  const armA = new THREE.Vector3(a.x - b.x, a.y - b.y, a.z - b.z);
  const armC = new THREE.Vector3(c.x - b.x, c.y - b.y, c.z - b.z);
  const lenA = armA.length();
  const lenC = armC.length();
  if (lenA <= 1e-6 || lenC <= 1e-6) return;

  const dirA = armA.clone().normalize();
  const dirC = armC.clone().normalize();
  const dot = THREE.MathUtils.clamp(dirA.dot(dirC), -1, 1);
  const angle = Math.acos(dot);
  if (angle <= 1e-3 || Math.abs(Math.PI - angle) <= 1e-3) return;

  let normal = new THREE.Vector3().crossVectors(dirA, dirC);
  if (normal.lengthSq() < 1e-6) {
    normal = getBondOffsetVector(vertex, vertex.clone().add(dirA));
  } else {
    normal.normalize();
  }

  const tangentA = normal.clone().cross(dirA).normalize();
  const radius = THREE.MathUtils.clamp(
    Math.min(lenA, lenC) * 0.36,
    Math.max(atomRadius(b.element) * atomScale * 1.6, bondRadius * 4),
    Math.min(lenA, lenC) * 0.72,
  );
  const hatchRadius = bondRadius * 0.42;
  const arc = buildArcHatch(vertex, dirA, normal, angle, radius, hatchRadius, colorHex, 0.78);
  if (arc) group.add(arc);

  const startConnector = buildCylinder(
    vertex.clone().add(dirA.clone().multiplyScalar(atomRadius(b.element) * atomScale * 1.05)),
    vertex
      .clone()
      .add(dirA.clone().multiplyScalar(radius))
      .add(tangentA.clone().multiplyScalar(hatchRadius * 0.35)),
    bondRadius * 0.3,
    colorHex,
    0.32,
  );
  if (startConnector) group.add(startConnector);

  const tangentC = normal.clone().cross(dirC).normalize();
  const endConnector = buildCylinder(
    vertex.clone().add(dirC.clone().multiplyScalar(atomRadius(b.element) * atomScale * 1.05)),
    vertex
      .clone()
      .add(dirC.clone().multiplyScalar(radius))
      .add(tangentC.clone().multiplyScalar(-hatchRadius * 0.35)),
    bondRadius * 0.3,
    colorHex,
    0.32,
  );
  if (endConnector) group.add(endConnector);
}

export const Molecule3DThree = forwardRef<Molecule3DThreeRef, Props>(
  (
    {
      molecule,
      width = 150,
      height = 120,
      isDarkMode = false,
      hoveredAtomIdx = null,
      selectedAtomIdx = null,
      selectedAtomIndices = [],
      hoveredBondAtoms = null,
      selectedBondAtoms = [],
      representation = 'ball+stick',
      spin = false,
      spinSpeed = 0.6,
      showAtomNumbers = false,
      showAtomLabels = false,
      atomScale = 1,
      bondScale = 1,
      perspectiveFov = 28,
      backgroundColor,
      bondColor: customBondColor,
      ambientLightIntensity = 1,
      hemiLightIntensity = 0.72,
      keyLightIntensity = 1.15,
      fillLightIntensity = 0.58,
      rimLightIntensity = 0.36,
      showMeasureToolbar = true,
      measureToolbarAddon = null,
      orbitalMesh = null,
      orbitalAppearance = null,
    },
    ref,
  ) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<ThreeRenderer | null>(null);
    const sceneRef = useRef<ThreeScene | null>(null);
    const cameraRef = useRef<ThreePerspectiveCamera | null>(null);
    const controlsRef = useRef<ViewerTrackballControls | null>(null);
    const ambientLightRef = useRef<ThreeAmbientLight | null>(null);
    const hemiLightRef = useRef<ThreeHemisphereLight | null>(null);
    const keyLightRef = useRef<ThreeDirectionalLight | null>(null);
    const fillLightRef = useRef<ThreeDirectionalLight | null>(null);
    const rimLightRef = useRef<ThreeDirectionalLight | null>(null);
    const lightTargetRef = useRef<ThreeObject3D | null>(null);
    const moleculeGroupRef = useRef<ThreeGroup | null>(null);
    const highlightGroupRef = useRef<ThreeGroup | null>(null);
    const numberGroupRef = useRef<ThreeGroup | null>(null);
    const orbitalGroupRef = useRef<ThreeGroup | null>(null);
    const measurementGroupRef = useRef<ThreeGroup | null>(null);
    const draftGroupRef = useRef<ThreeGroup | null>(null);
    const raycasterRef = useRef(new THREE.Raycaster());
    const pointerRef = useRef(new THREE.Vector2());
    const atomMeshesRef = useRef<ThreeMesh[]>([]);
    const bondMeshesRef = useRef<ThreeMesh[]>([]);
    const previousMoleculeRef = useRef<Viewer3DMolecule | null>(null);
    const [measureMode, setMeasureMode] = useState<Viewer3DMeasureMode>('none');
    const [measurementDraft, setMeasurementDraft] = useState<MeasurementDraft>({
      mode: 'none',
      pickedAtomIndices: [],
      label: null,
    });
    const [measurements, setMeasurements] = useState<MeasurementRecord[]>([]);
    const measurementIdRef = useRef(0);
    const initialSceneConfigRef = useRef({
      width,
      height,
      isDarkMode,
      background: resolveViewerBackgroundColor(backgroundColor, isDarkMode),
    });

    const background = resolveViewerBackgroundColor(backgroundColor, isDarkMode);
    const overlaySurface = isDarkMode ? 'rgba(15,23,42,0.76)' : 'rgba(255,255,255,0.88)';
    const overlayText = isDarkMode ? '#e2e8f0' : '#0f172a';
    const overlayBorder = isDarkMode ? 'rgba(148,163,184,0.45)' : 'rgba(51,65,85,0.18)';
    const inactiveButtonBg = isDarkMode ? 'rgba(15,23,42,0.7)' : 'rgba(255,255,255,0.94)';
    const bondColor = customBondColor ?? (isDarkMode ? '#d7dde6' : '#3f4d5c');
    const bondSpecular = isDarkMode ? '#94a3b8' : '#cbd5e1';
    const representationProfile = useMemo(
      () => getRepresentationProfile(representation),
      [representation],
    );
    const effectiveAtomScale = atomScale * representationProfile.atomMultiplier;
    const effectiveSurfaceShellScale = atomScale * representationProfile.shellMultiplier;
    const effectiveBondRadius =
      DEFAULT_BOND_RADIUS * bondScale * representationProfile.bondMultiplier;
    const effectiveDoubleBondSpacing = effectiveBondRadius * 1.55;
    const effectiveTripleBondSpacing = effectiveBondRadius * 1.95;
    const showBonds = effectiveBondRadius > 0.003 && representationProfile.bondOpacity > 0.02;
    const hoveredHighlightIdx = hoveredAtomIdx;
    const selectedHighlightIndices = useMemo(
      () =>
        selectedAtomIndices.length > 0
          ? selectedAtomIndices
          : selectedAtomIdx !== null
            ? [selectedAtomIdx]
            : [],
      [selectedAtomIdx, selectedAtomIndices],
    );
    const visualBounds = useMemo(
      () =>
        molecule
          ? computeMoleculeVisualBounds(
              molecule,
              representation,
              atomScale,
              effectiveBondRadius,
              representationProfile,
            )
          : null,
      [atomScale, effectiveBondRadius, molecule, representation, representationProfile],
    );
    const displayMolecule = molecule;
    const bondKeyToBond = useMemo(() => {
      const map = new Map<string, Viewer3DMolecule['bonds'][number]>();
      if (!displayMolecule) return map;
      for (const bond of displayMolecule.bonds) {
        const key = bond.a1 < bond.a2 ? `${bond.a1}:${bond.a2}` : `${bond.a2}:${bond.a1}`;
        if (!map.has(key)) map.set(key, bond);
      }
      return map;
    }, [displayMolecule]);
    const hoveredHighlightBond = useMemo(() => {
      if (!hoveredBondAtoms) return null;
      const [a1, a2] = hoveredBondAtoms;
      const key = a1 < a2 ? `${a1}:${a2}` : `${a2}:${a1}`;
      return bondKeyToBond.get(key) ?? null;
    }, [bondKeyToBond, hoveredBondAtoms]);
    const selectedHighlightBonds = useMemo(
      () =>
        selectedBondAtoms
          .map(([a1, a2]) => {
            const key = a1 < a2 ? `${a1}:${a2}` : `${a2}:${a1}`;
            return bondKeyToBond.get(key) ?? null;
          })
          .filter(
            (bond, index, arr): bond is Viewer3DMolecule['bonds'][number] =>
              Boolean(bond) && arr.indexOf(bond) === index,
          ),
      [bondKeyToBond, selectedBondAtoms],
    );

    const fitCameraToBounds = useCallback(
      (resetOrientation = false) => {
        const moleculeGroup = moleculeGroupRef.current as BoundsCarrier | null;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!moleculeGroup || !camera || !controls || !moleculeGroup.userData.bounds) return;
        const { center, radius } = moleculeGroup.userData.bounds;
        const centerVector = new THREE.Vector3(center.x, center.y, center.z);
        const aspect = Math.max(width / height, 0.1);
        const minDistance = Math.max(
          viewer3dFitDistance(radius, perspectiveFov, aspect),
          radius * 1.8,
          4.5,
        );
        const currentOffset = camera.position.clone().sub(controls.target);
        const currentDistance = currentOffset.length();
        const viewDirection =
          !resetOrientation && currentDistance > 1e-6
            ? currentOffset.normalize()
            : new THREE.Vector3(0, 0, 1);
        const desiredDistance = resetOrientation
          ? minDistance
          : Math.max(currentDistance || minDistance, minDistance);
        controls.target.copy(centerVector);
        camera.position.copy(centerVector).addScaledVector(viewDirection, desiredDistance);
        camera.near = Math.max(0.01, desiredDistance / 180);
        camera.far = Math.max(desiredDistance * 28, 200);
        camera.lookAt(centerVector);
        camera.updateProjectionMatrix();
        controls.minDistance = Math.max(radius * 0.5, 0.8);
        controls.maxDistance = Math.max(desiredDistance * 10, 30);
        controls.update();
      },
      [height, perspectiveFov, width],
    );

    useImperativeHandle(
      ref,
      () => ({
        captureViewer: () => {
          const renderer = rendererRef.current;
          const scene = sceneRef.current;
          const camera = cameraRef.current;
          if (!renderer || !scene || !camera) return null;
          const size = renderer.getSize(new THREE.Vector2());
          const originalPixelRatio = renderer.getPixelRatio();
          const exportPixelRatio = Math.min(4, Math.max(originalPixelRatio, 3));
          renderer.setPixelRatio(exportPixelRatio);
          renderer.setSize(size.x, size.y, false);
          renderer.render(scene, camera);
          const image = renderer.domElement.toDataURL('image/png');
          renderer.setPixelRatio(originalPixelRatio);
          renderer.setSize(size.x, size.y, false);
          renderer.render(scene, camera);
          return image;
        },
        recenterView: () => {
          fitCameraToBounds(true);
        },
      }),
      [fitCameraToBounds],
    );

    const measurementHelp = useMemo(() => {
      if (measureMode === 'none') return null;
      return `Pick atom ${measurementDraft.pickedAtomIndices.length + 1}/${NEEDED_PICKS[measureMode]}`;
    }, [measureMode, measurementDraft.pickedAtomIndices.length]);

    useEffect(() => {
      if (!containerRef.current || rendererRef.current) return;
      const {
        width: initialWidth,
        height: initialHeight,
        isDarkMode: initialIsDarkMode,
        background: initialBackground,
      } = initialSceneConfigRef.current;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(initialWidth, initialHeight);
      renderer.setClearColor(initialBackground);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      containerRef.current.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(initialBackground);

      const camera = new THREE.PerspectiveCamera(
        perspectiveFov,
        Math.max(initialWidth / initialHeight, 0.1),
        0.01,
        1000,
      );
      camera.position.set(0, 0, 8);

      const controls = new TrackballControls(camera, renderer.domElement);
      controls.dynamicDampingFactor = 0.12;
      controls.rotateSpeed = 4;
      controls.zoomSpeed = 1.4;
      controls.panSpeed = 0.9;
      controls.noRoll = false;

      const ambientLight = new THREE.AmbientLight(
        initialIsDarkMode ? 0x475569 : 0xb8c2cf,
        ambientLightIntensity,
      );
      scene.add(ambientLight);
      const hemiLight = new THREE.HemisphereLight(
        initialIsDarkMode ? 0xcbd5e1 : 0xffffff,
        initialIsDarkMode ? 0x0f172a : 0xd9e1ea,
        hemiLightIntensity,
      );
      scene.add(hemiLight);
      const lightTarget = new THREE.Object3D();
      scene.add(lightTarget);
      const keyLight = new THREE.DirectionalLight(0xffffff, keyLightIntensity);
      keyLight.target = lightTarget;
      scene.add(keyLight);
      const fillLight = new THREE.DirectionalLight(
        initialIsDarkMode ? 0xbfdbfe : 0xf8fafc,
        fillLightIntensity,
      );
      fillLight.target = lightTarget;
      scene.add(fillLight);
      const rimLight = new THREE.DirectionalLight(
        initialIsDarkMode ? 0x64748b : 0xdbe4ee,
        rimLightIntensity,
      );
      rimLight.target = lightTarget;
      scene.add(rimLight);

      const moleculeGroup = new THREE.Group();
      const highlightGroup = new THREE.Group();
      const numberGroup = new THREE.Group();
      const orbitalGroup = new THREE.Group();
      const measurementGroup = new THREE.Group();
      const draftGroup = new THREE.Group();
      scene.add(moleculeGroup);
      scene.add(highlightGroup);
      scene.add(numberGroup);
      scene.add(orbitalGroup);
      scene.add(measurementGroup);
      scene.add(draftGroup);

      rendererRef.current = renderer;
      sceneRef.current = scene;
      cameraRef.current = camera;
      controlsRef.current = controls;
      ambientLightRef.current = ambientLight;
      hemiLightRef.current = hemiLight;
      keyLightRef.current = keyLight;
      fillLightRef.current = fillLight;
      rimLightRef.current = rimLight;
      lightTargetRef.current = lightTarget;
      moleculeGroupRef.current = moleculeGroup;
      highlightGroupRef.current = highlightGroup;
      numberGroupRef.current = numberGroup;
      orbitalGroupRef.current = orbitalGroup;
      measurementGroupRef.current = measurementGroup;
      draftGroupRef.current = draftGroup;

      let frameId = 0;
      const renderLoop = () => {
        frameId = window.requestAnimationFrame(renderLoop);
        controls.update();
        if (spin && moleculeGroupRef.current && !controls.dragging) {
          moleculeGroupRef.current.rotation.y += spinSpeed * 0.0035;
          if (numberGroupRef.current)
            numberGroupRef.current.rotation.y = moleculeGroupRef.current.rotation.y;
          if (orbitalGroupRef.current)
            orbitalGroupRef.current.rotation.y = moleculeGroupRef.current.rotation.y;
          if (highlightGroupRef.current)
            highlightGroupRef.current.rotation.y = moleculeGroupRef.current.rotation.y;
          if (measurementGroupRef.current)
            measurementGroupRef.current.rotation.y = moleculeGroupRef.current.rotation.y;
          if (draftGroupRef.current)
            draftGroupRef.current.rotation.y = moleculeGroupRef.current.rotation.y;
        }
        updateDirectionalLightRig(
          camera,
          controls.target,
          lightTarget,
          keyLightRef.current,
          fillLightRef.current,
          rimLightRef.current,
        );
        renderer.render(scene, camera);
      };
      renderLoop();

      return () => {
        window.cancelAnimationFrame(frameId);
        controls.dispose();
        renderer.dispose();
        clearGroup(moleculeGroup);
        clearGroup(highlightGroup);
        clearGroup(numberGroup);
        clearGroup(orbitalGroup);
        clearGroup(measurementGroup);
        clearGroup(draftGroup);
        renderer.domElement.remove();
        rendererRef.current = null;
        sceneRef.current = null;
        cameraRef.current = null;
        controlsRef.current = null;
        ambientLightRef.current = null;
        hemiLightRef.current = null;
        keyLightRef.current = null;
        fillLightRef.current = null;
        rimLightRef.current = null;
        lightTargetRef.current = null;
        moleculeGroupRef.current = null;
        highlightGroupRef.current = null;
        numberGroupRef.current = null;
        orbitalGroupRef.current = null;
        measurementGroupRef.current = null;
        draftGroupRef.current = null;
        atomMeshesRef.current = [];
        bondMeshesRef.current = [];
      };
    }, [
      ambientLightIntensity,
      backgroundColor,
      fillLightIntensity,
      hemiLightIntensity,
      keyLightIntensity,
      perspectiveFov,
      rimLightIntensity,
      spin,
      spinSpeed,
    ]);

    useEffect(() => {
      const renderer = rendererRef.current;
      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      const ambientLight = ambientLightRef.current;
      const hemiLight = hemiLightRef.current;
      const keyLight = keyLightRef.current;
      const fillLight = fillLightRef.current;
      const rimLight = rimLightRef.current;
      if (!renderer || !scene || !camera) return;
      renderer.setSize(width, height);
      camera.aspect = Math.max(width / height, 0.1);
      camera.fov = perspectiveFov;
      camera.updateProjectionMatrix();
      scene.background = new THREE.Color(background);
      renderer.setClearColor(background);
      if (ambientLight) {
        ambientLight.color.set(isDarkMode ? 0x475569 : 0xb8c2cf);
        ambientLight.intensity = ambientLightIntensity;
      }
      if (hemiLight) {
        hemiLight.color.set(isDarkMode ? 0xcbd5e1 : 0xffffff);
        hemiLight.groundColor.set(isDarkMode ? 0x0f172a : 0xd9e1ea);
        hemiLight.intensity = hemiLightIntensity;
      }
      if (keyLight) {
        keyLight.color.set(0xffffff);
        keyLight.intensity = keyLightIntensity;
      }
      if (fillLight) {
        fillLight.color.set(isDarkMode ? 0xbfdbfe : 0xf8fafc);
        fillLight.intensity = fillLightIntensity;
      }
      if (rimLight) {
        rimLight.color.set(isDarkMode ? 0x64748b : 0xdbe4ee);
        rimLight.intensity = rimLightIntensity;
      }
      controls?.handleResize?.();
      fitCameraToBounds(false);
    }, [
      ambientLightIntensity,
      background,
      fillLightIntensity,
      fitCameraToBounds,
      hemiLightIntensity,
      isDarkMode,
      keyLightIntensity,
      perspectiveFov,
      rimLightIntensity,
      width,
      height,
    ]);

    useEffect(() => {
      const moleculeGroup = moleculeGroupRef.current;
      const numberGroup = numberGroupRef.current;
      if (!moleculeGroup || !numberGroup) return;

      const shouldRecenter = !viewer3dHasMatchingTopology(previousMoleculeRef.current, molecule);
      previousMoleculeRef.current = molecule;

      clearGroup(moleculeGroup);
      clearGroup(numberGroup);
      atomMeshesRef.current = [];
      bondMeshesRef.current = [];
      if (shouldRecenter) {
        queueMicrotask(() => {
          setMeasurementDraft((current) => ({ ...current, pickedAtomIndices: [], label: null }));
          setMeasurements([]);
        });
      }

      if (!displayMolecule || displayMolecule.atoms.length === 0) return;

      const atomEmissiveIntensity =
        representation === 'surface'
          ? isDarkMode
            ? 0.18
            : 0.1
          : representation === 'spacefill'
            ? isDarkMode
              ? 0.14
              : 0.07
            : isDarkMode
              ? 0.11
              : 0.05;

      for (const [index, atom] of displayMolecule.atoms.entries()) {
        const radius = getAtomVisualRadius(
          atom.element,
          representation,
          atomScale,
          effectiveBondRadius,
          representationProfile,
        );
        const fitRadius = getAtomFitRadius(
          atom.element,
          representation,
          atomScale,
          effectiveBondRadius,
          representationProfile,
        );
        const atomTint = new THREE.Color(atomColor(atom.element, isDarkMode));
        if (representation === 'surface' && representationProfile.shellOpacity > 0) {
          const shell = new THREE.Mesh(
            new THREE.SphereGeometry(atomRadius(atom.element) * effectiveSurfaceShellScale, 34, 26),
            new THREE.MeshPhongMaterial({
              color: atomTint.clone().lerp(new THREE.Color('#ffffff'), isDarkMode ? 0.08 : 0.22),
              transparent: true,
              opacity: representationProfile.shellOpacity,
              shininess: 10,
              specular: new THREE.Color(isDarkMode ? '#8ba0b7' : '#e2e8f0'),
              emissive: atomTint.clone(),
              emissiveIntensity: isDarkMode ? 0.08 : 0.04,
              depthWrite: false,
              side: THREE.DoubleSide,
            }),
          );
          shell.position.set(atom.x, atom.y, atom.z);
          shell.userData.atomIndex = index;
          moleculeGroup.add(shell);
          atomMeshesRef.current.push(shell);
        }
        const geometry = new THREE.SphereGeometry(radius, 32, 24);
        const material = new THREE.MeshPhongMaterial({
          color: atomTint,
          transparent: representationProfile.atomOpacity < 0.999,
          opacity: representationProfile.atomOpacity,
          shininess: atom.element === 'H' ? 12 : representation === 'spacefill' ? 10 : 14,
          specular: new THREE.Color(isDarkMode ? '#71849a' : '#d7e0e8'),
          emissive: atomTint.clone(),
          emissiveIntensity: atomEmissiveIntensity,
          flatShading: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(atom.x, atom.y, atom.z);
        mesh.userData.atomIndex = index;
        mesh.userData.atomRadius = radius;
        moleculeGroup.add(mesh);
        if (!isDarkMode && atom.element === 'H' && representation === 'ball+stick') {
          const halo = new THREE.Mesh(
            new THREE.SphereGeometry(radius * 1.08, 24, 18),
            new THREE.MeshBasicMaterial({
              color: new THREE.Color('#94a3b8'),
              transparent: true,
              opacity: 0.18,
              depthWrite: false,
              side: THREE.BackSide,
            }),
          );
          halo.position.copy(mesh.position);
          moleculeGroup.add(halo);
        }
        atomMeshesRef.current.push(mesh);
        if (showAtomNumbers || showAtomLabels) {
          const badgeLabel =
            showAtomNumbers && showAtomLabels
              ? `${atom.element} ${index + 1}`
              : showAtomLabels
                ? atom.element
                : String(index + 1);
          const sprite = createAtomBadgeSprite(badgeLabel, isDarkMode);
          if (sprite) {
            sprite.position.set(atom.x, atom.y + fitRadius * 1.3, atom.z);
            numberGroup.add(sprite);
          }
        }
      }

      if (showBonds) {
        for (const bond of displayMolecule.bonds) {
          const start = displayMolecule.atoms[bond.a1];
          const end = displayMolecule.atoms[bond.a2];
          if (!start || !end) continue;
          const startVec = new THREE.Vector3(start.x, start.y, start.z);
          const endVec = new THREE.Vector3(end.x, end.y, end.z);
          const startRadius = getBondAnchorRadius(
            start.element,
            representation,
            atomScale,
            effectiveBondRadius,
            representationProfile,
          );
          const endRadius = getBondAnchorRadius(
            end.element,
            representation,
            atomScale,
            effectiveBondRadius,
            representationProfile,
          );
          for (const segment of buildBondSegments(
            displayMolecule,
            bond,
            startVec,
            endVec,
            Math.max(1, Math.round(bond.order)),
            startRadius,
            endRadius,
            effectiveBondRadius,
            effectiveDoubleBondSpacing,
            effectiveTripleBondSpacing,
          )) {
            const cylinder = buildCylinder(
              segment.start,
              segment.end,
              effectiveBondRadius,
              bondColor,
            );
            if (!cylinder) continue;
            cylinder.material = new THREE.MeshPhongMaterial({
              color: new THREE.Color(bondColor),
              shininess: 14,
              specular: new THREE.Color(bondSpecular),
              emissive: new THREE.Color(isDarkMode ? '#dce7f5' : '#ffffff'),
              emissiveIntensity: representation === 'surface' ? 0.16 : isDarkMode ? 0.1 : 0.03,
              transparent: representationProfile.bondOpacity < 0.999,
              opacity: representationProfile.bondOpacity,
            });
            cylinder.userData.bondAtoms = [bond.a1, bond.a2];
            moleculeGroup.add(cylinder);
            bondMeshesRef.current.push(cylinder);
          }
        }
      }

      const bounds =
        visualBounds ??
        computeMoleculeVisualBounds(
          displayMolecule,
          representation,
          atomScale,
          effectiveBondRadius,
          representationProfile,
        );
      moleculeGroup.userData.bounds = bounds;
      fitCameraToBounds(shouldRecenter);
    }, [
      bondColor,
      bondSpecular,
      displayMolecule,
      effectiveAtomScale,
      effectiveBondRadius,
      effectiveDoubleBondSpacing,
      effectiveTripleBondSpacing,
      effectiveSurfaceShellScale,
      fitCameraToBounds,
      isDarkMode,
      molecule,
      atomScale,
      representation,
      representationProfile,
      showAtomLabels,
      showAtomNumbers,
      showBonds,
      visualBounds,
    ]);

    useEffect(() => {
      const orbitalGroup = orbitalGroupRef.current;
      if (!orbitalGroup) return;
      clearGroup(orbitalGroup);
      if (!displayMolecule || !orbitalMesh || !orbitalAppearance) return;

      if (orbitalAppearance.showPositivePhase) {
        for (const object of buildOrbitalSurfaceObjects(
          orbitalMesh.positivePositions,
          orbitalAppearance.positiveColor,
          orbitalAppearance,
          isDarkMode,
        )) {
          orbitalGroup.add(object);
        }
      }

      if (orbitalAppearance.showNegativePhase) {
        for (const object of buildOrbitalSurfaceObjects(
          orbitalMesh.negativePositions,
          orbitalAppearance.negativeColor,
          orbitalAppearance,
          isDarkMode,
        )) {
          orbitalGroup.add(object);
        }
      }
    }, [displayMolecule, isDarkMode, orbitalAppearance, orbitalMesh]);

    useEffect(() => {
      queueMicrotask(() => {
        setMeasurementDraft({ mode: measureMode, pickedAtomIndices: [], label: null });
      });
    }, [measureMode]);

    useEffect(() => {
      const highlightGroup = highlightGroupRef.current;
      if (!highlightGroup) return;
      clearGroup(highlightGroup);
      if (!displayMolecule) return;

      for (const bond of selectedHighlightBonds) {
        if (hoveredHighlightBond === bond) continue;
        addBondHighlight(
          highlightGroup,
          displayMolecule,
          bond,
          '#f59e0b',
          effectiveAtomScale,
          effectiveBondRadius,
          effectiveDoubleBondSpacing,
          effectiveTripleBondSpacing,
        );
      }

      for (const atomIdx of selectedHighlightIndices) {
        if (atomIdx === hoveredHighlightIdx) continue;
        const atom = displayMolecule.atoms[atomIdx];
        if (!atom) continue;
        addAtomHighlight(highlightGroup, atom, '#f59e0b', effectiveAtomScale);
      }

      if (hoveredHighlightBond) {
        addBondHighlight(
          highlightGroup,
          displayMolecule,
          hoveredHighlightBond,
          '#38bdf8',
          effectiveAtomScale,
          effectiveBondRadius,
          effectiveDoubleBondSpacing,
          effectiveTripleBondSpacing,
        );
      }

      if (hoveredHighlightIdx !== null) {
        const atom = displayMolecule.atoms[hoveredHighlightIdx];
        if (atom) addAtomHighlight(highlightGroup, atom, '#38bdf8', effectiveAtomScale);
      }
    }, [
      displayMolecule,
      effectiveAtomScale,
      effectiveBondRadius,
      effectiveDoubleBondSpacing,
      effectiveTripleBondSpacing,
      hoveredHighlightBond,
      hoveredHighlightIdx,
      selectedHighlightBonds,
      selectedHighlightIndices,
    ]);

    useEffect(() => {
      const draftGroup = draftGroupRef.current;
      if (!draftGroup) return;
      clearGroup(draftGroup);
      if (
        !displayMolecule ||
        measurementDraft.mode === 'none' ||
        measurementDraft.pickedAtomIndices.length === 0
      )
        return;

      const color =
        MEASUREMENT_COLORS[measurementDraft.mode as Exclude<Viewer3DMeasureMode, 'none'>];
      const pickedAtoms = measurementDraft.pickedAtomIndices
        .map((index) => displayMolecule.atoms[index])
        .filter((atom): atom is NonNullable<typeof atom> => Boolean(atom));

      for (const atom of pickedAtoms) {
        addAtomHighlight(draftGroup, atom, color, effectiveAtomScale, 'measure');
      }

      if (measurementDraft.mode === 'distance') {
        for (let i = 0; i < measurementDraft.pickedAtomIndices.length - 1; i += 1) {
          addDistanceHighlight(
            draftGroup,
            displayMolecule,
            measurementDraft.pickedAtomIndices[i],
            measurementDraft.pickedAtomIndices[i + 1],
            color,
            effectiveAtomScale,
            effectiveBondRadius,
            effectiveDoubleBondSpacing,
            effectiveTripleBondSpacing,
          );
        }
        return;
      }

      if (measurementDraft.mode === 'angle' && measurementDraft.pickedAtomIndices.length >= 3) {
        addAngleHighlight(
          draftGroup,
          displayMolecule,
          measurementDraft.pickedAtomIndices[0],
          measurementDraft.pickedAtomIndices[1],
          measurementDraft.pickedAtomIndices[2],
          color,
          effectiveAtomScale,
          effectiveBondRadius,
        );
        return;
      }

      for (let i = 0; i < pickedAtoms.length - 1; i += 1) {
        const start = new THREE.Vector3(pickedAtoms[i].x, pickedAtoms[i].y, pickedAtoms[i].z);
        const end = new THREE.Vector3(
          pickedAtoms[i + 1].x,
          pickedAtoms[i + 1].y,
          pickedAtoms[i + 1].z,
        );
        const segment = buildCylinder(start, end, effectiveBondRadius * 0.75, color, 0.7);
        if (segment) draftGroup.add(segment);
      }
    }, [
      effectiveAtomScale,
      effectiveBondRadius,
      effectiveDoubleBondSpacing,
      effectiveTripleBondSpacing,
      displayMolecule,
      measurementDraft,
    ]);

    useEffect(() => {
      const measurementGroup = measurementGroupRef.current;
      if (!measurementGroup) return;
      clearGroup(measurementGroup);
      if (!displayMolecule || measurements.length === 0) return;

      for (const measurement of measurements) {
        const color = MEASUREMENT_COLORS[measurement.mode as Exclude<Viewer3DMeasureMode, 'none'>];
        const atoms = measurement.atomIndices
          .map((index) => displayMolecule.atoms[index])
          .filter((atom): atom is NonNullable<typeof atom> => Boolean(atom));
        if (measurement.mode === 'distance') {
          for (let i = 0; i < measurement.atomIndices.length - 1; i += 1) {
            addDistanceHighlight(
              measurementGroup,
              displayMolecule,
              measurement.atomIndices[i],
              measurement.atomIndices[i + 1],
              color,
              effectiveAtomScale,
              effectiveBondRadius,
              effectiveDoubleBondSpacing,
              effectiveTripleBondSpacing,
            );
          }
          continue;
        }
        if (measurement.mode === 'angle' && measurement.atomIndices.length >= 3) {
          addAngleHighlight(
            measurementGroup,
            displayMolecule,
            measurement.atomIndices[0],
            measurement.atomIndices[1],
            measurement.atomIndices[2],
            color,
            effectiveAtomScale,
            effectiveBondRadius,
          );
          continue;
        }
        for (let i = 0; i < atoms.length - 1; i += 1) {
          const start = new THREE.Vector3(atoms[i].x, atoms[i].y, atoms[i].z);
          const end = new THREE.Vector3(atoms[i + 1].x, atoms[i + 1].y, atoms[i + 1].z);
          const segment = buildCylinder(start, end, effectiveBondRadius * 0.55, color, 0.85);
          if (segment) measurementGroup.add(segment);
        }
      }
    }, [
      effectiveAtomScale,
      effectiveBondRadius,
      effectiveDoubleBondSpacing,
      effectiveTripleBondSpacing,
      displayMolecule,
      measurements,
    ]);

    useEffect(() => {
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      if (!renderer || !camera) return;

      const handleClick = (event: MouseEvent) => {
        if (measureMode === 'none' || !displayMolecule || atomMeshesRef.current.length === 0)
          return;
        const rect = renderer.domElement.getBoundingClientRect();
        pointerRef.current.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        pointerRef.current.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
        raycasterRef.current.setFromCamera(pointerRef.current, camera);
        const hit = raycasterRef.current.intersectObjects(atomMeshesRef.current, false)[0];
        if (!hit) {
          if (measureMode === 'distance' && bondMeshesRef.current.length > 0) {
            const bondHit = raycasterRef.current.intersectObjects(bondMeshesRef.current, false)[0];
            const bondAtoms = bondHit?.object.userData.bondAtoms as [number, number] | undefined;
            if (bondAtoms) {
              const nextLabel = buildMeasurementLabel('distance', bondAtoms, displayMolecule);
              if (nextLabel) {
                setMeasurementDraft({ mode: 'distance', pickedAtomIndices: [], label: nextLabel });
                queueMicrotask(() => {
                  setMeasurements((existing) => [
                    ...existing
                      .filter(
                        (entry) =>
                          !(
                            entry.mode === 'distance' &&
                            entry.atomIndices.join(',') === bondAtoms.join(',')
                          ),
                      )
                      .slice(-(MAX_VISIBLE_MEASUREMENTS - 1)),
                    {
                      id: measurementIdRef.current++,
                      mode: 'distance',
                      atomIndices: [...bondAtoms],
                      label: nextLabel,
                    },
                  ]);
                });
              }
              return;
            }
          }
          setMeasurementDraft({ mode: measureMode, pickedAtomIndices: [], label: null });
          return;
        }

        const atomIndex = hit.object.userData.atomIndex as number | undefined;
        if (atomIndex === undefined) return;
        setMeasurementDraft((current) => {
          const nextPicked = [...current.pickedAtomIndices, atomIndex].slice(
            0,
            NEEDED_PICKS[measureMode],
          );
          const nextLabel =
            nextPicked.length === NEEDED_PICKS[measureMode]
              ? buildMeasurementLabel(measureMode, nextPicked, displayMolecule)
              : null;
          if (nextLabel) {
            queueMicrotask(() => {
              setMeasurements((existing) => [
                ...existing
                  .filter(
                    (entry) =>
                      !(
                        entry.mode === measureMode &&
                        entry.atomIndices.join(',') === nextPicked.join(',')
                      ),
                  )
                  .slice(-(MAX_VISIBLE_MEASUREMENTS - 1)),
                {
                  id: measurementIdRef.current++,
                  mode: measureMode,
                  atomIndices: nextPicked,
                  label: nextLabel,
                },
              ]);
            });
          }
          return {
            mode: measureMode,
            pickedAtomIndices: nextLabel ? [] : nextPicked,
            label: nextLabel,
          };
        });
      };

      renderer.domElement.addEventListener('click', handleClick);
      return () => renderer.domElement.removeEventListener('click', handleClick);
    }, [displayMolecule, measureMode]);

    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          background,
          color: overlayText,
        }}
      >
        <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
        {(showMeasureToolbar || measureToolbarAddon) && (
          <div
            style={{ position: 'absolute', top: 8, left: 8, display: 'flex', gap: 6, zIndex: 2 }}
          >
            {showMeasureToolbar &&
              (['distance', 'angle', 'dihedral'] as Exclude<Viewer3DMeasureMode, 'none'>[]).map(
                (mode) => (
                  <button
                    key={mode}
                    onClick={() => {
                      setMeasureMode((prev) => {
                        const nextMode = prev === mode ? 'none' : mode;
                        setMeasurementDraft({ mode: nextMode, pickedAtomIndices: [], label: null });
                        return nextMode;
                      });
                    }}
                    style={{
                      border: `1px solid ${overlayBorder}`,
                      background:
                        measureMode === mode ? MEASUREMENT_COLORS[mode] : inactiveButtonBg,
                      color: measureMode === mode ? '#fff' : overlayText,
                      borderRadius: 4,
                      padding: '4px 8px',
                      fontSize: 11,
                      cursor: 'pointer',
                    }}
                  >
                    {mode === 'distance' ? 'd' : mode === 'angle' ? '∠' : '⟁'}
                  </button>
                ),
              )}
            {showMeasureToolbar && (measurements.length > 0 || measureMode !== 'none') && (
              <button
                onClick={() => {
                  setMeasureMode('none');
                  setMeasurementDraft({ mode: 'none', pickedAtomIndices: [], label: null });
                  setMeasurements([]);
                }}
                style={{
                  border: `1px solid ${overlayBorder}`,
                  background: inactiveButtonBg,
                  color: overlayText,
                  borderRadius: 4,
                  padding: '4px 8px',
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                clear
              </button>
            )}
            {measureToolbarAddon}
          </div>
        )}
        {showMeasureToolbar && (measurementHelp || measurementDraft.label) && (
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              padding: '6px 8px',
              borderRadius: 4,
              background: overlaySurface,
              color: overlayText,
              border: `1px solid ${overlayBorder}`,
              fontSize: 11,
              zIndex: 2,
            }}
          >
            {measurementDraft.label
              ? `${measurementDraft.mode}: ${measurementDraft.label}`
              : measurementHelp}
          </div>
        )}
        {showMeasureToolbar && measurements.length > 0 && (
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              right: 8,
              display: 'flex',
              flexDirection: 'column',
              gap: 3,
              zIndex: 2,
              alignItems: 'flex-end',
            }}
          >
            {measurements.map((measurement) => (
              <div
                key={measurement.id}
                style={{
                  padding: '6px 8px',
                  borderRadius: 4,
                  background: overlaySurface,
                  border: `1px solid ${MEASUREMENT_COLORS[measurement.mode as Exclude<Viewer3DMeasureMode, 'none'>]}`,
                  color: overlayText,
                  fontSize: 10,
                  maxWidth: 220,
                }}
              >
                {measurement.mode === 'distance' ? 'D' : measurement.mode === 'angle' ? 'A' : 'T'}:{' '}
                {measurement.label}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },
);
