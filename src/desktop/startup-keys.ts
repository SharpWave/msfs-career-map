import fs from "node:fs";
import type { StartupKeys } from "./ports.ts";
import { APPROVED_KEY, RUN_KEY, VALUE_NAME } from "./windows-start.ts";
import { run } from "./windows-facts.ts";

/**
 * The real `StartupKeys`: Windows' Run and StartupApproved\Run keys read, exported and cleared with
 * reg.exe, and the Run value written through Electron's login item (passed in by main.ts, so this
 * module loads without Electron). reg.exe's arguments, the reader of its output and the joining of
 * two exports are plain functions; only `startupKeys()` runs anything.
 */

const HEADER = "Windows Registry Editor Version 5.00";
const BOM = [0xff, 0xfe];

/** What `startupKeys` needs of Electron's `app`. */
export interface LoginItems {
  setLoginItemSettings(settings: { openAtLogin: boolean; name: string; path: string; args: string[]; enabled: boolean }): void;
}

export function regQueryArgs(key: string): string[] {
  return ["query", key];
}

export function regDeleteArgs(key: string): string[] {
  return ["delete", key, "/v", VALUE_NAME, "/f"];
}

export function regExportArgs(key: string, file: string): string[] {
  return ["export", key, file, "/y"];
}

/**
 * The data of the key's own value named `name` (ignoring case) in `reg query <key>`'s output: text for
 * REG_SZ and the like, bytes for REG_BINARY; null when the key holds no value of that name. A subkey's
 * line, which carries no type, never matches.
 */
export function parseRegQuery(stdout: string, name: string): string | Uint8Array | null {
  const wanted = name.toLowerCase();
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line);
    if (!m || m[1].toLowerCase() !== wanted) continue;
    const data = m[3] ?? "";
    if (m[2] !== "REG_BINARY") return data;
    const hex = data.replace(/[^0-9a-f]/gi, "");
    return Uint8Array.from(hex.match(/../g) ?? [], (b) => parseInt(b, 16));
  }
  return null;
}

/** reg.exe's exports (UTF-16LE, each with its BOM and header) as one file: one BOM, one header, the sections in order. */
export function joinRegExports(parts: Uint8Array[]): Uint8Array {
  const bodies = parts.map((p) => {
    let bytes = Buffer.from(p);
    if (bytes[0] === BOM[0] && bytes[1] === BOM[1]) bytes = bytes.subarray(2);
    let text = bytes.toString("utf16le");
    if (text.startsWith(HEADER)) text = text.slice(HEADER.length).replace(/^(\r?\n)+/, "");
    return text;
  });
  const text = `${HEADER}\r\n\r\n${bodies.join("")}`;
  return new Uint8Array(Buffer.concat([Buffer.from(BOM), Buffer.from(text, "utf16le")]));
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The real keys, by reg.exe (hidden, 10 s each) and Electron's login item. */
// @spec DESK-START-WINDOWS-002, DESK-START-WINDOWS-004, DESK-START-WINDOWS-006, DESK-START-WINDOWS-008
export function startupKeys(o: { loginItems: LoginItems }): StartupKeys {
  /** A key's query output; null for StartupApproved\Run when it is absent (reg.exe gives no other sign). */
  async function query(key: string): Promise<string | null> {
    const r = await run("reg.exe", regQueryArgs(key));
    if (r.ok) return r.stdout;
    if (key === APPROVED_KEY) return null;
    throw new Error(`reg query ${key}: ${r.message}`);
  }

  async function read(): Promise<{ run: string | null; approved: Uint8Array | null }> {
    const [runOut, approvedOut] = await Promise.all([query(RUN_KEY), query(APPROVED_KEY)]);
    const runValue = runOut === null ? null : parseRegQuery(runOut, VALUE_NAME);
    const approved = approvedOut === null ? null : parseRegQuery(approvedOut, VALUE_NAME);
    return {
      run: runValue === null ? null : typeof runValue === "string" ? runValue : Buffer.from(runValue).toString("hex"),
      approved: approved === null ? null : typeof approved === "string" ? new Uint8Array(0) : approved,
    };
  }

  return {
    read,
    async exportTo(file) {
      const parts: Uint8Array[] = [];
      for (const [i, key] of [RUN_KEY, APPROVED_KEY].entries()) {
        if ((await query(key)) === null) continue;
        const part = `${file}.${i}.tmp`;
        try {
          const r = await run("reg.exe", regExportArgs(key, part));
          if (!r.ok) throw new Error(`reg export ${key}: ${r.message}`);
          parts.push(new Uint8Array(fs.readFileSync(part)));
        } finally {
          fs.rmSync(part, { force: true });
        }
      }
      fs.writeFileSync(file, joinRegExports(parts));
    },
    async writeOn(program) {
      o.loginItems.setLoginItemSettings({ openAtLogin: true, name: VALUE_NAME, path: program, args: ["--background"], enabled: true });
      if ((await read()).run === null) throw new Error(`the Run key does not hold ${VALUE_NAME} after the login item was written`);
    },
    async remove() {
      const before = await read();
      const problems: string[] = [];
      for (const [key, present] of [
        [RUN_KEY, before.run !== null],
        [APPROVED_KEY, before.approved !== null],
      ] as const) {
        if (!present) continue;
        const r = await run("reg.exe", regDeleteArgs(key));
        if (!r.ok) problems.push(`reg delete ${key}: ${r.message}`);
      }
      const after = await read().catch((e: unknown) => {
        problems.push(message(e));
        return null;
      });
      if (after === null || after.run !== null || after.approved !== null) {
        throw new Error(problems.length > 0 ? problems.join("; ") : `${VALUE_NAME} is still in the start-up keys`);
      }
    },
  };
}
