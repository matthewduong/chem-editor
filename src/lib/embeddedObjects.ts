const PREVIEW_COMMENT_PREFIX = '% ChemEditorPreviewDataUrl:';
const SOURCE_MIME_COMMENT_PREFIX = '% ChemEditorSourceMime:';
const SOURCE_FILE_COMMENT_PREFIX = '% ChemEditorSourceFile:';
const COMMENT_WRAP = 120;

function chunkString(value: string, chunkSize: number): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += chunkSize) {
    chunks.push(value.slice(index, index + chunkSize));
  }
  return chunks;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
}

export function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.trim();
  const bytes = new Uint8Array(Math.floor(normalized.length / 2));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export function dataUrlFromBytes(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${bytesToBase64(bytes)}`;
}

function escapePdfString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildPdfMetadataComments(options: {
  previewDataUrl?: string;
  sourceMimeType?: string;
  sourceFileName?: string;
}): string {
  const lines: string[] = [];
  if (options.previewDataUrl) {
    for (const chunk of chunkString(options.previewDataUrl, COMMENT_WRAP)) {
      lines.push(`${PREVIEW_COMMENT_PREFIX}${chunk}`);
    }
  }
  if (options.sourceMimeType) lines.push(`${SOURCE_MIME_COMMENT_PREFIX}${options.sourceMimeType}`);
  if (options.sourceFileName) {
    lines.push(`${SOURCE_FILE_COMMENT_PREFIX}${escapePdfString(options.sourceFileName)}`);
  }
  return lines.length > 0 ? `${lines.join('\n')}\n` : '';
}

function parsePdfMetadataComments(decoded: string): {
  previewDataUrl?: string;
  sourceMimeType?: string;
  sourceFileName?: string;
} {
  const previewChunks: string[] = [];
  let sourceMimeType: string | undefined;
  let sourceFileName: string | undefined;
  for (const line of decoded.split(/\r?\n/)) {
    if (line.startsWith(PREVIEW_COMMENT_PREFIX)) {
      previewChunks.push(line.slice(PREVIEW_COMMENT_PREFIX.length));
    } else if (line.startsWith(SOURCE_MIME_COMMENT_PREFIX)) {
      sourceMimeType = line.slice(SOURCE_MIME_COMMENT_PREFIX.length).trim() || undefined;
    } else if (line.startsWith(SOURCE_FILE_COMMENT_PREFIX)) {
      sourceFileName = line.slice(SOURCE_FILE_COMMENT_PREFIX.length).trim() || undefined;
    }
  }
  return {
    ...(previewChunks.length ? { previewDataUrl: previewChunks.join('') } : {}),
    ...(sourceMimeType ? { sourceMimeType } : {}),
    ...(sourceFileName ? { sourceFileName } : {}),
  };
}

async function loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
  return await new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not decode image payload.'));
    image.src = dataUrl;
  });
}

async function rasterDataUrlToJpegBytes(
  dataUrl: string,
): Promise<{ jpegBytes: Uint8Array; width: number; height: number }> {
  const image = await loadImageFromDataUrl(dataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth || image.width || 1));
  canvas.height = Math.max(1, Math.round(image.naturalHeight || image.height || 1));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D context is unavailable.');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
  const [, base64Payload = ''] = jpegDataUrl.split(',', 2);
  return {
    jpegBytes: base64ToBytes(base64Payload),
    width: canvas.width,
    height: canvas.height,
  };
}

function buildPdfBytesFromJpeg(options: {
  jpegBytes: Uint8Array;
  width: number;
  height: number;
  previewDataUrl?: string;
  sourceMimeType?: string;
  sourceFileName?: string;
}): Uint8Array {
  const metadataComments = buildPdfMetadataComments({
    previewDataUrl: options.previewDataUrl,
    sourceMimeType: options.sourceMimeType,
    sourceFileName: options.sourceFileName,
  });
  const header = `%PDF-1.4\n${metadataComments}%\xE2\xE3\xCF\xD3\n`;
  const objects: Array<{ header: string; body?: Uint8Array }> = [];

  const contentStream = `q\n${options.width} 0 0 ${options.height} 0 0 cm\n/Im0 Do\nQ\n`;
  const contentBytes = new TextEncoder().encode(contentStream);
  const infoBody = new TextEncoder().encode(
    `<< /Producer (ChemEditor) /Creator (ChemEditor) /Title (${escapePdfString(options.sourceFileName ?? 'Embedded Image')}) >>`,
  );

  objects.push({ header: '<< /Type /Catalog /Pages 2 0 R >>' });
  objects.push({ header: '<< /Type /Pages /Count 1 /Kids [3 0 R] >>' });
  objects.push({
    header: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${options.width} ${options.height}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
  });
  objects.push({
    header: `<< /Length ${contentBytes.length} >>\nstream\n${new TextDecoder().decode(contentBytes)}endstream`,
  });
  objects.push({
    header:
      `<< /Type /XObject /Subtype /Image /Width ${options.width} /Height ${options.height} ` +
      `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${options.jpegBytes.length} >>\nstream\n`,
    body: options.jpegBytes,
  });
  objects.push({
    header: `<< /Length ${infoBody.length} >>\nstream\n${new TextDecoder().decode(infoBody)}\nendstream`,
  });

  const parts: Uint8Array[] = [];
  const offsets: number[] = [0];
  let currentOffset = header.length;
  parts.push(new TextEncoder().encode(header));

  objects.forEach((object, index) => {
    offsets.push(currentOffset);
    const prefix = `${index + 1} 0 obj\n${object.header}`;
    const prefixBytes = new TextEncoder().encode(prefix);
    parts.push(prefixBytes);
    currentOffset += prefixBytes.length;
    if (object.body) {
      parts.push(object.body);
      currentOffset += object.body.length;
      const suffixBytes = new TextEncoder().encode('\nendstream\nendobj\n');
      parts.push(suffixBytes);
      currentOffset += suffixBytes.length;
    } else {
      const suffixBytes = new TextEncoder().encode('\nendobj\n');
      parts.push(suffixBytes);
      currentOffset += suffixBytes.length;
    }
  });

  const xrefOffset = currentOffset;
  const xrefLines = [`xref`, `0 ${objects.length + 1}`, `0000000000 65535 f `];
  for (let index = 1; index < offsets.length; index += 1) {
    xrefLines.push(`${String(offsets[index]).padStart(10, '0')} 00000 n `);
  }
  const trailer =
    `${xrefLines.join('\n')}\n` +
    `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  parts.push(new TextEncoder().encode(trailer));

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const pdfBytes = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    pdfBytes.set(part, offset);
    offset += part.length;
  }
  return pdfBytes;
}

