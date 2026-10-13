import {
  buildAtomLabelRuns,
  buildChargeRuns,
  getLeadElementAnchorOffset,
} from '../../../lib/atomLabelPresentation';
import { getFaceMetrics } from '../../../lib/textMetrics';
import {
  getAtomLabelBaselineOffset,
  getNodeLabelVerticalOffset,
  getStackedLabelBaselines,
  getSuperscriptBaselineShift,
  resolveDocumentLabelTextStyle,
} from '../../../lib/chemdrawMetrics';
import { getAtomLeadElement } from '../../../lib/atomIdentity';
import {
  asGeneratedLabelAtom,
  getAtomDisplayText,
  getAtomHydrogenCount,
  resolveStackedHydrogenSide,
  splitHydrogenLabel,
} from '../../../lib/atomLabels';
import { VALENCIES } from '../../../lib/elements';
import {
  getAtomLabelBoxWidth,
  getAtomLabelLayoutMetrics,
  isAtomLabelVisible,
} from '../../../lib/renderGeometry';
import { resolveAtomLabelColor } from '../../../lib/settings';
import { measureRunWidth } from '../../../lib/textRunPresentation';
import { SHORTHAND_DATA } from '../../../lib/shorthand';
import { adaptColor, drawCircle, drawRunText, setStroke } from '../drawPrimitives';
import { drawObjectTags } from './objectTagHelpers';
import type { ObjectModule } from '../types';

