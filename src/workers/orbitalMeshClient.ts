import type { ViewerOrbitalMesh, ViewerOrbitalResult } from '../lib/viewer3d';
import type { MeshReply } from './orbitalMeshProtocol';
/** A busy worker is terminated on supersession; idle workers retain their transferred grid. */
export class OrbitalMeshClient {
  private worker: Worker | null = null;
  private result: ViewerOrbitalResult | null = null;
  private serial = 0;
  private pending: {
    id: number;
    resolve: (mesh: ViewerOrbitalMesh) => void;
    reject: (error: Error) => void;
  } | null = null;
  constructor(
    private createWorker = () =>
      new Worker(new URL('./orbitalMesh.worker.ts', import.meta.url), { type: 'module' }),
  ) {}
  cancel() {
    if (!this.pending) return;
    this.pending.reject(new Error('Meshing superseded'));
    this.pending = null;
    this.worker?.terminate();
    this.worker = null;
    this.result = null;
    this.serial += 1;
  }
  dispose() {
    this.cancel();
    this.worker?.terminate();
    this.worker = null;
    this.result = null;
  }
  mesh(
    result: ViewerOrbitalResult,
    fieldKey: string,
    isovalue: number,
  ): Promise<ViewerOrbitalMesh> {
    this.cancel();
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      this.pending = { id, resolve, reject };
      try {
        if (!this.worker) this.worker = this.createWorker();
        this.worker.onmessage = ({ data }: MessageEvent<MeshReply>) => {
          if (this.pending?.id !== data.id) return;
          const pending = this.pending;
          this.pending = null;
          if (data.error !== undefined) {
            pending.reject(new Error(data.error));
            this.dispose();
          } else pending.resolve(data.mesh);
        };
        this.worker.onerror = (event) => {
          this.pending?.reject(new Error(event.message || 'Orbital mesh worker failed'));
          this.pending = null;
          this.dispose();
        };
        if (this.result !== result) {
          const fields = Object.fromEntries(
            Object.entries(result.fields).map(([key, field]) => [
              key,
              { ...field, values: new Float64Array(field.values) },
            ]),
          );
          const transfer = Object.values(fields).map((field) => field.values.buffer);
          this.worker.postMessage({ type: 'load', id, result: { ...result, fields } }, transfer);
          this.result = result;
        }
        this.worker.postMessage({ type: 'mesh', id, fieldKey, isovalue });
      } catch (error) {
        this.pending = null;
        this.dispose();
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}
