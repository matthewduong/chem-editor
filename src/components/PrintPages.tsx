import type { PageSetup } from '../types/settings';

/**
 * The printed pages: the finite document drawn once as SVG and shown page by page, scaled by
 * the print scale (ChemDraw 17.1 guide, "Scaling": 25-400%, relative to the paper). Printing
 * and Print Preview both draw these, so the preview is what prints.
 */
export function PrintPages({
  pageSetup,
  svgUrl,
  scalePercent,
  className,
  zoom = 1,
  marginInches = 0,
}: {
  pageSetup: PageSetup;
  svgUrl: string;
  scalePercent: number;
  className?: string;
  /** Preview only: shrinks the pages to fit the panel. */
  zoom?: number;
  /** Paper margins (ChemDraw's default is 0.5 in): each page's drawing is fitted inside them. */
  marginInches?: number;
}) {
  const { unit } = pageSetup;
  const margin = (unit === 'cm' ? marginInches * 2.54 : marginInches) * zoom;
  const inset = Math.max(
    0.05,
    Math.min(
      1 - (2 * margin) / (pageSetup.pageWidth * zoom),
      1 - (2 * margin) / (pageSetup.pageHeight * zoom),
    ),
  );
  const scale = scalePercent / 100;
  return (
    <div className={className}>
      {Array.from({ length: pageSetup.rows * pageSetup.columns }, (_, index) => {
        const row = Math.floor(index / pageSetup.columns);
        const column = index % pageSetup.columns;
        return (
          <div
            key={`print-page-${row}-${column}`}
            className="print-page"
            data-testid="print-page"
            style={{
              width: `${pageSetup.pageWidth * zoom}${unit}`,
              height: `${pageSetup.pageHeight * zoom}${unit}`,
              position: 'relative',
              overflow: 'hidden',
              background: 'white',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: `${margin}${unit}`,
                top: `${margin}${unit}`,
                width: `${pageSetup.pageWidth * zoom * inset}${unit}`,
                height: `${pageSetup.pageHeight * zoom * inset}${unit}`,
                overflow: 'hidden',
              }}
            >
              <img
                src={svgUrl}
                alt=""
                style={{
                  position: 'absolute',
                  left: `-${column * pageSetup.pageWidth * zoom * inset}${unit}`,
                  top: `-${row * pageSetup.pageHeight * zoom * inset}${unit}`,
                  width: `${pageSetup.pageWidth * pageSetup.columns * scale * zoom * inset}${unit}`,
                  height: `${pageSetup.pageHeight * pageSetup.rows * scale * zoom * inset}${unit}`,
                  maxWidth: 'none',
                  maxHeight: 'none',
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
