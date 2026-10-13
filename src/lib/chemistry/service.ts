import type { ChemDrawPoint } from '../../types/chemdraw';

export type ChemistryFailureCode =
  | 'unavailable'
  | 'invalid-input'
  | 'invalid-result'
  | 'stereo'
  | 'cancelled';
export type ChemistryResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ChemistryFailureCode; message: string };
export interface ChemistryDiagnostic {
  code: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  objectIds: string[];
  availability: 'available' | 'unavailable';
}
export interface LayoutRequest {
  molblock: string;
  atomMap: ReadonlyMap<number, string>;
  bondLength: number;
  signal?: AbortSignal;
}
export interface ChemistryService {
  capabilities: { layout: boolean; stereo: boolean; reason?: string };
  layout(request: LayoutRequest): Promise<ChemistryResult<ReadonlyMap<string, ChemDrawPoint>>>;
  /** Compare chemistry using the candidate's retained bond displays and coordinates. */
  validateIdentity(before: string, candidate: string): ChemistryResult<true>;
  validate(molblock: string, objectIds: string[]): Promise<ChemistryDiagnostic[]>;
}
