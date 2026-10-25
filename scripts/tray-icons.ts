import zlib from "node:zlib";

/**
 * The tray icons, made at build time from the app's mark (`assets/career-map.ico`): the mark alone and
 * the mark with each status dot, each icon holding 16, 20, 24 and 32 px PNG entries. The PNGs are read
 * and written here with node:zlib alone, and the same mark always gives the same bytes.
 */

export const TRAY_SIZES = [16, 20, 24, 32] as const;
/** The status dots' colours, as styles.css names them. */
export const DOT_COLORS = { red: "#ff5c5c", blue: "#7cc4ff", violet: "#b79cff", amber: "#fbbf24", green: "#3bceac" } as const;
/** The ring around a dot: the page's darkest surface, as styles.css names it. */
export const RING_COLOR = "#0a0e13";

/** Straight (not premultiplied) RGBA pixels, rows top to bottom. */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

type TrayIconName = "tray" | "tray-red" | "tray-blue" | "tray-violet" | "tray-amber" | "tray-green";

// ---------------------------------------------------------------- .ico

/** The PNG entries of an .ico, in the file's order; `width` 256 where the directory says 0. */
export function readIco(ico: Buffer): { width: number; png: Buffer }[] {
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1) throw new Error("not an .ico file");
  const n = ico.readUInt16LE(4);
  const entries: { width: number; png: Buffer }[] = [];
  for (let i = 0; i < n; i++) {
    const o = 6 + 16 * i;
    const size = ico.readUInt32LE(o + 8);
    const offset = ico.readUInt32LE(o + 12);
    const png = ico.subarray(offset, offset + size);
    if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`.ico entry ${i} is not a PNG`);
    entries.push({ width: ico[o] || 256, png });
  }
  return entries;
}

/** PNG entries packed into an .ico, as scripts/make-ico.mjs packs them. */
export function writeIco(pngs: Buffer[]): Buffer {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const dir = Buffer.alloc(16 * pngs.length);
  let offset = 6 + dir.length;
  pngs.forEach((png, i) => {
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    const o = 16 * i;
    dir.writeUInt8(w >= 256 ? 0 : w, o);
    dir.writeUInt8(h >= 256 ? 0 : h, o + 1);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(png.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += png.length;
  });
  return Buffer.concat([header, dir, ...pngs]);
}

// ---------------------------------------------------------------- PNG

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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

function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

/** An 8-bit RGBA, non-interlaced PNG's pixels; any other kind of PNG throws. */
export function decodePng(png: Buffer): Rgba {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error("not a PNG");
  let header: Buffer | null = null;
  const idat: Buffer[] = [];
  for (let o = 8; o + 8 <= png.length; ) {
    const len = png.readUInt32BE(o);
    const type = png.toString("ascii", o + 4, o + 8);
    const data = png.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") header = data;
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  if (!header) throw new Error("PNG has no header");
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const [bitDepth, colorType, , , interlace] = header.subarray(8, 13);
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) {
    throw new Error(`only 8-bit RGBA, non-interlaced PNGs are read (bit depth ${bitDepth}, colour type ${colorType}, interlace ${interlace})`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  if (raw.length < (stride + 1) * height) throw new Error("PNG image data is short");
  const data = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = y * (stride + 1) + 1;
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? data[row + x - 4] : 0;
      const b = y > 0 ? data[row - stride + x] : 0;
      const c = x >= 4 && y > 0 ? data[row - stride + x - 4] : 0;
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
      data[row + x] = (raw[line + x] + pred) & 0xff;
    }
  }
  return { width, height, data };
}

/** RGBA pixels as an 8-bit RGBA PNG, every row unfiltered, compressed at zlib's highest level. */
export function encodePng(img: Rgba): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(img.width, 0);
  header.writeUInt32BE(img.height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = img.width * 4;
  const raw = Buffer.alloc((stride + 1) * img.height);
  for (let y = 0; y < img.height; y++) raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk("IHDR", header),
    pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- drawing

/** A square image reduced to `size` px by area averaging: each source pixel weighted by the share of it a
 *  target pixel covers, colours averaged premultiplied by alpha. */
function reduce(src: Rgba, size: number): Rgba {
  const k = src.width / size;
  const data = new Uint8Array(size * size * 4);
  for (let ty = 0; ty < size; ty++) {
    const y0 = ty * k;
    for (let tx = 0; tx < size; tx++) {
      const x0 = tx * k;
      let a = 0;
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y0 + k); sy++) {
        const wy = Math.min(sy + 1, y0 + k) - Math.max(sy, y0);
        for (let sx = Math.floor(x0); sx < Math.ceil(x0 + k); sx++) {
          const w = wy * (Math.min(sx + 1, x0 + k) - Math.max(sx, x0));
          const i = (sy * src.width + sx) * 4;
          const wa = w * src.data[i + 3];
          a += wa;
          r += wa * src.data[i];
          g += wa * src.data[i + 1];
          b += wa * src.data[i + 2];
        }
      }
      const o = (ty * size + tx) * 4;
      if (a > 0) {
        data[o] = Math.round(r / a);
        data[o + 1] = Math.round(g / a);
        data[o + 2] = Math.round(b / a);
      }
      data[o + 3] = Math.round(a / (k * k));
    }
  }
  return { width: size, height: size, data };
}

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** The mark with a status dot at its bottom right: radius s/4, the dot's colour inside a ring of the ring
 *  colour `max(1, round(s/16))` wide, both opaque, and the ring's outer edge blended over the mark. */
