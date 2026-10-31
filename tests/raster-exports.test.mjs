import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  encodeEmf,
  encodeEps,
  encodePdf,
  encodeTiff,
} from '../.unit-test-dist/src/lib/rasterExports.js';

const has = (tool) => {
  try {
    execFileSync('which', [tool], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
const dir = mkdtempSync(path.join(tmpdir(), 'raster-exports-'));
// 40 x 20: left half red, right half blue.
const width = 40;
const height = 20;
const rgba = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    rgba.set(x < 20 ? [255, 0, 0, 255] : [0, 0, 255, 255], i);
  }
}
const pixel = (file, x, y) =>
  execFileSync('magick', [
    file,
    '-format',
    `%[fx:int(255*p{${x},${y}}.r)],%[fx:int(255*p{${x},${y}}.b)]`,
    'info:',
  ])
    .toString()
    .trim();

test('TIFF is read back with its size and colours', { skip: !has('magick') }, () => {
  const file = path.join(dir, 'a.tif');
  writeFileSync(file, encodeTiff(width, height, rgba));
  assert.equal(execFileSync('magick', ['identify', '-format', '%w %h', file]).toString(), '40 20');
  assert.equal(pixel(file, 5, 5), '255,0');
  assert.equal(pixel(file, 35, 5), '0,255');
});

test(
  'PDF and EPS carry the JPEG at the drawing size',
  { skip: !has('magick') || !has('gs') },
  () => {
    const jpeg = execFileSync('magick', [
      '-size',
      '40x20',
      'xc:red',
      '-fill',
      'blue',
      '-draw',
      'rectangle 20,0 39,19',
      'jpeg:-',
    ]);
    const pdf = path.join(dir, 'a.pdf');
    writeFileSync(pdf, encodePdf(new Uint8Array(jpeg), 40, 20, 80, 40));
    if (has('pdfinfo')) {
      const info = execFileSync('pdfinfo', [pdf]).toString();
      assert.match(info, /Pages:\s+1/);
      assert.match(info, /Page size:\s+80 x 40 pts/);
    }
    const eps = path.join(dir, 'a.eps');
    writeFileSync(eps, encodeEps(new Uint8Array(jpeg), 40, 20, 80, 40));
    for (const [source, out] of [
      [pdf, 'p.png'],
      [eps, 'e.png'],
    ]) {
      const png = path.join(dir, out);
      execFileSync('gs', [
        '-q',
        '-dSAFER',
        '-dBATCH',
        '-dNOPAUSE',
        '-dEPSCrop',
        '-sDEVICE=png16m',
        '-r72',
        `-sOutputFile=${png}`,
        source,
      ]);
      assert.equal(
        execFileSync('magick', ['identify', '-format', '%w %h', png]).toString(),
        '80 40',
      );
      const [r1] = pixel(png, 10, 20).split(',').map(Number);
      const [, b2] = pixel(png, 70, 20).split(',').map(Number);
      assert.ok(r1 > 200 && b2 > 200, `${source}: ${pixel(png, 10, 20)} ${pixel(png, 70, 20)}`);
    }
  },
);

test(
  'EMF is read back by an independent reader',
  { skip: !has('inkscape') || !has('magick') },
  () => {
    const emf = path.join(dir, 'a.emf');
    writeFileSync(emf, encodeEmf(width, height, rgba, 80, 40));
    const bytes = readFileSync(emf);
    assert.equal(bytes.readUInt32LE(40), 0x464d4520);
    assert.equal(bytes.readUInt32LE(48), bytes.length);
    const png = path.join(dir, 'm.png');
    execFileSync('inkscape', [emf, '--export-type=png', `--export-filename=${png}`], {
      stdio: 'ignore',
    });
    const [w] = execFileSync('magick', ['identify', '-format', '%w %h', png])
      .toString()
      .split(' ')
      .map(Number);
    assert.ok(w > 0);
    const [r] = pixel(png, Math.floor(w / 4), 2)
      .split(',')
      .map(Number);
    assert.ok(r > 200, pixel(png, Math.floor(w / 4), 2));
  },
);
