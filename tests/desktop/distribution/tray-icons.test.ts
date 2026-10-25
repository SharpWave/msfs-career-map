/**
 * The app's icons (scripts/tray-icons.ts; m2 contract §15.5): the window's icon is
 * `assets/career-map.ico`, holding a 256 px image (DESK-DIST-PKG-015, the window's icon now); the
 * tray icons are made from it at build time, each holding 16, 20, 24 and 32 px images — the mark
 * alone and the mark with each status dot, red, blue, violet, amber and green (DESK-DIST-PKG-016).
 *
 * The PNGs and .ico files are read here by a decoder of this file's own (node:zlib), so a fault in
 * the module's decoder cannot hide a fault in what it makes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  DOT_COLORS,
  RING_COLOR,
  TRAY_SIZES,
  decodePng,
  encodePng,
  readIco,
  trayIcons,
  writeIco,
} from "../../../scripts/tray-icons.ts";

const REPO = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const MARK_ICO = fs.readFileSync(path.join(REPO, "assets", "career-map.ico"));

const NAMES = ["tray", "tray-red", "tray-blue", "tray-violet", "tray-amber", "tray-green"] as const;
const DOTS = ["red", "blue", "violet", "amber", "green"] as const;
const SIZES = [16, 20, 24, 32];

// ---------------------------------------------------------------------------------------------
// This file's own readers and writers

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

interface Image {
  width: number;
  height: number;
  data: Buffer;
}

interface IcoEntry {
  widthByte: number;
  heightByte: number;
  planes: number;
  bpp: number;
  png: Buffer;
}

/** The entries of an .ico, in directory order, checked as make-ico.mjs packs them. */
function icoEntries(ico: Buffer): IcoEntry[] {
  expect(ico.readUInt16LE(0)).toBe(0);
  expect(ico.readUInt16LE(2)).toBe(1);
  const n = ico.readUInt16LE(4);
  const out: IcoEntry[] = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + 16 * i;
    const size = ico.readUInt32LE(o + 8);
    const offset = ico.readUInt32LE(o + 12);
    out.push({
      widthByte: ico[o],
      heightByte: ico[o + 1],
      planes: ico.readUInt16LE(o + 4),
      bpp: ico.readUInt16LE(o + 6),
      png: ico.subarray(offset, offset + size),
    });
  }
  return out;
}