export async function buildPdfHexForRasterImage(options: {
  bytes: Uint8Array;
  mimeType: 'image/png' | 'image/jpeg';
  sourceFileName?: string;
}): Promise<{
  payloadHex: string;
  previewDataUrl: string;
  width: number;
  height: number;
}> {
  const previewDataUrl = dataUrlFromBytes(options.bytes, options.mimeType);
  const { jpegBytes, width, height } = await rasterDataUrlToJpegBytes(previewDataUrl);
  const pdfBytes = buildPdfBytesFromJpeg({
    jpegBytes,
    width,
    height,
    previewDataUrl,
    sourceMimeType: options.mimeType,
    sourceFileName: options.sourceFileName,
  });
  return {
    payloadHex: bytesToHex(pdfBytes),
    previewDataUrl,
    width,
    height,
  };
}

export function extractEmbeddedPreviewData(
  payloadKind: string,
  payloadHex: string,
): {
  previewDataUrl?: string;
  sourceMimeType?: string;
  sourceFileName?: string;
} {
  if (!payloadHex) return {};
  if (payloadKind === 'png') {
    return { previewDataUrl: dataUrlFromBytes(hexToBytes(payloadHex), 'image/png') };
  }
  if (payloadKind === 'jpeg') {
    return { previewDataUrl: dataUrlFromBytes(hexToBytes(payloadHex), 'image/jpeg') };
  }
  if (payloadKind !== 'pdf') return {};

  try {
    const decoded = new TextDecoder('latin1').decode(hexToBytes(payloadHex));
    return parsePdfMetadataComments(decoded);
  } catch {
    return {};
  }
}

export function fitImageWithinViewport(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
): { width: number; height: number } {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const scale = Math.min(1, maxWidth / safeWidth, maxHeight / safeHeight);
  return {
    width: safeWidth * scale,
    height: safeHeight * scale,
  };
}
