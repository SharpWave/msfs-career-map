/**
 * The start lists' test footing (m4 contract §9): the `EXE.xml` fixtures, loaded with the test's
 * program put in and in the line endings, byte-order mark and encoding a test asks for, and a temp
 * folder standing in for the account's Local and Roaming folders, with both MSFS 2024 editions'
 * folders and Electron's own folder inside.
 *
 * Fixtures are kept with LF line endings and `{{PROGRAM}}` where the app's path goes; git may check
 * them out with CR LF, so the loader reads them with either.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { tempFolder } from "../../support/fakes.ts";

const win = path.win32;
const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

/** The installed program the tests' entries name (no character outside windows-1252). */
export const TEST_PROGRAM = "C:\\Users\\Pilot\\AppData\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe";

export type FixtureEncoding = "utf-8" | "windows-1252" | "utf-16le";

export interface FixtureOptions {
  /** The path put in for `{{PROGRAM}}`, XML-escaped; TEST_PROGRAM by default. */
  program?: string;
  /** "crlf" by default. */
  eol?: "crlf" | "lf";
  bom?: boolean;
  /** "utf-8" by default; the fixture's declaration is left as written. */
  encoding?: FixtureEncoding;
}

export function xmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The fixture's text: LF-normalised, the program put in, then the line endings asked for. */
export function fixtureText(name: string, o: FixtureOptions = {}): string {
  const raw = fs.readFileSync(path.join(FIXTURES, name), "utf8").replace(/\r\n/g, "\n");
  const text = raw.replace(/\{\{PROGRAM\}\}/g, xmlEscape(o.program ?? TEST_PROGRAM));
  return (o.eol ?? "crlf") === "crlf" ? text.replace(/\n/g, "\r\n") : text;
}

/** windows-1252 for text whose characters are all below U+0100 outside U+0080..U+009F (enough for fixtures). */
export function encode1252(text: string): Uint8Array {
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (c > 0xff || (c >= 0x80 && c <= 0x9f)) throw new Error(`encode1252: U+${c.toString(16)} is not in the fixtures' range`);
  }
  return new Uint8Array(Buffer.from(text, "latin1"));
}

export function encodeText(text: string, encoding: FixtureEncoding = "utf-8", bom = false): Uint8Array {
  if (encoding === "utf-16le") {
    const body = Buffer.from(text, "utf16le");
    return new Uint8Array(bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), body]) : body);
  }
  const body = encoding === "windows-1252" ? Buffer.from(encode1252(text)) : Buffer.from(text, "utf8");
  return new Uint8Array(bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body);
}

/** The fixture's bytes. */
export function fixture(name: string, o: FixtureOptions = {}): Uint8Array {
  return encodeText(fixtureText(name, o), o.encoding ?? "utf-8", o.bom ?? false);
}

export function text(bytes: Uint8Array | null): string {
  return bytes === null ? "<none>" : Buffer.from(bytes).toString("utf8");
}

export type Edition = "Store" | "Steam";

/**
 * A temp root standing in for the account: `Local` and `Roaming` (its `env`), both editions' folders
 * by the pinned paths (DESK-START-MSFS-002), and Electron's own folder. Nothing is created inside the
 * editions' folders until a test asks.
 */
export class Sims {
  readonly root = tempFolder("start-lists-");
  readonly local = win.join(this.root, "Local");
  readonly roaming = win.join(this.root, "Roaming");
  readonly env = { LOCALAPPDATA: this.local, APPDATA: this.roaming };
  readonly electron = win.join(this.roaming, "MSFS Career Map");
  readonly backups = win.join(this.electron, "start-up list backups");
  readonly folders: Record<Edition, string> = {
    Store: win.join(this.local, "Packages", "Microsoft.Limitless_8wekyb3d8bbwe", "LocalCache"),
    Steam: win.join(this.roaming, "Microsoft Flight Simulator 2024"),
  };

  constructor() {
    fs.mkdirSync(this.local, { recursive: true });
    fs.mkdirSync(this.roaming, { recursive: true });
  }

  /** The editions' folders as `editionFolders` gives them: Store, then Steam. */
  editionFolders(): { edition: Edition; folder: string }[] {
    return [
      { edition: "Store", folder: this.folders.Store },
      { edition: "Steam", folder: this.folders.Steam },
    ];
  }

  /** The edition installed: its folder holding UserCfg.opt. */
  install(edition: Edition): this {
    fs.mkdirSync(this.folders[edition], { recursive: true });
    fs.writeFileSync(win.join(this.folders[edition], "UserCfg.opt"), "Version 1\r\n");
    return this;
  }

  exeFile(edition: Edition): string {
    return win.join(this.folders[edition], "EXE.xml");
  }

  tempFile(edition: Edition): string {
    return win.join(this.folders[edition], "EXE.xml.msfs-career-map-tmp");
  }

  /** Writes the edition's EXE.xml (its folder made, UserCfg.opt not). */
  put(edition: Edition, bytes: Uint8Array | string): this {
    fs.mkdirSync(this.folders[edition], { recursive: true });
    fs.writeFileSync(this.exeFile(edition), typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes);
    return this;
  }

  /** The edition's EXE.xml bytes, or null when there is none. */
  exe(edition: Edition): Uint8Array | null {
    try {
      return new Uint8Array(fs.readFileSync(this.exeFile(edition)));
    } catch {
      return null;
    }
  }

  /** The names in an edition's folder, sorted. */
  folderNames(edition: Edition): string[] {
    try {
      return fs.readdirSync(this.folders[edition]).sort();
    } catch {
      return [];
    }
  }

  /** The names in the backups folder, sorted. */
  backupNames(): string[] {
    try {
      return fs.readdirSync(this.backups).sort();
    } catch {
      return [];
    }
  }
}
