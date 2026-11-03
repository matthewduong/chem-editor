/**
 * ChemDraw's orbital outlines and their shading, read from the vector paths of ChemDraw 26.1.0.6801's
 * PDF for every OrbitalType in the DTD (gaps.md). Coordinates are in the orbital's own frame:
 * the origin is the BoundingBox's first point, the second point is (1, 0), and everything is in
 * units of the distance between them. The second point is the nucleus, with the first at the fat
 * end of a lobe (ChemDraw's own "Carbon Hybridization" sample has its lobes' second points on the
 * atoms), so a `p` orbital runs from x = 0 to 2 through the second point.
 *
 * Generated from the measurements; regenerate rather than edit.
 */
export type Cubic = ReadonlyArray<readonly [number, number]>;

/** Closed outlines, each as cubic Beziers [start, control 1, control 2, end]. */
export const ORBITAL_OUTLINES: Record<string, ReadonlyArray<Cubic>> = {
  circle: [
    [
      [2.0, 0.0],
      [2.0, 0.5523],
      [1.5523, 1.0],
      [1.0, 1.0],
    ],
    [
      [1.0, 1.0],
      [0.4477, 1.0],
      [0.0, 0.5523],
      [0.0, 0.0],
    ],
    [
      [0.0, 0.0],
      [0.0, -0.5523],
      [0.4477, -1.0],
      [1.0, -1.0],
    ],
    [
      [1.0, -1.0],
      [1.5523, -1.0],
      [2.0, -0.5523],
      [2.0, 0.0],
    ],
  ],
  oval: [
    [
      [2.0, 0.0],
      [2.0, 0.221],
      [1.5523, 0.4],
      [1.0, 0.4],
    ],
    [
      [1.0, 0.4],
      [0.4477, 0.4],
      [0.0, 0.221],
      [0.0, 0.0],
    ],
    [
      [0.0, 0.0],
      [0.0, -0.221],
      [0.4477, -0.4],
      [1.0, -0.4],
    ],
    [
      [1.0, -0.4],
      [1.5523, -0.4],
      [2.0, -0.221],
      [2.0, 0.0],
    ],
  ],
  lobe: [
    [
      [1.0, 0.0],
      [1.0, 0.1562],
      [0.49, 0.2913],
      [0.3326, 0.2913],
    ],
    [
      [0.3326, 0.2913],
      [0.14, 0.2913],
      [0.0, 0.25],
      [0.0, 0.0],
    ],
    [
      [0.0, 0.0],
      [0.0, -0.25],
      [0.14, -0.2913],
      [0.3326, -0.2913],
    ],
    [
      [0.3326, -0.2913],
      [0.49, -0.2913],
      [1.0, -0.1562],
      [1.0, 0.0],
    ],
  ],
  small: [
    [
      [1.0, 0.0],
      [1.0, -0.0625],
      [1.204, -0.1165],
      [1.2671, -0.1165],
    ],
    [
      [1.2671, -0.1165],
      [1.344, -0.1165],
      [1.4, -0.1],
      [1.4, 0.0],
    ],
    [
      [1.4, 0.0],
      [1.4, 0.1],
      [1.344, 0.1165],
      [1.2671, 0.1165],
    ],
    [
      [1.2671, 0.1165],
      [1.204, 0.1165],
      [1.0, 0.0625],
      [1.0, 0.0],
    ],
  ],
  ring: [
    [
      [1.0, 0.4456],
      [1.0992, 0.4456],
      [1.1374, 0.1435],
      [1.1374, 0.0],
    ],
    [
      [1.1374, 0.0],
      [1.1374, -0.1435],
      [1.0992, -0.4456],
      [1.0, -0.4456],
    ],
    [
      [1.0, -0.4456],
      [0.9207, -0.4456],
      [0.878, -0.2212],
      [0.8733, -0.1404],
    ],
    [
      [0.8733, -0.1404],
      [0.9207, -0.1068],
      [1.0, -0.0702],
      [1.0, 0.0],
    ],
    [
      [1.0, 0.0],
      [1.0, 0.0702],
      [0.9207, 0.1068],
      [0.8733, 0.1404],
    ],
    [
      [0.8733, 0.1404],
      [0.878, 0.2212],
      [0.9207, 0.4456],
      [1.0, 0.4456],
    ],
  ],
  dxyLobe: [
    [
      [1.0, 0.0],
      [1.0, 0.0],
      [0.6426, 0.3523],
      [0.3326, 0.3523],
    ],
    [
      [0.3326, 0.3523],
      [0.14, 0.3523],
      [0.0, 0.25],
      [0.0, 0.0],
    ],
    [
      [0.0, 0.0],
      [0.0, -0.25],
      [0.14, -0.3523],
      [0.3326, -0.3523],
    ],
    [
      [0.3326, -0.3523],
      [0.6426, -0.3523],
      [1.0, 0.0],
      [1.0, 0.0],
    ],
  ],
  dxyUp: [
    [
      [1.0, 0.0],
      [1.0, 0.0],
      [1.3523, 0.3574],
      [1.3523, 0.6674],
    ],
    [
      [1.3523, 0.6674],
      [1.3523, 0.86],
      [1.25, 1.0],
      [1.0, 1.0],
    ],
    [
      [1.0, 1.0],
      [0.75, 1.0],
      [0.6477, 0.86],
      [0.6477, 0.6674],
    ],
    [
      [0.6477, 0.6674],
      [0.6477, 0.3574],
      [1.0, 0.0],
      [1.0, 0.0],
    ],
  ],
  dxyDown: [
    [
      [1.0, 0.0],
      [1.0, 0.0],
      [0.6477, -0.3574],
      [0.6477, -0.6674],
    ],
    [
      [0.6477, -0.6674],
      [0.6477, -0.86],
      [0.75, -1.0],
      [1.0, -1.0],
    ],
    [
      [1.0, -1.0],
      [1.25, -1.0],
      [1.3523, -0.86],
      [1.3523, -0.6674],
    ],
    [
      [1.3523, -0.6674],
      [1.3523, -0.3574],
      [1.0, 0.0],
      [1.0, 0.0],
    ],
  ],
};

