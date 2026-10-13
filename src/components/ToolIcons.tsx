import type { ReactNode } from 'react';
import type { ArrowType } from '../types/chemistry';

/**
 * Toolbar glyphs on one 24-unit grid with one stroke weight, so the sidebar reads as a set.
 * Arrows carry the same notched, filled head the canvas draws; bonds carry the stereo glyphs the
 * document uses. Everything is `currentColor`, so selection and theme colour apply as for text.
 */
const STROKE = 1.6;

function Frame({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** A notched solid head with its tip at (x, y), pointing along `angle` (radians). */
function head(x: number, y: number, angle: number, length = 7.4, half = 3, notch = 6.4) {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const p = (back: number, side: number) =>
    `${(x - ux * back - uy * side).toFixed(2)},${(y - uy * back + ux * side).toFixed(2)}`;
  return `${x.toFixed(2)},${y.toFixed(2)} ${p(length, half)} ${p(notch, 0)} ${p(length, -half)}`;
}

function Head({ x, y, angle, ...rest }: { x: number; y: number; angle: number }) {
  return <polygon points={head(x, y, angle)} fill="currentColor" strokeWidth={0.6} {...rest} />;
}

export function ReactionArrowIcon({ type, size = 22 }: { type: ArrowType; size?: number }) {
  switch (type) {
    case 'reaction':
      return (
        <Frame size={size}>
          <path d="M3 12H15.8" />
          <Head x={21} y={12} angle={0} />
        </Frame>
      );
    case 'dashed-reaction':
      return (
        <Frame size={size}>
          <path d="M3 12H14.6" strokeDasharray="2.4 2.2" strokeLinecap="butt" />
          <Head x={21} y={12} angle={0} />
        </Frame>
      );
    case 'no-reaction':
      return (
        <Frame size={size}>
          <path d="M3 12H15.6" />
          <Head x={21} y={12} angle={0} />
          <path d="M8.2 7.6L13.2 16.4M13.2 7.6L8.2 16.4" strokeWidth={1.4} />
        </Frame>
      );
    case 'equilibrium':
      return (
        <Frame size={size}>
          <path d="M3 9.6H21" />
          <polygon points="21,9.6 14.6,6.2 15.8,9.6" fill="currentColor" strokeWidth={0.6} />
          <path d="M3 14.4H21" />
          <polygon points="3,14.4 9.4,17.8 8.2,14.4" fill="currentColor" strokeWidth={0.6} />
        </Frame>
      );
    case 'resonance':
      return (
        <Frame size={size}>
          <path d="M7.4 12H16.6" />
          <Head x={21.5} y={12} angle={0} />
          <Head x={2.5} y={12} angle={Math.PI} />
        </Frame>
      );
    case 'retrosynthetic':
      return (
        <Frame size={size}>
          <path d="M3 10H15M3 14H15" />
          <path d="M13 6.4L20.6 12L13 17.6" />
        </Frame>
      );
    case 'fat':
      return (
        <Frame size={size}>
          <path d="M3 9.4H13V5.8L21.5 12L13 18.2V14.6H3Z" fill="currentColor" strokeWidth={0.8} />
        </Frame>
      );
    case 'curved':
      return (
        <Frame size={size}>
          <path d="M5 19C4.4 11 8.4 6 14.4 6" />
          <Head x={19.5} y={6.2} angle={0.06} />
        </Frame>
      );
    case 'half-curved':
      return (
        <Frame size={size}>
          <path d="M5 19C4.4 11 8.2 6.6 13.6 6.2" />
          <polygon points="19,6.2 13.2,3.9 13.9,6.2" fill="currentColor" strokeWidth={0.6} />
        </Frame>
      );
    default:
      return null;
  }
}

export type StructureIconId =
  | 'bond'
  | 'benzene'
  | 'cyclohexane'
  | 'cyclopentane'
  | 'cyclobutane'
  | 'cyclopropane'
  | 'chair'
  | 'chair-flipped';

export function StructureFragmentIcon({ id, size = 22 }: { id: StructureIconId; size?: number }) {
  const polygon = (sides: number, radius: number, rotation = -Math.PI / 2) =>
    Array.from({ length: sides }, (_, index) => {
      const angle = rotation + (Math.PI * 2 * index) / sides;
      return `${(12 + Math.cos(angle) * radius).toFixed(2)},${(12 + Math.sin(angle) * radius).toFixed(2)}`;
    }).join(' ');
  if (id === 'bond') {
    return (
      <Frame size={size}>
        <path d="M4 17.5L20 6.5" />
      </Frame>
    );
  }
  if (id === 'benzene') {
    // A Kekulé hexagon: an inner stroke, inset towards the centre, on alternate edges.
    const R = 8.4;
    const v = (i: number) => {
      const angle = -Math.PI / 2 + (Math.PI * 2 * i) / 6;
      return { x: 12 + Math.cos(angle) * R, y: 12 + Math.sin(angle) * R };
    };
    const inner = [1, 3, 5].map((i) => {
      const a = v(i);
      const b = v(i + 1);
      const shrink = (p: { x: number; y: number }, q: { x: number; y: number }) => {
        // inset 2.3 towards the centre and 18% along the edge, so the stroke ends clear of corners
        const toward = (point: { x: number; y: number }) => ({
          x: point.x + (12 - point.x) * 0.27,
          y: point.y + (12 - point.y) * 0.27,
        });
        const pa = toward(p);
        const pb = toward(q);
        const dx = pb.x - pa.x;
        const dy = pb.y - pa.y;
        return `M${(pa.x + dx * 0.15).toFixed(2)} ${(pa.y + dy * 0.15).toFixed(2)}L${(pb.x - dx * 0.15).toFixed(2)} ${(pb.y - dy * 0.15).toFixed(2)}`;
      };
      return shrink(a, b);
    });
    return (
      <Frame size={size}>
        <polygon points={polygon(6, R, -Math.PI / 2)} />
        <path d={inner.join('')} />
      </Frame>
    );
  }
  if (id === 'chair' || id === 'chair-flipped') {
    const flip = id === 'chair-flipped';
    const pts = flip
      ? '3,9.5 8.5,15.5 13.5,12.5 21,15.5 15.5,9.5 10.5,12.5'
      : '21,9.5 15.5,15.5 10.5,12.5 3,15.5 8.5,9.5 13.5,12.5';
    return (
      <Frame size={size}>
        <polygon points={pts} />
      </Frame>
    );
  }
  const sides = id === 'cyclohexane' ? 6 : id === 'cyclopentane' ? 5 : id === 'cyclobutane' ? 4 : 3;
  const radius = id === 'cyclobutane' ? 7.2 : id === 'cyclopropane' ? 8 : 8.4;
  const rotation = id === 'cyclobutane' ? Math.PI / 4 : -Math.PI / 2;
  return (
    <Frame size={size}>
      <polygon points={polygon(sides, radius, rotation)} />
    </Frame>
  );
}

export function BondIcon({
  order,
  stereo,
  size = 22,
}: {
  order: number;
  stereo?: number;
  size?: number;
}) {
  if (stereo === 1) {
    return (
      <Frame size={size}>
        <polygon points="4,18 20,6.4 17.2,12.6" fill="currentColor" strokeWidth={0.8} />
        <polygon points="4,18 20,6.4 14.2,10.4" fill="currentColor" strokeWidth={0.8} />
      </Frame>
    );
  }
  if (stereo === 6) {
    return (
      <Frame size={size}>
        {[0, 1, 2, 3, 4].map((i) => {
          const t = i / 4;
          const x = 4.5 + t * 15;
          const y = 17.6 - t * 11;
          const w = 0.6 + t * 2.6;
          return (
            <path
              key={i}
              d={`M${(x - w * 0.55).toFixed(2)} ${(y - w * 0.8).toFixed(2)}L${(x + w * 0.55).toFixed(2)} ${(y + w * 0.8).toFixed(2)}`}
              strokeWidth={1.4}
            />
          );
        })}
      </Frame>
    );
  }
  if (order === 2) {
    return (
      <Frame size={size}>
        <path d="M3.7 14.6L19.7 3.6M4.3 20.4L20.3 9.4" />
      </Frame>
    );
  }
  if (order === 3) {
    return (
      <Frame size={size}>
        <path
          d="M2.8 12.8L18.8 1.8M4 19.6L20 8.6M5.2 26.4L21.2 15.4"
          transform="translate(0 -2.6)"
        />
      </Frame>
    );
  }
  return <StructureFragmentIcon id="bond" size={size} />;
}

export function ChainIcon({ size = 22 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M2.5 16L7.2 8L11.9 16L16.6 8L21.3 16" />
    </Frame>
  );
}

export function PanIcon({ size = 22 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M8 12V6.2a1.5 1.5 0 0 1 3 0V11M11 10.5V4.7a1.5 1.5 0 0 1 3 0V11M14 10.8V6a1.5 1.5 0 0 1 3 0v6.4M17 9.5a1.5 1.5 0 0 1 3 0V15a6.5 6.5 0 0 1-6.5 6.5h-1.3A6 6 0 0 1 8 19.7L4.4 15.3a1.6 1.6 0 0 1 2.4-2.1L8 14.4V12" />
    </Frame>
  );
}

export function SelectIcon({ size = 22 }: { size?: number }) {
  // The pointer arrow: select is the tool that picks things, not the one that moves the page.
  return (
    <Frame size={size}>
      <path d="M6 3.5L18.5 12.2L12.4 13.2L9.2 19.4Z" fill="currentColor" fillOpacity={0.12} />
      <path d="M12.4 13.2L16.2 19.4" />
    </Frame>
  );
}

export function TextToolIcon({ size = 22 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M5.5 6.5V5H18.5V6.5M12 5V19M9.2 19H14.8" />
    </Frame>
  );
}

export function EraserIcon({ size = 22 }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M9.6 19.5H20.5M6.1 15.7L14.6 7.2a1.7 1.7 0 0 1 2.4 0l2.4 2.4a1.7 1.7 0 0 1 0 2.4L12.5 18.9a1.7 1.7 0 0 1-1.2.5H8a1.7 1.7 0 0 1-1.2-.5L4.6 16.8a1.7 1.7 0 0 1 0-2.4Z" />
      <path d="M8.8 12.3L13.3 16.8" />
    </Frame>
  );
}
