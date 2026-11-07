/*
 * TGA -> PNG, for looking at the mod's sprites without the game.
 *
 *   node tools/tga-png.js "true dark mode" out-dir
 *   node tools/tga-png.js "true dark mode/main3.tga" out-dir
 *
 * Writes one PNG per .tga/.TGA input. Uses the editor's own decoder
 * (assets/tga.js) and zlib for the PNG, so there are no dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const Tga = require('../assets/tga.js');

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4)
      .copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

function convert(file, outDir) {
  const image = Tga.decode(fs.readFileSync(file));
  const name = path.basename(file).replace(/\.[^.]+$/, '') + '.png';
  const target = path.join(outDir, name);
  fs.writeFileSync(target, encodePng(image.width, image.height, image.rgba));
  console.log(image.width + 'x' + image.height + '  ' + target);
}

function main() {
  const [input, outDir] = process.argv.slice(2);
  if (!input || !outDir) {
    console.error('usage: node tools/tga-png.js <file-or-dir> <out-dir>');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const stat = fs.statSync(input);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(input).sort()) {
      if (/\.tga$/i.test(entry)) convert(path.join(input, entry), outDir);
    }
  } else {
    convert(input, outDir);
  }
}

module.exports = { encodePng };
if (require.main === module) main();