/** make-ico.mjs's packing, for comparing writeIco's bytes with. */
function packIco(pngs: Buffer[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((buf, i) => {
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    const o = i * 16;
    dir.writeUInt8(w >= 256 ? 0 : w, o);
    dir.writeUInt8(h >= 256 ? 0 : h, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += buf.length;
  });
  return Buffer.concat([header, dir, ...pngs]);
}

function pngChunks(png: Buffer): { type: string; data: Buffer }[] {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  const chunks: { type: string; data: Buffer }[] = [];
  let o = 8;
  while (o < png.length) {
    const len = png.readUInt32BE(o);
    const type = png.toString("ascii", o + 4, o + 8);
    chunks.push({ type, data: png.subarray(o + 8, o + 8 + len) });
    o += 12 + len;
    if (type === "IEND") break;
  }
  return chunks;
}

function pngHeader(png: Buffer): { width: number; height: number; bitDepth: number; colorType: number; interlace: number } {
  const ihdr = pngChunks(png)[0];
  expect(ihdr.type).toBe("IHDR");
  return {
    width: ihdr.data.readUInt32BE(0),
    height: ihdr.data.readUInt32BE(4),
    bitDepth: ihdr.data[8],
    colorType: ihdr.data[9],
    interlace: ihdr.data[12],
  };
}

/** An 8-bit RGBA, non-interlaced PNG's pixels (straight alpha, rows top to bottom). */
function pngPixels(png: Buffer): Image {
  const h = pngHeader(png);
  expect({ bitDepth: h.bitDepth, colorType: h.colorType, interlace: h.interlace }).toEqual({ bitDepth: 8, colorType: 6, interlace: 0 });
  const idat = Buffer.concat(pngChunks(png).filter((c) => c.type === "IDAT").map((c) => c.data));
  const raw = zlib.inflateSync(idat);
  const stride = h.width * 4;
  const data = Buffer.alloc(stride * h.height);
  for (let y = 0; y < h.height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? data[y * stride + x - 4] : 0;
      const b = y > 0 ? data[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? data[(y - 1) * stride + x - 4] : 0;
      let pred: number;
      switch (filter) {
        case 0: pred = 0; break;
        case 1: pred = a; break;
        case 2: pred = b; break;
        case 3: pred = (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      data[y * stride + x] = (line[x] + pred) & 0xff;
    }
  }
  return { width: h.width, height: h.height, data };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** A valid PNG of any header, its rows unfiltered (filter 0), for the decoder's refusals. */
function makePng(o: { width: number; height: number; bitDepth: number; colorType: number; interlace: number; bytesPerPixel: number }): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(o.width, 0);
  ihdr.writeUInt32BE(o.height, 4);
  ihdr[8] = o.bitDepth;
  ihdr[9] = o.colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = o.interlace;
  const rows: Buffer[] = [];
  for (let y = 0; y < o.height; y++) rows.push(Buffer.concat([Buffer.from([0]), Buffer.alloc(o.width * o.bytesPerPixel, 0x80)]));
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const bytes = (a: Uint8Array) => Buffer.from(a.buffer, a.byteOffset, a.byteLength);

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** The source ico's entry of a size, decoded. */
function markEntry(size: number): Image {
  const e = icoEntries(MARK_ICO).find((x) => (x.widthByte || 256) === size);
  if (!e) throw new Error(`career-map.ico has no ${size} px entry`);
  return pngPixels(e.png);
}

/** Each pixel's alpha when `src` is reduced to `s` px by area averaging (each source pixel weighted by the
 *  share of it a target pixel covers), unrounded. */
function areaAlpha(src: Image, s: number): number[] {
  const k = src.width / s;
  const out: number[] = [];
  for (let ty = 0; ty < s; ty++) {
    for (let tx = 0; tx < s; tx++) {
      const x0 = tx * k;
      const y0 = ty * k;
      let sum = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y0 + k); sy++) {
        const wy = Math.min(sy + 1, y0 + k) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.ceil(x0 + k); sx++) {
          const wx = Math.min(sx + 1, x0 + k) - Math.max(sx, x0);
          sum += wx * wy * src.data[(sy * src.width + sx) * 4 + 3];
        }
      }
      out.push(sum / (k * k));
    }
  }
  return out;
}

/** Mean alpha, and the alpha-weighted mean of each colour channel (what area averaging keeps). */
function coverage(img: Image): { alpha: number; r: number; g: number; b: number } {
  let a = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < img.data.length; i += 4) {
    const al = img.data[i + 3];
    a += al;
    r += al * img.data[i];
    g += al * img.data[i + 1];
    b += al * img.data[i + 2];
  }
  return { alpha: a / (img.width * img.height), r: r / a, g: g / a, b: b / a };
}

// ---------------------------------------------------------------------------------------------

describe("the window's icon", () => {
  // @spec DESK-DIST-PKG-015
  it("is assets/career-map.ico, holding a 256 px image", () => {
    const entries = readIco(MARK_ICO);
    const big = entries.find((e) => e.width === 256);
    expect(big).toBeDefined();
    const h = pngHeader(big!.png);
    expect([h.width, h.height]).toEqual([256, 256]);
  });

  // @spec DESK-DIST-PKG-015, DESK-DIST-PKG-016
  it("is read by readIco as its PNG entries of 256, 64, 48, 32 and 16 px, in the file's order", () => {
    const entries = readIco(MARK_ICO);
    expect(entries.map((e) => e.width)).toEqual([256, 64, 48, 32, 16]);
    const own = icoEntries(MARK_ICO);
    entries.forEach((e, i) => expect(Buffer.from(e.png).equals(own[i].png)).toBe(true));
  });
});

describe("the PNG and .ico helpers", () => {
  // @spec DESK-DIST-PKG-016
  it("decodes an 8-bit RGBA PNG to its straight RGBA pixels, rows top to bottom", () => {
    for (const size of [16, 32, 256]) {
      const e = icoEntries(MARK_ICO).find((x) => (x.widthByte || 256) === size)!;
      const mine = pngPixels(e.png);
      const theirs = decodePng(e.png);
      expect([theirs.width, theirs.height]).toEqual([size, size]);
      expect(bytes(theirs.data).equals(mine.data)).toBe(true);
    }
  });

  // @spec DESK-DIST-PKG-016
  it("refuses a PNG that is not 8-bit RGBA or is interlaced", () => {
    const rgb = makePng({ width: 2, height: 2, bitDepth: 8, colorType: 2, interlace: 0, bytesPerPixel: 3 });
    const deep = makePng({ width: 2, height: 2, bitDepth: 16, colorType: 6, interlace: 0, bytesPerPixel: 8 });
    const interlaced = makePng({ width: 2, height: 2, bitDepth: 8, colorType: 6, interlace: 1, bytesPerPixel: 4 });
    const plain = makePng({ width: 2, height: 2, bitDepth: 8, colorType: 6, interlace: 0, bytesPerPixel: 4 });
    expect(bytes(decodePng(plain).data).equals(Buffer.alloc(16, 0x80))).toBe(true);
    expect(() => decodePng(rgb)).toThrow();
    expect(() => decodePng(deep)).toThrow();
    expect(() => decodePng(interlaced)).toThrow();
  });

  // @spec DESK-DIST-PKG-016
  it("encodes RGBA pixels as an 8-bit RGBA PNG that decodes to the same pixels", () => {
    const width = 5;
    const height = 3;
    const data = new Uint8Array(width * height * 4);
    for (let i = 0; i < data.length; i++) data[i] = (i * 37 + 11) & 0xff;
    const png = encodePng({ width, height, data });
    const h = pngHeader(png);
    expect(h).toEqual({ width, height, bitDepth: 8, colorType: 6, interlace: 0 });
    expect(pngPixels(png).data.equals(Buffer.from(data))).toBe(true);
    const back = decodePng(png);
    expect([back.width, back.height]).toEqual([width, height]);
    expect(bytes(back.data).equals(Buffer.from(data))).toBe(true);
  });

  // @spec DESK-DIST-PKG-016
  it("packs PNG entries into an .ico exactly as scripts/make-ico.mjs does", () => {
    const own = icoEntries(MARK_ICO);
    const pngs = [own[4].png, own[0].png, own[3].png].map((p) => Buffer.from(p));
    expect(writeIco(pngs).equals(packIco(pngs))).toBe(true);
  });
});

describe("the tray icons", () => {
  // @spec DESK-DIST-PKG-016
  it("are the mark alone and the mark with each status dot, with the styles' colours", () => {
    expect(Object.keys(trayIcons(MARK_ICO)).sort()).toEqual([...NAMES].sort());
    expect([...TRAY_SIZES]).toEqual(SIZES);
    expect(DOT_COLORS).toEqual({ red: "#ff5c5c", blue: "#7cc4ff", violet: "#b79cff", amber: "#fbbf24", green: "#3bceac" });
    expect(RING_COLOR).toBe("#0a0e13");
    const styles = fs.readFileSync(path.join(REPO, "src", "client", "styles.css"), "utf8").toLowerCase();
    for (const colour of [...Object.values(DOT_COLORS), RING_COLOR]) expect(styles).toContain(colour);
  });

  // @spec DESK-DIST-PKG-016
  it("each hold PNG entries of 16, 20, 24 and 32 px, in that order", () => {
    const icons = trayIcons(MARK_ICO);
    for (const name of NAMES) {
      const entries = icoEntries(icons[name]);
      expect(entries.map((e) => [e.widthByte, e.heightByte])).toEqual(SIZES.map((s) => [s, s]));
      for (const [i, e] of entries.entries()) {
        expect({ planes: e.planes, bpp: e.bpp }).toEqual({ planes: 1, bpp: 32 });
        expect(pngHeader(e.png)).toEqual({ width: SIZES[i], height: SIZES[i], bitDepth: 8, colorType: 6, interlace: 0 });
      }
      expect(icons[name].equals(packIco(entries.map((e) => Buffer.from(e.png))))).toBe(true);
    }
  });

  // @spec DESK-DIST-PKG-016
  it("take the mark's own 16 and 32 px images as they are", () => {
    const tray = icoEntries(trayIcons(MARK_ICO).tray);
    expect(pngPixels(tray[0].png).data.equals(markEntry(16).data)).toBe(true);
    expect(pngPixels(tray[3].png).data.equals(markEntry(32).data)).toBe(true);
  });

  // @spec DESK-DIST-PKG-016
  it("reduce the 256 px image by area averaging for 20 and 24 px", () => {
    const big = markEntry(256);
    const source = coverage(big);
    const tray = icoEntries(trayIcons(MARK_ICO).tray);
    for (const i of [1, 2]) {
      const img = pngPixels(tray[i].png);
      // Every pixel's alpha is its share of the source's (rounding, in one pass or two, aside): a
      // sampling reduction (nearest pixel, bilinear) misses this along the mark's edges.
      const want = areaAlpha(big, SIZES[i]);
      const off = want.map((a, p) => ({ p, want: a, got: img.data[p * 4 + 3] })).filter((x) => Math.abs(x.got - x.want) > 2);
      expect(off).toEqual([]);
      const c = coverage(img);
      expect(Math.abs(c.alpha - source.alpha)).toBeLessThanOrEqual(1);
      expect(Math.abs(c.r - source.r)).toBeLessThanOrEqual(3);
      expect(Math.abs(c.g - source.g)).toBeLessThanOrEqual(3);
      expect(Math.abs(c.b - source.b)).toBeLessThanOrEqual(3);
    }
  });

  // @spec DESK-DIST-PKG-016
  it("draw each dot in its colour inside a ring, at the bottom right, over the mark", () => {
    const icons = trayIcons(MARK_ICO);
    const ring = hexRgb(RING_COLOR);
    const marks = icoEntries(icons.tray).map((e) => pngPixels(e.png));
    const wrong: string[] = [];
    for (const dot of DOTS) {
      const colour = hexRgb(DOT_COLORS[dot]);
      icoEntries(icons[`tray-${dot}`]).forEach((e, i) => {
        const s = SIZES[i];
        const img = pngPixels(e.png);
        const mark = marks[i];
        const r = s / 4;
        const c = s - r;
        const ringWidth = Math.max(1, Math.round(s / 16));
        const px = (x: number, y: number) => [...img.data.subarray((y * s + x) * 4, (y * s + x) * 4 + 4)];
        // The pixel at the dot's centre, exactly the dot's colour.
        if (JSON.stringify(px(c, c)) !== JSON.stringify([...colour, 255])) wrong.push(`${dot} ${s}px centre (${c},${c}): ${px(c, c)}`);
        // §15.5 does not say where a pixel's centre lies, so a pixel is checked only where both readings
        // agree — its centre at (x + 0.5, y + 0.5) or at (x, y) — and never on a boundary.
        let ringPixels = 0;
        for (let y = 0; y < s; y++) {
          for (let x = 0; x < s; x++) {
            const ds = [Math.hypot(x + 0.5 - c, y + 0.5 - c), Math.hypot(x - c, y - c)];
            const got = px(x, y);
            if (ds.every((d) => d < r - ringWidth)) {
              if (JSON.stringify(got) !== JSON.stringify([...colour, 255])) wrong.push(`${dot} ${s}px dot (${x},${y}): ${got}`);
            } else if (ds.every((d) => d > r - ringWidth && d < r)) {
              ringPixels++;
              if (JSON.stringify(got) !== JSON.stringify([...ring, 255])) wrong.push(`${dot} ${s}px ring (${x},${y}): ${got}`);
            } else if (ds.every((d) => d > r + 2)) {
              const want = [...mark.data.subarray((y * s + x) * 4, (y * s + x) * 4 + 4)];
              if (JSON.stringify(got) !== JSON.stringify(want)) wrong.push(`${dot} ${s}px mark (${x},${y}): ${got} not ${want}`);
            }
          }
        }
        if (ringPixels === 0) wrong.push(`${dot} ${s}px: no ring pixel checked`);
      });
    }
    expect(wrong).toEqual([]);
  });

  // @spec DESK-DIST-PKG-016
  it("come out byte for byte the same from the same input", () => {
    const a = trayIcons(MARK_ICO);
    const b = trayIcons(Buffer.from(MARK_ICO));
    for (const name of NAMES) expect(a[name].equals(b[name])).toBe(true);
  });
});
