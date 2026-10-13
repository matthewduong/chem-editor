// Konva itself publishes this object; this harness adds no production test globals.
const Konva = (globalThis as unknown as { Konva: typeof import('konva').default }).Konva;

export function viewport() {
  const stage = Konva.stages[0];
  if (!stage) throw new Error('No canvas stage');
  return { scale: stage.scaleX(), x: stage.x(), y: stage.y() };
}
