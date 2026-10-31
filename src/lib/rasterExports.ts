/**
 * File > Export As TIFF, PDF, EPS and EMF, written without a library: the drawing's raster (the
 * one PNG and JPEG export draw) wrapped in each format. TIFF is uncompressed RGB; PDF and EPS
 * carry the JPEG as-is (DCTDecode); EMF carries a 24-bit DIB in one StretchDIBits record. Each is
 * sized so it prints at the drawing's own size (`pointsWide` × `pointsHigh`).
 */

const encoder = new TextEncoder();

function concat(parts: Array<Uint8Array | string>): Uint8Array {
  const bytes = parts.map((part) => (typeof part === 'string' ? encoder.encode(part) : part));
  const out = new Uint8Array(bytes.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of bytes) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/** Baseline TIFF, RGB 8-bit, one uncompressed strip, at `dpi`. */
export function encodeTiff(width: number, height: number, rgba: Uint8Array, dpi = 300): Uint8Array {
  const pixels = width * height;
  const rgb = new Uint8Array(pixels * 3);
  for (let i = 0; i < pixels; i += 1) {
    // Composite onto white, as the TIFF has no alpha.
    const a = rgba[i * 4 + 3]! / 255;
    for (let c = 0; c < 3; c += 1) {
      rgb[i * 3 + c] = Math.round(rgba[i * 4 + c]! * a + 255 * (1 - a));
    }
  }
  const entries: Array<[tag: number, type: number, count: number, value: number]> = [];
  const headerSize = 8;
  const entryCount = 12;
  const ifdSize = 2 + entryCount * 12 + 4;
  const bitsOffset = headerSize + ifdSize;
  const resolutionOffset = bitsOffset + 6;
  const dataOffset = resolutionOffset + 8;
  entries.push([256, 4, 1, width]); // ImageWidth
  entries.push([257, 4, 1, height]); // ImageLength
  entries.push([258, 3, 3, bitsOffset]); // BitsPerSample 8,8,8
  entries.push([259, 3, 1, 1]); // Compression: none
  entries.push([262, 3, 1, 2]); // Photometric: RGB
  entries.push([273, 4, 1, dataOffset]); // StripOffsets
  entries.push([277, 3, 1, 3]); // SamplesPerPixel
  entries.push([278, 4, 1, height]); // RowsPerStrip
  entries.push([279, 4, 1, rgb.length]); // StripByteCounts
  entries.push([282, 5, 1, resolutionOffset]); // XResolution
  entries.push([283, 5, 1, resolutionOffset]); // YResolution
  entries.push([296, 3, 1, 2]); // ResolutionUnit: inch
  const head = new DataView(new ArrayBuffer(dataOffset));
  head.setUint8(0, 0x49);
  head.setUint8(1, 0x49); // little-endian
  head.setUint16(2, 42, true);
  head.setUint32(4, headerSize, true);
  head.setUint16(headerSize, entryCount, true);
  entries.forEach(([tag, type, count, value], index) => {
    const at = headerSize + 2 + index * 12;
    head.setUint16(at, tag, true);
    head.setUint16(at + 2, type, true);
    head.setUint32(at + 4, count, true);
    if (type === 3 && count === 1) head.setUint16(at + 8, value, true);
    else head.setUint32(at + 8, value, true);
  });
  head.setUint32(headerSize + 2 + entryCount * 12, 0, true); // no next IFD
  [8, 8, 8].forEach((bits, i) => head.setUint16(bitsOffset + i * 2, bits, true));
  head.setUint32(resolutionOffset, dpi, true);
  head.setUint32(resolutionOffset + 4, 1, true);
  return concat([new Uint8Array(head.buffer), rgb]);
}

/** A one-page PDF showing the JPEG at `pointsWide` × `pointsHigh`. */
export function encodePdf(
  jpeg: Uint8Array,
  pixelWidth: number,
  pixelHeight: number,
  pointsWide: number,
  pointsHigh: number,
): Uint8Array {
  const w = pointsWide.toFixed(2);
  const h = pointsHigh.toFixed(2);
  const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q\n`;
  const objects: Array<Array<Uint8Array | string>> = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`,
    ],
    [
      `<< /Type /XObject /Subtype /Image /Width ${pixelWidth} /Height ${pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
      jpeg,
      '\nendstream',
    ],
    [`<< /Length ${content.length} >>\nstream\n${content}endstream`],
  ];
  const parts: Array<Uint8Array | string> = ['%PDF-1.4\n%âãÏÓ\n'];
  const offsets: number[] = [];
  let length = concat(parts).length;
  objects.forEach((body, index) => {
    offsets.push(length);
    const chunk = concat([`${index + 1} 0 obj\n`, ...body, '\nendobj\n']);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref =
    `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
    offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`;
  parts.push(xref);
  return concat(parts);
}

/** Encapsulated PostScript (level 2) showing the JPEG at `pointsWide` × `pointsHigh`. */
export function encodeEps(
  jpeg: Uint8Array,
  pixelWidth: number,
  pixelHeight: number,
  pointsWide: number,
  pointsHigh: number,
): Uint8Array {
  let hex = '';
  for (let i = 0; i < jpeg.length; i += 1) {
    hex += jpeg[i]!.toString(16).padStart(2, '0');
    if (i % 40 === 39) hex += '\n';
  }
  const box = `0 0 ${Math.ceil(pointsWide)} ${Math.ceil(pointsHigh)}`;
  return encoder.encode(
    [
      '%!PS-Adobe-3.0 EPSF-3.0',
      `%%BoundingBox: ${box}`,
      `%%HiResBoundingBox: 0 0 ${pointsWide.toFixed(2)} ${pointsHigh.toFixed(2)}`,
      '%%LanguageLevel: 2',
      '%%Pages: 1',
      '%%EndComments',
      'gsave',
      `${pointsWide.toFixed(2)} ${pointsHigh.toFixed(2)} scale`,
      '/DeviceRGB setcolorspace',
      `<< /ImageType 1 /Width ${pixelWidth} /Height ${pixelHeight} /BitsPerComponent 8`,
      `   /Decode [0 1 0 1 0 1] /ImageMatrix [${pixelWidth} 0 0 -${pixelHeight} 0 ${pixelHeight}]`,
      '   /DataSource currentfile /ASCIIHexDecode filter /DCTDecode filter >> image',
      `${hex}>`,
      'grestore',
      'showpage',
      '%%EOF',
      '',
    ].join('\n'),
  );
}

/**
 * An Enhanced Metafile (MS-EMF) with the raster as one EMR_STRETCHDIBITS record, framed at
 * `pointsWide` × `pointsHigh`.
 */
export function encodeEmf(
  width: number,
  height: number,
  rgba: Uint8Array,
  pointsWide: number,
  pointsHigh: number,
): Uint8Array {
  const rowBytes = Math.ceil((width * 3) / 4) * 4;
  const dib = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y += 1) {
    // DIB rows run bottom up, pixels as BGR, composited onto white.
    const src = (height - 1 - y) * width * 4;
    for (let x = 0; x < width; x += 1) {
      const a = rgba[src + x * 4 + 3]! / 255;
      const at = y * rowBytes + x * 3;
      for (let c = 0; c < 3; c += 1) {
        dib[at + 2 - c] = Math.round(rgba[src + x * 4 + c]! * a + 255 * (1 - a));
      }
    }
  }
  const frameW = Math.round((pointsWide / 72) * 2540); // .01 mm
  const frameH = Math.round((pointsHigh / 72) * 2540);
  const headerSize = 108;
  const bmiSize = 40;
  const stretchSize = 80 + bmiSize + dib.length;
  const eofSize = 20;
  const total = headerSize + stretchSize + eofSize;
  const view = new DataView(new ArrayBuffer(total));
  let at = 0;
  const u32 = (v: number) => {
    view.setUint32(at, v >>> 0, true);
    at += 4;
  };
  const i32 = (v: number) => {
    view.setInt32(at, v, true);
    at += 4;
  };
  // EMR_HEADER
  u32(1);
  u32(headerSize);
  [0, 0, width - 1, height - 1].forEach(i32); // Bounds (device units)
  [0, 0, frameW, frameH].forEach(i32); // Frame (.01 mm)
  u32(0x464d4520); // " EMF"
  u32(0x00010000); // version
  u32(total);
  u32(3); // records
  view.setUint16(at, 1, true); // handles
  view.setUint16(at + 2, 0, true);
  at += 4;
  u32(0); // description length
  u32(0); // description offset
  u32(0); // palette entries
  i32(width); // device size, pixels
  i32(height);
  // The reference device is the frame: its pixels span exactly the frame's millimetres, so the
  // raster fills the frame at any resolution.
  i32(Math.max(1, Math.round(frameW / 100))); // device size, mm
  i32(Math.max(1, Math.round(frameH / 100)));
  u32(0); // pixel format size
  u32(0); // pixel format offset
  u32(0); // no OpenGL
  i32(frameW * 10); // device size, micrometres
  i32(frameH * 10);
  // EMR_STRETCHDIBITS
  u32(81);
  u32(stretchSize);
  [0, 0, width - 1, height - 1].forEach(i32); // Bounds
  i32(0); // xDest
  i32(0); // yDest
  i32(0); // xSrc
  i32(0); // ySrc
  i32(width); // cxSrc
  i32(height); // cySrc
  u32(80); // offBmiSrc
  u32(bmiSize);
  u32(80 + bmiSize); // offBitsSrc
  u32(dib.length);
  u32(0); // DIB_RGB_COLORS
  u32(0x00cc0020); // SRCCOPY
  i32(width); // cxDest
  i32(height); // cyDest
  // BITMAPINFOHEADER
  u32(bmiSize);
  i32(width);
  i32(height);
  view.setUint16(at, 1, true);
  view.setUint16(at + 2, 24, true);
  at += 4;
  u32(0); // BI_RGB
  u32(dib.length);
  i32(11811); // 300 dpi in pixels per metre
  i32(11811);
  u32(0);
  u32(0);
  new Uint8Array(view.buffer).set(dib, at);
  at += dib.length;
  // EMR_EOF
  u32(14);
  u32(eofSize);
  u32(0);
  u32(16);
  u32(eofSize);
  return new Uint8Array(view.buffer);
}