export const NODE_MODULE: ObjectModule = {
  type: 'node',
  draw(object, context) {
    if (object.type !== 'node') return;
    const { scene, ctx } = context;
    const storedAtom = scene.legacy.atomById.get(object.id);
    if (!storedAtom) return;
    // Text that is just what would be generated is generated, so it reads and stacks like it.
    const atom = asGeneratedLabelAtom(storedAtom, scene.legacy.bonds);
    const connectedBonds = scene.legacy.bondsByAtomId.get(object.id) ?? [];
    const labelVisible = isAtomLabelVisible(atom, connectedBonds.length);
    const knownValence = VALENCIES[getAtomLeadElement(atom)] ?? null;
    const charge = atom.charge || 0;
    const bondOrderSum = connectedBonds.reduce((sum, bond) => sum + bond.order, 0);
    let effectiveValence = knownValence ?? 0;
    if (knownValence !== null) {
      if (getAtomLeadElement(atom) === 'C') effectiveValence = knownValence - Math.abs(charge);
      else if (getAtomLeadElement(atom) === 'N' || getAtomLeadElement(atom) === 'O')
        effectiveValence = knownValence + charge;
      else if (getAtomLeadElement(atom) === 'B') effectiveValence = knownValence + Math.abs(charge);
    }
    const error =
      scene.showValenceErrors &&
      ((knownValence !== null && bondOrderSum > effectiveValence) ||
        scene.rdkitInvalidAtomIds.has(atom.id));
    const canShowImplicitHydrogens = !atom.alias || Boolean(SHORTHAND_DATA[atom.alias]);
    const hydrogenCount =
      scene.showHydrogens && canShowImplicitHydrogens && knownValence !== null
        ? getAtomHydrogenCount(atom, scene.legacy.bonds, knownValence)
        : 0;
    const display = getAtomDisplayText(atom, scene.legacy.atoms, scene.legacy.bonds, hydrogenCount);
    const labelText = display.text;
    // A label read from a file arrives as text ("NH") with an above/below alignment rather than
    // as a computed hydrogen count, so it is split from the text.
    const explicitStack = object.labelAlignment === 'above' || object.labelAlignment === 'below';
    const stackParts =
      display.parts ?? (labelVisible && explicitStack ? splitHydrogenLabel(labelText) : null);
    const stackSide =
      !labelVisible || !stackParts
        ? null
        : explicitStack && !display.parts
          ? (object.labelAlignment as 'above' | 'below')
          : resolveStackedHydrogenSide(
              atom,
              scene.legacy.atoms,
              scene.legacy.bonds,
              hydrogenCount,
              object.labelAlignment,
            );
    const isSelected = scene.selectedAtomIds.has(atom.id);
    const isHovered = scene.hoveredAtomId === atom.id;
    const suppressSelectionAdornment =
      isSelected && scene.fullySelectedComponentAtomIds.has(atom.id);
    const showSelectionAdornment = isSelected && !suppressSelectionAdornment;
    const showAtomAdornment = error || isHovered || showSelectionAdornment;
    const labelTextStyle = resolveDocumentLabelTextStyle(scene.documentStyleSettings, {
      authored: {
        fontFamily: atom.labelFontFamily,
        fontSize: atom.labelFontSize,
      },
      nativeStyle: object.style,
    });
    const { fontFamily: labelFontFamily, fontSize: labelFontSize } = labelTextStyle;
    const labelColor = atom.labelColor ?? object.style?.color;
    const resolvedColor = error
      ? '#ff0000'
      : isSelected
        ? '#2196F3'
        : resolveAtomLabelColor(
            labelColor,
            getAtomLeadElement(atom),
            scene.documentStyleSettings,
            scene.isDarkMode,
            scene.documentViewSettings,
          );
    const baseRuns = buildAtomLabelRuns(
      atom,
      labelText,
      resolvedColor,
      scene.documentStyleSettings,
      scene.documentViewSettings,
      scene.isDarkMode,
    );
    // The charge is part of the label text: after the atom for an atom-first label, before it for
    // a hydrogen-first one (`NH3+`, `+H3N`).
    // A file's own label text can carry the charge already (`CH2+`, `O2-`); it is not added twice.
    const labelCarriesCharge =
      Boolean(atom.alias) && /^[+\-\u2212]|[+\-\u2212]\s*$/.test(atom.alias ?? '');
    const chargeRuns =
      labelVisible && !labelCarriesCharge ? buildChargeRuns(charge, resolvedColor) : [];
    const chargeText = chargeRuns.map((run) => run.text).join('');
    const chargeFirst = !stackSide && display.orientation === 'hydrogen-first';
    const displayRuns = chargeFirst ? [...chargeRuns, ...baseRuns] : [...baseRuns, ...chargeRuns];
    const anchorText = chargeFirst ? `${chargeText}${labelText}` : `${labelText}${chargeText}`;
    const anchor = labelVisible
      ? getLeadElementAnchorOffset(
          displayRuns,
          anchorText,
          getAtomLeadElement(atom),
          labelFontSize,
          getAtomLabelBoxWidth,
          (run) => measureRunWidth(run, labelFontSize, labelFontFamily),
        )
      : { offset: 0, width: 0, padding: 0 };
    // A label on an atom with no bond is written as typed with its first letter centred on the
    // atom (ChemDraw 26.1.0.6801: p.x was 3.61 left of the atom for DMF, 3.33 for Boc and Et3N,
    // 1.39 for tBuOK, half of the first letter in every case), not centred on the lead element.
    const firstRun = displayRuns[0];
    const isolatedLabel =
      labelVisible &&
      connectedBonds.length === 0 &&
      !stackSide &&
      Boolean(atom.alias) &&
      firstRun !== undefined;
    const offset = isolatedLabel
      ? anchor.padding +
        measureRunWidth(
          { ...firstRun, text: firstRun.text.slice(0, 1) },
          labelFontSize,
          labelFontFamily,
        ) /
          2
      : anchor.offset;
    const { width, padding } = anchor;
    const labelLayout = getAtomLabelLayoutMetrics(
      labelFontSize,
      labelVisible ? width : 0,
      scene.documentStyleSettings,
    );
    // A stacked label is laid out line by line below; the single-line shift is for labels that
    // carry an explicit above/below alignment but have no hydrogen run to stack.
    const verticalOffset = stackSide
      ? 0
      : getNodeLabelVerticalOffset(object.labelAlignment, labelFontSize);

    if (object.query && labelVisible) {
      ctx.save();
      setStroke(ctx, isSelected ? '#2196F3' : resolvedColor, labelLayout.hoverStrokeWidth, [4, 3]);
      ctx.globalAlpha = 0.7;
      const boxStartX = atom.x - offset;
      ctx.beginPath();
      const x = boxStartX - labelLayout.queryPadX;
      const y = atom.y - labelLayout.boxHeight / 2 - labelLayout.queryPadY + verticalOffset;
      const widthPx = Math.max(36, width + labelLayout.queryPadX * 2);
      const heightPx = labelLayout.boxHeight + labelLayout.queryPadY * 2;
      const radius = labelLayout.queryCornerRadius;
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + widthPx, y, x + widthPx, y + heightPx, radius);
      ctx.arcTo(x + widthPx, y + heightPx, x, y + heightPx, radius);
      ctx.arcTo(x, y + heightPx, x, y, radius);
      ctx.arcTo(x, y, x + widthPx, y, radius);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }

    if (showAtomAdornment) {
      ctx.save();
      ctx.globalAlpha = error ? 0.2 : isHovered ? 0.08 : 1;
      drawCircle(ctx, atom.x, atom.y, labelLayout.hoverRadius, {
        fill: error ? '#ff0000' : isHovered ? '#2196F3' : undefined,
        stroke: showSelectionAdornment ? '#2196F3' : error ? '#ff0000' : undefined,
        lineWidth: labelLayout.hoverStrokeWidth,
        dash: [2, 2],
      });
      ctx.restore();
    }

    if (labelVisible && stackSide && stackParts) {
      const splitAt = stackParts.lead.length;
      const leadRuns: typeof displayRuns = [];
      const hydrogenRuns: typeof displayRuns = [];
      let cursor = 0;
      for (const run of displayRuns) {
        const end = cursor + run.text.length;
        if (end <= splitAt) leadRuns.push(run);
        else if (cursor >= splitAt) hydrogenRuns.push(run);
        else {
          leadRuns.push({ ...run, text: run.text.slice(0, splitAt - cursor) });
          hydrogenRuns.push({ ...run, text: run.text.slice(splitAt - cursor) });
        }
        cursor = end;
      }
      const baselines = getStackedLabelBaselines(
        labelFontSize,
        stackSide,
        /[0-9\u2080-\u2089]/.test(stackParts.hydrogens),
        chargeRuns.length > 0,
      );
      const ascent = getFaceMetrics({ family: labelFontFamily, sizePx: labelFontSize }).ascent;
      // Both lines start where the first letter of the lead element starts, which ChemDraw
      // centres on the atom: p.x was 3.61 left of the atom for N and 3.33 for Si and Se at 10pt,
      // half of the first letter's width, not of the whole element symbol.
      const firstLetter = leadRuns[0]
        ? { ...leadRuns[0], text: leadRuns[0].text.slice(0, 1) }
        : null;
      const startX =
        atom.x -
        (firstLetter ? measureRunWidth(firstLetter, labelFontSize, labelFontFamily) : 0) / 2;
      const drawLine = (runs: typeof displayRuns, baseline: number) => {
        let x = startX;
        for (const run of runs) {
          drawRunText(
            ctx,
            run,
            x,
            atom.y + baseline - ascent,
            labelFontSize,
            labelFontFamily,
            error || isSelected
              ? resolvedColor
              : adaptColor(run.color ?? resolvedColor, scene.isDarkMode),
          );
          x += measureRunWidth(run, labelFontSize, labelFontFamily);
        }
      };
      drawLine(leadRuns, baselines.lead);
      drawLine(hydrogenRuns, baselines.hydrogens);
    } else if (labelVisible) {
      const textStartX = atom.x - offset + padding;
      let cursorX = textStartX;
      // drawRunText takes the top of the line, so back off by the ascent to land the baseline
      // where ChemDraw puts it.
      const labelY =
        atom.y +
        getAtomLabelBaselineOffset(labelFontSize, labelFontFamily) -
        getFaceMetrics({ family: labelFontFamily, sizePx: labelFontSize }).ascent +
        getSuperscriptBaselineShift(displayRuns) * labelFontSize +
        verticalOffset;
      displayRuns.forEach((run) => {
        drawRunText(
          ctx,
          run,
          cursorX,
          labelY,
          labelFontSize,
          labelFontFamily,
          error || isSelected
            ? resolvedColor
            : adaptColor(run.color ?? resolvedColor, scene.isDarkMode),
        );
        cursorX += measureRunWidth(run, labelFontSize, labelFontFamily);
      });
    } else if (showAtomAdornment) {
      ctx.save();
      ctx.globalAlpha = showSelectionAdornment || error ? 1 : 0.3;
      drawCircle(ctx, atom.x, atom.y, 4, {
        fill: error ? '#ff0000' : '#2196F3',
      });
      ctx.restore();
    }

    drawObjectTags(ctx, scene, object.objectTags, {
      fallbackAnchor: { x: atom.x, y: atom.y + verticalOffset },
      fallbackColor: resolvedColor,
    });
  },
  hitTest(object, point, context, options) {
    if (object.type !== 'node') return false;
    const atom = context.scene.legacy.atomById.get(object.id);
    if (!atom) return false;
    return Math.hypot(atom.x - point.x, atom.y - point.y) < 15 / options.stageScale;
  },
  editCapabilities: () => ['move', 'style', 'label'],
};
