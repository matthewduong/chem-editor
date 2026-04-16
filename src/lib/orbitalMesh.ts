import type { ViewerOrbitalField, ViewerOrbitalGrid, ViewerOrbitalMesh } from './viewer3d';

const CUBE_VERTEX_OFFSETS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];

const TETRAHEDRA: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
];

const TETRA_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];

type Vec3 = readonly [number, number, number];

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scaleVec(v: Vec3, scalar: number): Vec3 {
  return [v[0] * scalar, v[1] * scalar, v[2] * scalar];
}

function dotVec(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function crossVec(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function normVec(v: Vec3) {
  return Math.hypot(v[0], v[1], v[2]);
}

function normalizeVec(v: Vec3): Vec3 {
  const length = normVec(v);
  if (length <= 1e-8) return [0, 0, 0];
  return scaleVec(v, 1 / length);
}

function interpolateIsopoint(p1: Vec3, v1: number, p2: Vec3, v2: number, iso: number): Vec3 {
  if (Math.abs(iso - v1) <= 1e-12) return p1;
  if (Math.abs(iso - v2) <= 1e-12) return p2;
  const denominator = v2 - v1;
  if (Math.abs(denominator) <= 1e-12) return p1;
  const t = Math.max(0, Math.min(1, (iso - v1) / denominator));
  return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t, p1[2] + (p2[2] - p1[2]) * t];
}

function appendTriangle(a: Vec3, b: Vec3, c: Vec3, positionsOut: number[]) {
  positionsOut.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
}

function appendIsopoly(intersections: Vec3[], desired: Vec3, positionsOut: number[]) {
  if (intersections.length < 3) return;

  let centroid: Vec3 = [0, 0, 0];
  for (const point of intersections) {
    centroid = addVec(centroid, point);
  }
  centroid = scaleVec(centroid, 1 / intersections.length);

  let normal = desired;
  if (normVec(normal) <= 1e-8) {
    normal = crossVec(
      subVec(intersections[1], intersections[0]),
      subVec(intersections[intersections.length - 1], intersections[0]),
    );
  }
  if (normVec(normal) <= 1e-8) return;
  normal = normalizeVec(normal);

  let reference = subVec(intersections[0], centroid);
  if (normVec(reference) <= 1e-8 && intersections.length > 1) {
    reference = subVec(intersections[1], centroid);
  }
  if (normVec(reference) <= 1e-8) return;
  reference = normalizeVec(reference);

  let tangent = crossVec(normal, reference);
  if (normVec(tangent) <= 1e-8) return;
  tangent = normalizeVec(tangent);

  const ordered = [...intersections].sort((left, right) => {
    const leftOffset = subVec(left, centroid);
    const rightOffset = subVec(right, centroid);
    const leftAngle = Math.atan2(dotVec(leftOffset, tangent), dotVec(leftOffset, reference));
    const rightAngle = Math.atan2(dotVec(rightOffset, tangent), dotVec(rightOffset, reference));
    return leftAngle - rightAngle;
  });

  if (ordered.length >= 3) {
    const faceNormal = crossVec(subVec(ordered[1], ordered[0]), subVec(ordered[2], ordered[0]));
    if (dotVec(faceNormal, desired) < 0) {
      ordered.splice(1, ordered.length - 1, ...ordered.slice(1).reverse());
    }
  }

  for (let index = 1; index < ordered.length - 1; index += 1) {
    appendTriangle(ordered[0], ordered[index], ordered[index + 1], positionsOut);
  }
}

function polygonizeTetrahedron(
  positions: readonly Vec3[],
  values: readonly number[],
  iso: number,
  positionsOut: number[],
) {
  const inside = values.map((value) => value >= iso);
  const insideCount = inside.filter(Boolean).length;
  if (insideCount === 0 || insideCount === 4) return;

  const intersections: Vec3[] = [];
  for (const [left, right] of TETRA_EDGES) {
    if (inside[left] === inside[right]) continue;
    intersections.push(
      interpolateIsopoint(positions[left], values[left], positions[right], values[right], iso),
    );
  }

  if (intersections.length < 3) return;

  let insideCentroid: Vec3 = [0, 0, 0];
  let outsideCentroid: Vec3 = [0, 0, 0];
  let outsideCount = 0;
  for (let index = 0; index < positions.length; index += 1) {
    if (inside[index]) {
      insideCentroid = addVec(insideCentroid, positions[index]);
    } else {
      outsideCentroid = addVec(outsideCentroid, positions[index]);
      outsideCount += 1;
    }
  }
  insideCentroid = scaleVec(insideCentroid, 1 / insideCount);
  outsideCentroid = scaleVec(outsideCentroid, 1 / Math.max(1, outsideCount));
  let desired = subVec(outsideCentroid, insideCentroid);
  if (normVec(desired) <= 1e-8) desired = [0, 0, 1];
  appendIsopoly(intersections, desired, positionsOut);
}

function valueAt(
  values: number[],
  dims: readonly [number, number, number],
  ix: number,
  iy: number,
  iz: number,
) {
  return values[(ix * dims[1] + iy) * dims[2] + iz] ?? 0;
}

function buildIsosurfacePositions(
  field: ViewerOrbitalField,
  grid: ViewerOrbitalGrid,
  iso: number,
  sign = 1,
) {
  const [nx, ny, nz] = grid.dims;
  const positionsOut: number[] = [];
  const cubeOffsets = CUBE_VERTEX_OFFSETS.map(
    ([x, y, z]) => [x * grid.spacing, y * grid.spacing, z * grid.spacing] as const,
  );

  for (let ix = 0; ix < nx - 1; ix += 1) {
    for (let iy = 0; iy < ny - 1; iy += 1) {
      for (let iz = 0; iz < nz - 1; iz += 1) {
        const cubeValues = [
          sign * valueAt(field.values, grid.dims, ix, iy, iz),
          sign * valueAt(field.values, grid.dims, ix + 1, iy, iz),
          sign * valueAt(field.values, grid.dims, ix + 1, iy + 1, iz),
          sign * valueAt(field.values, grid.dims, ix, iy + 1, iz),
          sign * valueAt(field.values, grid.dims, ix, iy, iz + 1),
          sign * valueAt(field.values, grid.dims, ix + 1, iy, iz + 1),
          sign * valueAt(field.values, grid.dims, ix + 1, iy + 1, iz + 1),
          sign * valueAt(field.values, grid.dims, ix, iy + 1, iz + 1),
        ] as const;
        if (Math.max(...cubeValues) < iso || Math.min(...cubeValues) >= iso) continue;

        const base: Vec3 = [
          grid.origin[0] + ix * grid.spacing,
          grid.origin[1] + iy * grid.spacing,
          grid.origin[2] + iz * grid.spacing,
        ];
        const cubePositions = cubeOffsets.map((offset) => addVec(base, offset));

        for (const [a, b, c, d] of TETRAHEDRA) {
          polygonizeTetrahedron(
            [cubePositions[a], cubePositions[b], cubePositions[c], cubePositions[d]],
            [cubeValues[a], cubeValues[b], cubeValues[c], cubeValues[d]],
            iso,
            positionsOut,
          );
        }
      }
    }
  }

  return positionsOut;
}

export function buildOrbitalMesh(
  field: ViewerOrbitalField | null,
  grid: ViewerOrbitalGrid | null,
  isovalue: number,
): ViewerOrbitalMesh | null {
  if (!field || !grid) return null;
  const clampedIsovalue = Math.max(0.01, Math.min(0.12, isovalue));
  return {
    key: field.key,
    positivePositions:
      field.maxValue < clampedIsovalue
        ? []
        : buildIsosurfacePositions(field, grid, clampedIsovalue),
    negativePositions:
      field.minValue > -clampedIsovalue
        ? []
        : buildIsosurfacePositions(field, grid, clampedIsovalue, -1),
  };
}
