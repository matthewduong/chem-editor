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

/**
 * What a driver needs from any gesture tool, whatever its begin/update arguments are. Every
 * tool also exposes `begin`, `update` and `commit` with its own explicit inputs; `commit` is
 * gated on the document the press began on, so a stale pointer-up never edits a document that
 * was replaced mid-gesture.
 */
export interface GestureTool {
  /** A press is in progress. */
  isActive(): boolean;
  /** Abandon the press and clear its preview. Safe to call at any time. */
  cancel(): void;
}

export function cancelGestures(tools: readonly Pick<GestureTool, 'cancel'>[]): void {
  for (const tool of tools) tool.cancel();
}
