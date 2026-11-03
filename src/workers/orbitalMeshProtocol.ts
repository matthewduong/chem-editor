import type { ViewerOrbitalMesh, ViewerOrbitalResult } from '../lib/viewer3d';
export type MeshRequest =
  | { type: 'load'; id: number; result: ViewerOrbitalResult }
  | { type: 'mesh'; id: number; fieldKey: string; isovalue: number };
export type MeshReply =
  | { id: number; mesh: ViewerOrbitalMesh; error?: never }
  | { id: number; error: string; mesh?: never };
