import { buildOrbitalMesh } from '../lib/orbitalMesh';
import type { ViewerOrbitalResult } from '../lib/viewer3d';
import type { MeshRequest } from './orbitalMeshProtocol';
let result: ViewerOrbitalResult | null = null;
self.onmessage = ({ data }: MessageEvent<MeshRequest>) => {
  try {
    if (data.type === 'load') {
      result = null;
      const count = data.result.grid.dims.reduce((a, b) => a * b, 1);
      if (
        !Number.isSafeInteger(count) ||
        count <= 0 ||
        data.result.grid.dims.some((v) => !Number.isSafeInteger(v) || v < 2) ||
        !Number.isFinite(data.result.grid.spacing) ||
        data.result.grid.spacing <= 0
      )
        throw new Error('Invalid orbital grid');
      for (const field of Object.values(data.result.fields)) {
        if (field.values.length !== count || !field.values.every(Number.isFinite))
          throw new Error('Invalid orbital field');
      }
      result = data.result;
      return;
    }
    if (!result || !result.fields[data.fieldKey] || !Number.isFinite(data.isovalue))
      throw new Error('Orbital field unavailable');
    const mesh = buildOrbitalMesh(result.fields[data.fieldKey], result.grid, data.isovalue);
    if (!mesh) throw new Error('Meshing returned no surface');
    const positivePositions = new Float64Array(mesh.positivePositions);
    const negativePositions = new Float64Array(mesh.negativePositions);
    self.postMessage(
      { id: data.id, mesh: { ...mesh, positivePositions, negativePositions } },
      { transfer: [positivePositions.buffer, negativePositions.buffer] },
    );
  } catch (error) {
    self.postMessage({
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
