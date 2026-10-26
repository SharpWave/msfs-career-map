/**
 * The third-party notices the packaged program carries, `THIRD-PARTY-NOTICES.txt`: every npm package the
 * program ships, with its licence, the parts of the program carrying it and its licence files' text
 * (distribution-design, Packaging: The licences).
 */
import fs from "node:fs";
import path from "node:path";

/** The parts of the program a package can ship in, in the order the notices name them. */
export type Part = "page" | "server" | "desktop shell" | "beside the server";
const PART_ORDER: readonly Part[] = ["page", "server", "desktop shell", "beside the server"];

/** Licences like the app's own, which the notices' opening does not list. */
const PERMISSIVE = new Set(["MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Apache-2.0", "BlueOak-1.0.0"]);

/** A licence or notice file at a package's root. */
const LICENCE_FILE = /^(licen[cs]e|copying|notice)/i;

const MIT_TEXT = [
  "MIT License",
  "",
  "Copyright (c) {holder}",
  "",
  'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
  "",
  "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.",
  "",
  'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
].join("\n");

const ISC_TEXT = [
  "ISC License",
  "",
  "Copyright (c) {holder}",
  "",
  "Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.",
  "",
  'THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.',
].join("\n");

const STANDARD_TEXTS: Record<string, string> = { MIT: MIT_TEXT, ISC: ISC_TEXT };

interface Manifest {
  name: string;
  version: string;
  license?: string | { type?: string };
  licenses?: ({ type?: string } | string)[];
  author?: string | { name?: string };
}

/** The package folder a bundled file belongs to: the innermost `node_modules/<name>` in its path, else null. */
export function packageDirOf(file: string): string | null {
  const parts = file.replace(/^\0/, "").replace(/\?.*$/, "").split(/[\\/]/);
  const at = parts.lastIndexOf("node_modules");
  if (at < 0) return null;
  const nameParts = parts[at + 1]?.startsWith("@") ? 2 : 1;
  if (at + nameParts >= parts.length) return null;
  return path.resolve(parts.slice(0, at + 1 + nameParts).join(path.sep));
}

/** A package's licence as its package.json names it. */
function licenceOf(m: Manifest): string {
  if (typeof m.license === "string") return m.license;
  if (m.license?.type) return m.license.type;
  if (m.licenses?.length) return m.licenses.map((l) => (typeof l === "string" ? l : l.type ?? "?")).join(" OR ");
  return "none named";
}

/** The author's name alone, without the email address or URL package.json may give with it. */
function authorOf(m: Manifest): string | null {
  const a = typeof m.author === "string" ? m.author.replace(/<[^>]*>|\([^)]*\)/g, "") : m.author?.name ?? "";
  return a.trim() || null;
}

const lines = (text: string) => text.replace(/\r\n?/g, "\n").replace(/\n+$/, "").split("\n");

interface Entry {
  name: string;
  version: string;
  licence: string;
  parts: Part[];
  body: string[];
}

const manifestOf = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as Manifest;

function entryFor(dir: string, parts: Set<Part>): Entry {
  const m = manifestOf(dir);
  const licence = licenceOf(m);
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((f) => f.isFile() && LICENCE_FILE.test(f.name))
    .map((f) => f.name)
    .sort();
  const body: string[] = [];
  if (files.length > 0) {
    for (const f of files) body.push("", `${f}:`, ...lines(fs.readFileSync(path.join(dir, f), "utf8")));
  } else {
    const standard = STANDARD_TEXTS[licence];
    const author = authorOf(m);
    if (!standard) throw new Error(`${m.name} ${m.version} ships no licence file, and the build has no standard text for its licence (${licence})`);
    if (!author) throw new Error(`${m.name} ${m.version} ships no licence file, and its package.json names no author to hold the standard ${licence} text`);
    body.push("", `The package ships no licence file; the standard ${licence} licence text, as its package.json names it:`, ...lines(standard.replace("{holder}", author)));
  }
  return { name: m.name, version: m.version, licence, parts: PART_ORDER.filter((p) => parts.has(p)), body };
}

const byNameThenVersion = (a: Entry, b: Entry) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : a.version.localeCompare(b.version, "en", { numeric: true });

const SEPARATOR = "-".repeat(78);

/**
 * The notices for the given shipped packages, each name and version listed once with every part carrying
 * it (copies of one version in several folders, nested under different packages, read from the first
 * folder); throws, naming the package, for one with no licence text the build can give.
 * @spec DESK-DIST-PKG-026, DESK-DIST-PKG-027, DESK-DIST-PKG-028
 */
export function thirdPartyNotices(shipped: readonly { dir: string; part: Part }[]): string {
  const byPackage = new Map<string, { dirs: Set<string>; parts: Set<Part> }>();
  for (const s of shipped) {
    const dir = path.resolve(s.dir);
    const m = manifestOf(dir);
    const key = `${m.name}@${m.version}`;
    const found = byPackage.get(key) ?? byPackage.set(key, { dirs: new Set(), parts: new Set() }).get(key)!;
    found.dirs.add(dir);
    found.parts.add(s.part);
  }
  const entries = [...byPackage.values()].map((p) => entryFor([...p.dirs].sort()[0], p.parts)).sort(byNameThenVersion);
  const carried = (e: Entry) => e.parts.map((p) => (p === "beside the server" ? p : `the ${p}`)).join(", ");
  const others = entries.filter((e) => !PERMISSIVE.has(e.licence));

  const out = [
    "MSFS Career Map: third-party notices",
    "",
    "MSFS Career Map is released under the MIT License; its full text is in LICENSE.txt in this folder.",
    "Electron and Chromium, which the program is built on, carry their own licences in LICENSE.electron.txt and LICENSES.chromium.html in this folder.",
    "",
    "The program carries the npm packages listed below, each under its own licence, whose text follows its entry.",
  ];
  if (others.length === 0) {
    out.push("Every one is under a permissive licence like the app's (MIT, ISC, the BSD licences, 0BSD, Apache-2.0, Blue Oak).");
  } else {
    out.push("These are under licences other than permissive ones like the app's (MIT, ISC, the BSD licences, 0BSD, Apache-2.0, Blue Oak):");
    for (const e of others) out.push(`- ${e.name} ${e.version}: ${e.licence} (${carried(e)})`);
    if (others.some((e) => /Hippocratic/i.test(e.licence))) {
      out.push("", "A package under the Hippocratic License 2.1 sets conditions on how the software is used, which bind whoever uses the app; it is not an OSI-approved licence.");
    }
    if (others.some((e) => /LGPL-3\.0/.test(e.licence))) {
      out.push("", "A package under LGPL-3.0 ships as separate files in resources\\node_modules, so it can be replaced with another build of it.");
    }
  }
  for (const e of entries) {
    out.push("", SEPARATOR, `${e.name} ${e.version}`, `Licence: ${e.licence}`, `Carried by: ${carried(e)}`, ...e.body);
  }
  out.push("", SEPARATOR, "OurAirports' seed airport lists, airports.csv and runways.csv (https://ourairports.com/data/), are in the public domain.");
  return `${out.join("\r\n")}\r\n`;
}