/**
 * What each OrbitalType draws, in order: an outline (A the lobe from the first point to the
 * second, B its mirror through the second point, H the small hybrid lobe past it, X and Y the two
 * dxy lobes on the axis, U and D the two across it, C the circle, O the oval, R the dz2 ring) and
 * a style: W white with a 0.6 outline, K solid black, S shaded with only a hairline, SO shaded
 * with the full outline, KO black with the outline.
 */
export const ORBITAL_RECIPES: Record<string, string> = {
  s: 'C:W',
  p: 'A:S B:W',
  oval: 'O:W',
  lobe: 'A:W',
  hybridPlus: 'H:S A:W',
  hybridMinus: 'H:W A:S',
  dz2Plus: 'A:W B:W R:S',
  dz2Minus: 'A:S B:S R:W',
  dxy: 'X:S Y:S U:W D:W',
  sShaded: 'C:SO',
  sFilled: 'C:K',
  ovalShaded: 'O:SO',
  ovalFilled: 'O:KO',
  lobeShaded: 'A:S',
  lobeFilled: 'A:K',
  pShaded: 'H:W A:S',
  pFilled: 'A:K B:W',
  hybridPlusFilled: 'H:K A:W',
  hybridMinusFilled: 'H:W A:K',
  dz2PlusFilled: 'A:W B:W R:K',
  dz2MinusFilled: 'A:K B:K R:W',
  dxyFilled: 'X:K Y:K U:W D:W',
};

/** The gray of each of a shaded orbital's 32 slices, outermost first (0 black, 1 white). */
export const ORBITAL_SLICE_GRAYS: readonly number[] = [
  0.0, 0.0706, 0.1569, 0.2314, 0.298, 0.3569, 0.4118, 0.4627, 0.5098, 0.5569, 0.5961, 0.6353,
  0.6706, 0.7059, 0.7373, 0.7686, 0.7961, 0.8196, 0.8431, 0.8667, 0.8863, 0.9059, 0.9216, 0.9373,
  0.949, 0.9608, 0.9725, 0.9804, 0.9882, 0.9922, 0.9961, 1.0,
];