function withDot(mark: Rgba, colour: string): Rgba {
  const s = mark.width;
  const r = s / 4;
  const c = s - r;
  const inner = r - Math.max(1, Math.round(s / 16));
  const dot = hexRgb(colour);
  const ring = hexRgb(RING_COLOR);
  const data = Uint8Array.from(mark.data);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
      const o = (y * s + x) * 4;
      if (d < r) {
        data.set(d < inner ? dot : ring, o);
        data[o + 3] = 255;
      } else if (d < r + 0.5) {
        // Edge smoothing: the ring over the mark by the share of the pixel it roughly covers.
        const fa = r + 0.5 - d;
        const ma = data[o + 3] / 255;
        const oa = fa + ma * (1 - fa);
        for (let ch = 0; ch < 3; ch++) data[o + ch] = Math.round((ring[ch] * fa + data[o + ch] * ma * (1 - fa)) / oa);
        data[o + 3] = Math.round(oa * 255);
      }
    }
  }
  return { width: s, height: s, data };
}

/**
 * The six tray icons from the app's mark: each size the mark's own entry of that size when it has one,
 * else its largest entry reduced by area averaging; `tray` is the mark alone, the others add their dot.
 */
// @spec DESK-DIST-PKG-016
export function trayIcons(markIco: Buffer): Record<TrayIconName, Buffer> {
  const entries = readIco(markIco).map((e) => ({ width: e.width, img: decodePng(e.png) }));
  const largest = entries.reduce((a, b) => (b.width > a.width ? b : a));
  const marks = TRAY_SIZES.map((s) => entries.find((e) => e.width === s)?.img ?? reduce(largest.img, s));
  const icon = (draw: (m: Rgba) => Rgba) => writeIco(marks.map((m) => encodePng(draw(m))));
  return {
    tray: icon((m) => m),
    "tray-red": icon((m) => withDot(m, DOT_COLORS.red)),
    "tray-blue": icon((m) => withDot(m, DOT_COLORS.blue)),
    "tray-violet": icon((m) => withDot(m, DOT_COLORS.violet)),
    "tray-amber": icon((m) => withDot(m, DOT_COLORS.amber)),
    "tray-green": icon((m) => withDot(m, DOT_COLORS.green)),
  };
}
