import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_TOOL_PALETTE_ORDER } from '../lib/settings';
import type { AppPreferences, ToolPaletteId, ToolPalettesPreferences } from '../types/settings';

export interface PaletteDragState {
  id: ToolPaletteId;
  pos: { x: number; y: number };
  offset: { x: number; y: number };
  overDock: boolean;
  dockIndex: number;
  dockGuideTop: number | null;
}

function reorderPaletteIds(
  order: ToolPaletteId[],
  paletteId: ToolPaletteId,
  targetIndex: number,
): ToolPaletteId[] {
  const nextOrder = order.filter((id) => id !== paletteId);
  const clampedIndex = Math.max(0, Math.min(targetIndex, nextOrder.length));
  nextOrder.splice(clampedIndex, 0, paletteId);
  return nextOrder;
}

interface UseToolPaletteManagerOptions {
  appPreferences: AppPreferences;
  setAppPreferences: (appPreferences: AppPreferences) => void;
  appShellRef: React.RefObject<HTMLDivElement | null>;
  sidebarDockRef: React.RefObject<HTMLDivElement | null>;
  paletteRefs: React.MutableRefObject<Partial<Record<ToolPaletteId, HTMLDivElement | null>>>;
}

export function useToolPaletteManager({
  appPreferences,
  setAppPreferences,
  appShellRef,
  sidebarDockRef,
  paletteRefs,
}: UseToolPaletteManagerOptions) {
  const [paletteDrag, setPaletteDrag] = useState<PaletteDragState | null>(null);

  const toolPalettes = appPreferences.toolPalettes;
  const dockedPaletteIds = toolPalettes.order.filter(
    (paletteId) => toolPalettes.items[paletteId].docked,
  );
  const floatingPaletteIds = DEFAULT_TOOL_PALETTE_ORDER.filter(
    (paletteId) => !toolPalettes.items[paletteId].docked,
  );

  const persistToolPalettes = useCallback(
    (toolPalettePreferences: ToolPalettesPreferences) => {
      setAppPreferences({
        ...appPreferences,
        toolPalettes: toolPalettePreferences,
      });
    },
    [appPreferences, setAppPreferences],
  );

  const updatePaletteState = useCallback(
    (updater: (current: ToolPalettesPreferences) => ToolPalettesPreferences) => {
      persistToolPalettes(updater(appPreferences.toolPalettes));
    },
    [appPreferences.toolPalettes, persistToolPalettes],
  );

  const computeDockIndex = useCallback(
    (clientY: number, draggingPaletteId: ToolPaletteId) => {
      const otherDockedIds = dockedPaletteIds.filter(
        (paletteId) => paletteId !== draggingPaletteId,
      );
      for (let index = 0; index < otherDockedIds.length; index += 1) {
        const paletteRect = paletteRefs.current[otherDockedIds[index]]?.getBoundingClientRect();
        if (paletteRect && clientY < paletteRect.top + paletteRect.height / 2) {
          return index;
        }
      }
      return otherDockedIds.length;
    },
    [dockedPaletteIds, paletteRefs],
  );

  const togglePaletteCollapsed = useCallback(
    (paletteId: ToolPaletteId) => {
      updatePaletteState((current) => ({
        ...current,
        items: {
          ...current.items,
          [paletteId]: {
            ...current.items[paletteId],
            collapsed: !current.items[paletteId].collapsed,
          },
        },
      }));
    },
    [updatePaletteState],
  );

  const dockPalette = useCallback(
    (paletteId: ToolPaletteId, targetIndex: number) => {
      updatePaletteState((current) => ({
        order: reorderPaletteIds(current.order, paletteId, targetIndex),
        items: {
          ...current.items,
          [paletteId]: {
            ...current.items[paletteId],
            docked: true,
          },
        },
      }));
    },
    [updatePaletteState],
  );

  const getDockGuideTop = useCallback(
    (draggingPaletteId: ToolPaletteId, dockIndex: number) => {
      const dockRect = sidebarDockRef.current?.getBoundingClientRect();
      if (!dockRect) return null;

      const otherDockedIds = dockedPaletteIds.filter(
        (paletteId) => paletteId !== draggingPaletteId,
      );
      if (dockIndex >= otherDockedIds.length) {
        const lastRect =
          otherDockedIds.length > 0
            ? paletteRefs.current[
                otherDockedIds[otherDockedIds.length - 1]
              ]?.getBoundingClientRect()
            : null;
        return lastRect ? lastRect.bottom - dockRect.top + 6 : 8;
      }

      const nextRect = paletteRefs.current[otherDockedIds[dockIndex]]?.getBoundingClientRect();
      return nextRect ? nextRect.top - dockRect.top - 6 : null;
    },
    [dockedPaletteIds, paletteRefs, sidebarDockRef],
  );

  const beginPaletteDrag = useCallback(
    (paletteId: ToolPaletteId, event: React.MouseEvent) => {
      const shellRect = appShellRef.current?.getBoundingClientRect();
      const paletteElement =
        paletteRefs.current[paletteId] ??
        ((event.currentTarget as HTMLElement).closest(
          '[data-tool-palette-root="true"]',
        ) as HTMLDivElement | null);
      const paletteRect = paletteElement?.getBoundingClientRect();
      if (!shellRect || !paletteRect) return;

      const overDock =
        !!sidebarDockRef.current &&
        (() => {
          const dockRect = sidebarDockRef.current.getBoundingClientRect();
          return (
            event.clientX >= dockRect.left &&
            event.clientX <= dockRect.right &&
            event.clientY >= dockRect.top &&
            event.clientY <= dockRect.bottom
          );
        })();

      setPaletteDrag({
        id: paletteId,
        pos: {
          x: paletteRect.left - shellRect.left,
          y: paletteRect.top - shellRect.top,
        },
        offset: {
          x: event.clientX - paletteRect.left,
          y: event.clientY - paletteRect.top,
        },
        overDock,
        dockIndex: computeDockIndex(event.clientY, paletteId),
        dockGuideTop: overDock
          ? getDockGuideTop(paletteId, computeDockIndex(event.clientY, paletteId))
          : null,
      });
      event.preventDefault();
      event.stopPropagation();
    },
    [appShellRef, computeDockIndex, getDockGuideTop, paletteRefs, sidebarDockRef],
  );

  useEffect(() => {
    if (!paletteDrag) return;

    const handleMouseMove = (event: MouseEvent) => {
      const shellRect = appShellRef.current?.getBoundingClientRect();
      if (!shellRect) return;

      const nextPos = {
        x: Math.max(0, event.clientX - shellRect.left - paletteDrag.offset.x),
        y: Math.max(0, event.clientY - shellRect.top - paletteDrag.offset.y),
      };

      const dockRect = sidebarDockRef.current?.getBoundingClientRect();
      const overDock =
        !!dockRect &&
        event.clientX >= dockRect.left &&
        event.clientX <= dockRect.right &&
        event.clientY >= dockRect.top &&
        event.clientY <= dockRect.bottom;

      setPaletteDrag((current) =>
        current
          ? {
              ...current,
              pos: nextPos,
              overDock,
              dockIndex: overDock ? computeDockIndex(event.clientY, current.id) : current.dockIndex,
              dockGuideTop: overDock
                ? getDockGuideTop(current.id, computeDockIndex(event.clientY, current.id))
                : null,
            }
          : current,
      );
    };

    const handleMouseUp = () => {
      if (paletteDrag.overDock) {
        dockPalette(paletteDrag.id, paletteDrag.dockIndex);
      } else {
        updatePaletteState((current) => ({
          ...current,
          items: {
            ...current.items,
            [paletteDrag.id]: {
              ...current.items[paletteDrag.id],
              docked: false,
              position: paletteDrag.pos,
            },
          },
        }));
      }
      setPaletteDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp, { once: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    appShellRef,
    computeDockIndex,
    dockPalette,
    getDockGuideTop,
    paletteDrag,
    sidebarDockRef,
    updatePaletteState,
  ]);

  return {
    toolPalettes,
    dockedPaletteIds,
    floatingPaletteIds,
    paletteDrag,
    togglePaletteCollapsed,
    beginPaletteDrag,
    dockPalette,
    dockGuideTop: paletteDrag?.dockGuideTop ?? null,
  };
}
