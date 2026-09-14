#!/usr/bin/env node
// Pack PNGs into one .ico, dependency-free.
//
//   node brand/scripts/pack-ico.mjs out.ico in-16.png in-32.png [in-48.png]
//
// The ICO container has carried PNG-encoded entries since Windows Vista, and
// every browser that reads .ico reads them; so the file is a 6-byte header,
// one 16-byte directory entry per image, then the PNG bytes verbatim. Nothing
// is resampled — each entry is exactly the render resvg produced, which is the
// point: `png-to-ico`'s CLI takes one input and bicubic-scales it to every
// size, so a 16px render came back as a 256px blur.
import { readFileSync, writeFileSync } from 'node:fs';

const [out, ...inputs] = process.argv.slice(2);
if (!out || inputs.length === 0) {
  console.error('usage: pack-ico.mjs <out.ico> <png>...');
  process.exit(2);
}

const pngs = inputs.map((p) => {
  const buf = readFileSync(p);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${p} is not a PNG`);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  if (w !== h) throw new Error(`${p} is ${w}x${h}; ICO entries are square`);
  if (w > 256) throw new Error(`${p} is ${w}px; ICO entries are at most 256`);
  return { buf, size: w };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);            // reserved
header.writeUInt16LE(1, 2);            // type 1 = icon
header.writeUInt16LE(pngs.length, 4);  // image count

let offset = 6 + 16 * pngs.length;
const dirs = pngs.map(({ buf, size }) => {
  const d = Buffer.alloc(16);
  d.writeUInt8(size === 256 ? 0 : size, 0); // width, 0 means 256
  d.writeUInt8(size === 256 ? 0 : size, 1); // height
  d.writeUInt8(0, 2);                       // palette
  d.writeUInt8(0, 3);                       // reserved
  d.writeUInt16LE(1, 4);                    // colour planes
  d.writeUInt16LE(32, 6);                   // bits per pixel
  d.writeUInt32LE(buf.length, 8);           // bytes of image data
  d.writeUInt32LE(offset, 12);              // offset of image data
  offset += buf.length;
  return d;
});

writeFileSync(out, Buffer.concat([header, ...dirs, ...pngs.map((p) => p.buf)]));
console.log(`${out} — ${pngs.map((p) => p.size).join('/')}`);
