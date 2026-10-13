import type { ChemDrawPoint } from '../types/chemdraw';

/** Inputs are document coordinates and semantic hits, never DOM events. */
export interface ToolPointerInput<Hit> {
  point: ChemDrawPoint;
  hit: Hit;
  modifiers: { primary: boolean; shift: boolean };
}
export class ToolLifecycle<Hit, Source> {
  private active: {
    source: Source;
    start: ToolPointerInput<Hit>;
    latest: ToolPointerInput<Hit>;
  } | null = null;
  begin(source: Source, input: ToolPointerInput<Hit>) {
    this.active = { source, start: input, latest: input };
  }
  update(input: ToolPointerInput<Hit>) {
    if (this.active) this.active.latest = input;
  }
  commit(source: Source) {
    const active = this.active;
    this.active = null;
    return active?.source === source ? active : null;
  }
  cancel() {
    this.active = null;
  }
}
