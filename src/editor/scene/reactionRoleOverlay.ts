import type { ChemDrawBounds } from '../../types/chemdraw';
import { setStroke } from './drawPrimitives';
import type { DocumentSceneState } from './types';

/**
 * Structure > Show Reaction Interpretation: each step's objects outlined in the colour of their
 * role, the arrow included, with the role named above the outline. An editing affordance like
 * selection; exports never carry it.
 */
const ROLE_STYLE = [
  ['reactants', '#1e88e5', 'Reactant'],
  ['products', '#43a047', 'Product'],
  ['aboveArrow', '#fb8c00', 'Above arrow'],
  ['belowArrow', '#fb8c00', 'Below arrow'],
  ['arrows', '#8e24aa', 'Arrow'],
] as const;

export function drawReactionRoleOverlay(ctx: CanvasRenderingContext2D, scene: DocumentSceneState) {
  const schemes = scene.index.activePage?.schemes;
  if (!schemes?.length) return;
  const pad = scene.documentStyleSettings.bondLength * 0.25;
  const outline = (bounds: ChemDrawBounds, color: string, label: string) => {
    ctx.save();
    setStroke(ctx, color, 1, [4, 3]);
    ctx.strokeRect(
      bounds.left - pad,
      bounds.top - pad,
      bounds.right - bounds.left + 2 * pad,
      bounds.bottom - bounds.top + 2 * pad,
    );
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, bounds.left - pad, bounds.top - pad - 1);
    ctx.restore();
  };
  for (const step of schemes.flatMap((scheme) => scheme.steps)) {
    for (const [key, color, label] of ROLE_STYLE) {
      for (const id of step[key]) {
        const bounds = scene.index.boundsById.get(id);
        if (bounds) outline(bounds, color, label);
      }
    }
  }
}
