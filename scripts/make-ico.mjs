/**
 * Pack one or more PNG files into a single .ico (PNG-compressed entries, supported since Vista).
 *   node scripts/make-ico.mjs out.ico 256.png 48.png 32.png 16.png
 */
import fs from "node:fs";

const [out, ...pngs] = process.argv.slice(2);
if (!out || pngs.length === 0) {
  console.error("usage: node scripts/make-ico.mjs out.ico a.png [b.png ...]");
  process.exit(1);
}

const entries = pngs.map((p) => {
  const buf = fs.readFileSync(p);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`${p} is not a PNG`);
  const w = buf.readUInt32BE(16);
  const h = buf.readUInt32BE(20);
  return { buf, w, h };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(entries.length, 4);

const dir = Buffer.alloc(16 * entries.length);
let offset = 6 + dir.length;
entries.forEach((e, i) => {
  const o = i * 16;
  dir.writeUInt8(e.w >= 256 ? 0 : e.w, o); // 0 means 256
  dir.writeUInt8(e.h >= 256 ? 0 : e.h, o + 1);
  dir.writeUInt8(0, o + 2); // palette
  dir.writeUInt8(0, o + 3); // reserved
  dir.writeUInt16LE(1, o + 4); // planes
  dir.writeUInt16LE(32, o + 6); // bpp
  dir.writeUInt32LE(e.buf.length, o + 8);
  dir.writeUInt32LE(offset, o + 12);
  offset += e.buf.length;
});

fs.writeFileSync(out, Buffer.concat([header, dir, ...entries.map((e) => e.buf)]));
console.log(`wrote ${out}: ${entries.map((e) => `${e.w}x${e.h}`).join(", ")}`);
