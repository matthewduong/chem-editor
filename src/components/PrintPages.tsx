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
}: {
  pageSetup: PageSetup;
  svgUrl: string;
  scalePercent: number;
  className?: string;
  /** Preview only: shrinks the pages to fit the panel. */
  zoom?: number;
}) {
  const scale = scalePercent / 100;
  const { unit } = pageSetup;
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
            <img
              src={svgUrl}
              alt=""
              style={{
                position: 'absolute',
                left: `-${column * pageSetup.pageWidth * zoom}${unit}`,
                top: `-${row * pageSetup.pageHeight * zoom}${unit}`,
                width: `${pageSetup.pageWidth * pageSetup.columns * scale * zoom}${unit}`,
                height: `${pageSetup.pageHeight * pageSetup.rows * scale * zoom}${unit}`,
                maxWidth: 'none',
                maxHeight: 'none',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
