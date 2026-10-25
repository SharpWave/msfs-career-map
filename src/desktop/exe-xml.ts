import { SaxesParser } from "saxes";

/**
 * The `EXE.xml` editor's pure part, on bytes: reading a file (blank, refused, or read with the app's
 * entries), adding the app's entry and removing it as text, every other byte as it was, and checking
 * the result by parsing it again. A file is decoded as UTF-8 or windows-1252, parsed with saxes, and
 * edited at the parser's offsets; the bytes outside an edit are copied from the file as they were.
 * Nothing here touches a file.
 */

export const ENTRY_NAME = "MSFS Career Map";
export type Encoding = "utf-8" | "windows-1252";

/** Who the app's entries are: the installed program, and any earlier installed program. */
export interface Programs {
  program: string;
  earlier: readonly string[];
}

/** Earlier installed programs whose entries are still the app's (none: the path has never changed). */
// @spec DESK-START-MSFS-054
export const EARLIER_PROGRAMS: readonly string[] = [];

export type Refusal =
  | { kind: "not-xml"; detail: string }
  | { kind: "wrong-root" }
  | { kind: "encoding"; encoding: string }
  | { kind: "path-encoding" }
  | { kind: "check-failed"; detail: string };

/** Why a file was left as it was, for the message box and the log. */
export function refusalText(r: Refusal): string {
  switch (r.kind) {
    case "not-xml":
      return `it does not parse as XML (${r.detail})`;
    case "wrong-root":
      return 'its root is not SimBase.Document with Type="Launch"';
    case "encoding":
      return `its encoding, ${r.encoding}, is neither UTF-8 nor windows-1252`;
    case "path-encoding":
      return "its encoding, windows-1252, cannot hold the program's path";
    case "check-failed":
      return `the changed file did not check out (${r.detail})`;
  }
}

export interface AppEntry {
  on: boolean;
  same: boolean;
}

export type ReadResult =
  | { kind: "blank" }
  | { kind: "refused"; refusal: Refusal }
  | { kind: "read"; encoding: Encoding; bom: boolean; entries: AppEntry[] };

export type EditResult = { kind: "unchanged" } | { kind: "changed"; bytes: Uint8Array } | { kind: "refused"; refusal: Refusal };

// -------------------------------------------------------------------------------------------------
// Bytes and text

const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;
const WHITESPACE_BYTES = new Set([0x09, 0x0a, 0x0d, 0x20]);
const UTF8_NAMES = new Set(["utf-8", "utf8"]);
const CP1252_NAMES = new Set(["windows-1252", "cp1252"]);

interface Decoded {
  encoding: Encoding;
  bom: boolean;
  /** The bytes after the byte-order mark. */
  body: Uint8Array;
  text: string;
}

type DecodeResult = { kind: "blank" } | { kind: "refused"; refusal: Refusal } | { kind: "ok"; d: Decoded };

let cp1252Table: Map<string, number> | null = null;

/** Each windows-1252 character to its byte, from the decoder itself, so every byte round-trips. */
function cp1252(): Map<string, number> {
  if (cp1252Table) return cp1252Table;
  const decoder = new TextDecoder("windows-1252");
  const table = new Map<string, number>();
  for (let b = 0; b < 256; b++) table.set(decoder.decode(Uint8Array.of(b)), b);
  cp1252Table = table;
  return table;
}

function canEncode(text: string, encoding: Encoding): boolean {
  if (encoding === "utf-8") return true;
  const table = cp1252();
  for (const ch of text) if (!table.has(ch)) return false;
  return true;
}

function encode(text: string, encoding: Encoding): Uint8Array {
  if (encoding === "utf-8") return new Uint8Array(Buffer.from(text, "utf8"));
  const table = cp1252();
  const out: number[] = [];
  for (const ch of text) {
    const b = table.get(ch);
    if (b === undefined) throw new Error(`windows-1252 cannot hold U+${ch.codePointAt(0)!.toString(16)}`);
    out.push(b);
  }
  return Uint8Array.from(out);
}

const startsWith = (bytes: Uint8Array, prefix: readonly number[]) => prefix.every((b, i) => bytes[i] === b);

/** The encoding the XML declaration names, as written; null without one. */
function declaredEncoding(body: Uint8Array): string | null {
  const head = Buffer.from(body.subarray(0, 512)).toString("latin1");
  if (!head.startsWith("<?xml")) return null;
  const end = head.indexOf("?>");
  const decl = end < 0 ? head : head.slice(0, end);
  const m = /\sencoding\s*=\s*(["'])(.*?)\1/.exec(decl);
  return m ? m[2] : null;
}

/** Blank, refused for its encoding or bytes, or decoded. */
function decode(bytes: Uint8Array): DecodeResult {
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) {
    return { kind: "refused", refusal: { kind: "encoding", encoding: "UTF-16" } };
  }
  const bom = startsWith(bytes, UTF8_BOM);
  const body = bom ? bytes.subarray(UTF8_BOM.length) : bytes;
  if (body.every((b) => WHITESPACE_BYTES.has(b))) return { kind: "blank" };
  const declared = declaredEncoding(body);
  let encoding: Encoding;
  if (bom) {
    if (declared !== null && !UTF8_NAMES.has(declared.toLowerCase())) {
      return { kind: "refused", refusal: { kind: "encoding", encoding: declared } };
    }
    encoding = "utf-8";
  } else if (declared === null || UTF8_NAMES.has(declared.toLowerCase())) encoding = "utf-8";
  else if (CP1252_NAMES.has(declared.toLowerCase())) encoding = "windows-1252";
  else return { kind: "refused", refusal: { kind: "encoding", encoding: declared } };
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: encoding === "utf-8", ignoreBOM: true }).decode(body);
  } catch {
    return { kind: "refused", refusal: { kind: "not-xml", detail: "its bytes are not valid UTF-8" } };
  }
  return { kind: "ok", d: { encoding, bom, body, text } };
}

// -------------------------------------------------------------------------------------------------
// The parse: the root and its children, with the offsets the edits need

interface Field {
  name: string;
  text: string;
}

interface ElementChild {
  kind: "element";
  name: string;
  start: number;
  end: number;
  /** The offset of its first child element, or -1. */
  firstChildStart: number;
  /** A Launch.Addon's child elements and whether it holds other non-whitespace text; null for other elements. */
  entry: { fields: Field[]; stray: boolean } | null;
}

type Child = ElementChild | { kind: "comment"; text: string } | { kind: "text"; text: string } | { kind: "other"; text: string };

interface Doc {
  text: string;
  rootName: string;
  rootType: string | undefined;
  rootStart: number;
  /** Just past the start tag's `>`. */
  rootOpenEnd: number;
  /** The end tag's `<` (the start tag's, when self-closing). */
  rootCloseStart: number;
  rootEnd: number;
  selfClosing: boolean;
  children: Child[];
}

function parse(text: string): Doc | { error: string } {
  const parser = new SaxesParser({ xmlns: false, position: true });
  const tagStart = () => text.lastIndexOf("<", parser.position - 1);
  let depth = 0;
  let doc: Doc | null = null;
  let current: ElementChild | null = null;
  let field: Field | null = null;

  const addText = (t: string) => {
    if (depth === 1) doc!.children.push({ kind: "text", text: t });
    else if (depth === 2 && current?.entry) {
      if (t.trim() !== "") current.entry.stray = true;
    } else if (depth >= 3 && field) field.text += t;
  };

  parser.on("error", (e) => {
    throw e;
  });
  parser.on("opentag", (tag) => {
    const start = tagStart();
    if (depth === 0) {
      const type = (tag.attributes as Record<string, string>).Type;
      doc = {
        text,
        rootName: tag.name,
        rootType: type,
        rootStart: start,
        rootOpenEnd: parser.position,
        rootCloseStart: -1,
        rootEnd: -1,
        selfClosing: tag.isSelfClosing,
        children: [],
      };
    } else if (depth === 1) {
      current = {
        kind: "element",
        name: tag.name,
        start,
        end: -1,
        firstChildStart: -1,
        entry: tag.name === "Launch.Addon" ? { fields: [], stray: false } : null,
      };
      doc!.children.push(current);
    } else if (depth === 2 && current) {
      if (current.firstChildStart < 0) current.firstChildStart = start;
      if (current.entry) {
        field = { name: tag.name, text: "" };
        current.entry.fields.push(field);
      }
    }
    depth++;
  });
  parser.on("closetag", () => {
    depth--;
    if (depth === 0 && doc) {
      doc.rootCloseStart = doc.selfClosing ? doc.rootStart : tagStart();
      doc.rootEnd = parser.position;
    } else if (depth === 1 && current) {
      current.end = parser.position;
      current = null;
    } else if (depth === 2) field = null;
  });
  parser.on("text", addText);
  parser.on("cdata", addText);
  parser.on("comment", (c) => {
    if (depth === 1) doc!.children.push({ kind: "comment", text: c });
  });
  parser.on("processinginstruction", (pi) => {
    if (depth === 1) doc!.children.push({ kind: "other", text: `${pi.target} ${pi.body}` });
  });

  try {
    parser.write(text).close();
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  return doc ?? { error: "it has no root element" };
}

// -------------------------------------------------------------------------------------------------
// The app's entries

const lower = (s: string) => s.toLowerCase();
const isFalse = (v: string | undefined) => v !== undefined && lower(v.trim()) === "false";
const FIVE = ["Name", "Disabled", "ManualLoad", "Path", "CommandLine"] as const;

function fieldText(e: ElementChild, name: string): string | undefined {
  return e.entry?.fields.find((f) => f.name === name)?.text;
}

/** MSFS-022: its Name, trimmed, "MSFS Career Map" ignoring case, and its Path one of the programs ignoring case. */
function isApps(e: ElementChild, p: Programs): boolean {
  if (!e.entry) return false;
  const name = fieldText(e, "Name");
  const path = fieldText(e, "Path");
  if (name === undefined || path === undefined || lower(name.trim()) !== lower(ENTRY_NAME)) return false;
  const wanted = lower(path.trim());
  return [p.program, ...p.earlier].some((x) => lower(x) === wanted);
}

/** MSFS-005 and MSFS-023. */
function appEntry(e: ElementChild, p: Programs): AppEntry {
  const fields = e.entry!.fields;
  const on = isFalse(fieldText(e, "Disabled")) && isFalse(fieldText(e, "ManualLoad"));
  const value = (name: string) => fieldText(e, name)?.trim();
  const same =
    !e.entry!.stray &&
    fields.length === FIVE.length &&
    FIVE.every((name) => fields.filter((f) => f.name === name).length === 1) &&
    lower(value("Name")!) === lower(ENTRY_NAME) &&
    on &&
    lower(value("Path")!) === lower(p.program) &&
    value("CommandLine") === "--background";
  return { on, same };
}

function appElements(doc: Doc, p: Programs): ElementChild[] {
  return doc.children.filter((c): c is ElementChild => c.kind === "element" && isApps(c, p));
}

type Opened = { kind: "blank" } | { kind: "refused"; refusal: Refusal } | { kind: "ok"; d: Decoded; doc: Doc };

/** Decoded, parsed, its root checked, then whether its encoding can hold the program's path. */
function open(bytes: Uint8Array, p: Programs): Opened {
  const dr = decode(bytes);
  if (dr.kind !== "ok") return dr;
  const doc = parse(dr.d.text);
  if ("error" in doc) return { kind: "refused", refusal: { kind: "not-xml", detail: doc.error } };
  if (doc.rootName !== "SimBase.Document" || doc.rootType !== "Launch") return { kind: "refused", refusal: { kind: "wrong-root" } };
  if (!canEncode(p.program, dr.d.encoding)) return { kind: "refused", refusal: { kind: "path-encoding" } };
  return { kind: "ok", d: dr.d, doc };
}

/** A file's bytes: blank; refused (does not parse, wrong root, encoding, path encoding); or its app's entries. */
// @spec DESK-START-MSFS-005, DESK-START-MSFS-016, DESK-START-MSFS-022, DESK-START-MSFS-023, DESK-START-MSFS-027, DESK-START-MSFS-054
export function readExeXml(bytes: Uint8Array, p: Programs): ReadResult {
  const o = open(bytes, p);
  if (o.kind !== "ok") return o;
  return { kind: "read", encoding: o.d.encoding, bom: o.d.bom, entries: appElements(o.doc, p).map((e) => appEntry(e, p)) };
}

// -------------------------------------------------------------------------------------------------
// Writing the entry

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The app's entry as text: `indent` before `<Launch.Addon>`, `step` more before each child, `eol` between lines. */
// @spec DESK-START-MSFS-021
export function entryText(program: string, o: { indent: string; step: string; eol: string }): string {
  const inner = o.indent + o.step;
  return [
    `${o.indent}<Launch.Addon>`,
    `${inner}<Name>${ENTRY_NAME}</Name>`,
    `${inner}<Disabled>False</Disabled>`,
    `${inner}<ManualLoad>False</ManualLoad>`,
    `${inner}<Path>${escapeXml(program)}</Path>`,
    `${inner}<CommandLine>--background</CommandLine>`,
    `${o.indent}</Launch.Addon>`,
  ].join(o.eol);
}

/** A new EXE.xml holding the app's entry: UTF-8 without a byte-order mark, CR LF. */
// @spec DESK-START-MSFS-025, DESK-START-MSFS-026
export function newExeXml(program: string): Uint8Array {
  const text = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<SimBase.Document Type="Launch" version="1,0">',
    "  <Descr>Launch</Descr>",
    "  <Filename>EXE.xml</Filename>",
    "  <Disabled>False</Disabled>",
    "  <Launch.ManualLoad>False</Launch.ManualLoad>",
    entryText(program, { indent: "  ", step: "  ", eol: "\r\n" }),
    "</SimBase.Document>",
    "",
  ].join("\r\n");
  return encode(text, "utf-8");
}

// -------------------------------------------------------------------------------------------------
// Layout: line endings and indents, read from the file

interface Edit {
  start: number;
  end: number;
  text: string;
}

function eolOf(text: string): string {
  const nl = text.indexOf("\n");
  return nl > 0 && text[nl - 1] === "\r" ? "\r\n" : "\n";
}

const lineStart = (text: string, pos: number) => text.lastIndexOf("\n", pos - 1) + 1;

/** The whitespace before `pos` on its line, or null when anything else precedes it there. */
function leadIndent(text: string, pos: number): string | null {
  const before = text.slice(lineStart(text, pos), pos);
  return /^[ \t]*$/.test(before) ? before : null;
}

const defaultStep = (indent: string) => (indent.includes("\t") ? "\t" : "  ");

/** The element's first child's indent beyond its own, when the child sits on a line of its own. */
function stepOf(text: string, e: ElementChild, indent: string): string | null {
  if (e.firstChildStart < 0) return null;
  const child = leadIndent(text, e.firstChildStart);
  return child !== null && child.startsWith(indent) && child.length > indent.length ? child.slice(indent.length) : null;
}

/** The indent and step for a new entry: the last Launch.Addon's, else the last element's, else the root's plus a step. */
function newEntryLayout(doc: Doc): { indent: string; step: string } {
  const { text } = doc;
  const elements = doc.children.filter((c): c is ElementChild => c.kind === "element");
  const ref = elements.filter((e) => e.entry).at(-1) ?? elements.at(-1);
  const rootIndent = leadIndent(text, doc.rootStart) ?? "";
  if (ref) {
    const indent = leadIndent(text, ref.start);
    if (indent !== null) {
      const relative = indent.startsWith(rootIndent) && indent.length > rootIndent.length ? indent.slice(rootIndent.length) : null;
      return { indent, step: stepOf(text, ref, indent) ?? relative ?? defaultStep(indent) };
    }
  }
  const step = defaultStep(rootIndent);
  return { indent: rootIndent + step, step };
}

function insertEdit(doc: Doc, program: string): Edit {
  const { text } = doc;
  const eol = eolOf(text);
  if (doc.selfClosing) {
    const open = `${text.slice(doc.rootStart, doc.rootEnd - 2)}>`;
    const close = `</${doc.rootName}>`;
    if (!text.includes("\n")) {
      return { start: doc.rootStart, end: doc.rootEnd, text: open + entryText(program, { indent: "", step: "", eol: "" }) + close };
    }
    const rootIndent = leadIndent(text, doc.rootStart) ?? "";
    const step = defaultStep(rootIndent);
    const entry = entryText(program, { indent: rootIndent + step, step, eol });
    return { start: doc.rootStart, end: doc.rootEnd, text: `${open}${eol}${entry}${eol}${rootIndent}${close}` };
  }
  const at = doc.rootCloseStart;
  if (!/[\r\n]/.test(text.slice(doc.rootOpenEnd, at))) {
    return { start: at, end: at, text: entryText(program, { indent: "", step: "", eol: "" }) };
  }
  const layout = newEntryLayout(doc);
  const entry = entryText(program, { ...layout, eol });
  const ls = lineStart(text, at);
  if (/^[ \t]*$/.test(text.slice(ls, at))) return { start: ls, end: ls, text: `${entry}${eol}` };
  return { start: at, end: at, text: `${eol}${entry}${eol}` };
}

/** The entry's bytes replaced by the app's entry, at its own column and step, inline when it was. */
function rewriteEdit(doc: Doc, e: ElementChild, program: string): Edit {
  const { text } = doc;
  if (!/[\r\n]/.test(text.slice(e.start, e.end))) {
    return { start: e.start, end: e.end, text: entryText(program, { indent: "", step: "", eol: "" }) };
  }
  const indent = leadIndent(text, e.start) ?? "";
  const step = stepOf(text, e, indent) ?? defaultStep(indent);
  return { start: e.start, end: e.end, text: entryText(program, { indent, step, eol: eolOf(text) }).slice(indent.length) };
}

/** MSFS-045: with its lines when they hold nothing but it and whitespace, else only its own bytes. */
function removeEdit(doc: Doc, e: ElementChild): Edit {
  const { text } = doc;
  const ls = lineStart(text, e.start);
  let after = e.end;
  while (text[after] === " " || text[after] === "\t") after++;
  let lineEnd: number | null = null;
  if (text.startsWith("\r\n", after)) lineEnd = after + 2;
  else if (text[after] === "\n") lineEnd = after + 1;
  else if (after === text.length) lineEnd = after;
  if (lineEnd !== null && /^[ \t]*$/.test(text.slice(ls, e.start))) return { start: ls, end: lineEnd, text: "" };
  return { start: e.start, end: e.end, text: "" };
}

/** The file's bytes with the edits made: the bytes outside them copied, the byte-order mark kept as found. */
function applyEdits(d: Decoded, edits: Edit[]): Uint8Array {
  const byteAt =
    d.encoding === "windows-1252" ? (off: number) => off : (off: number) => Buffer.byteLength(d.text.slice(0, off), "utf8");
  const parts: Uint8Array[] = d.bom ? [Uint8Array.from(UTF8_BOM)] : [];
  let from = 0;
  for (const edit of [...edits].sort((a, b) => a.start - b.start)) {
    parts.push(d.body.subarray(from, byteAt(edit.start)), encode(edit.text, d.encoding));
    from = byteAt(edit.end);
  }
  parts.push(d.body.subarray(from));
  return new Uint8Array(Buffer.concat(parts));
}

// -------------------------------------------------------------------------------------------------
// The result's check (MSFS-037, MSFS-048)

/** The root's children but the app's entries: elements by their text, comments, and non-whitespace text (runs merged). */
function others(doc: Doc, p: Programs): string[] {
  const out: string[] = [];
  let run: string | null = null;
  const flush = () => {
    if (run !== null && run.trim() !== "") out.push(`text ${run.trim()}`);
    run = null;
  };
  for (const c of doc.children) {
    if (c.kind === "text") {
      run = (run ?? "") + c.text;
      continue;
    }
    if (c.kind === "element" && isApps(c, p)) continue;
    flush();
    if (c.kind === "element") out.push(`element ${doc.text.slice(c.start, c.end)}`);
    else out.push(`${c.kind} ${c.text}`);
  }
  flush();
  return out;
}

function startTag(doc: Doc): string {
  const tag = doc.text.slice(doc.rootStart, doc.rootOpenEnd);
  return doc.selfClosing ? `${tag.slice(0, -2)}>` : tag;
}

/** What differs between the file and its result, or null when the result checks out. */
function checkResult(before: Doc, result: Uint8Array, p: Programs, mode: "add" | "remove"): string | null {
  const o = open(result, p);
  if (o.kind !== "ok") return "it no longer parses";
  const after = o.doc;
  if (after.selfClosing ? mode === "add" : startTag(after) !== startTag(before)) return "the root's start tag changed";
  const a = others(before, p);
  const b = others(after, p);
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) return "another entry, a comment or text changed";
  const apps = appElements(after, p).map((e) => appEntry(e, p));
  if (mode === "add" && !(apps.length === 1 && apps[0].on && apps[0].same)) return "the app's entry is not there once, turned on";
  if (mode === "remove" && apps.length > 0) return "an entry of the app's remains";
  return null;
}

function finish(o: Extract<Opened, { kind: "ok" }>, edits: Edit[], p: Programs, mode: "add" | "remove"): EditResult {
  const bytes = applyEdits(o.d, edits);
  const failed = checkResult(o.doc, bytes, p, mode);
  return failed === null ? { kind: "changed", bytes } : { kind: "refused", refusal: { kind: "check-failed", detail: failed } };
}

// -------------------------------------------------------------------------------------------------
// Adding and removing

/**
 * Turning on, for an existing file neither empty nor only whitespace: unchanged with exactly one
 * entry of the app's, on and the same; else the entry inserted before the root's end tag (a
 * self-closing root opened), or the first rewritten in place and any others removed; then checked.
 */
// @spec DESK-START-MSFS-028, DESK-START-MSFS-032, DESK-START-MSFS-033, DESK-START-MSFS-034, DESK-START-MSFS-035, DESK-START-MSFS-036, DESK-START-MSFS-037
export function addEntry(bytes: Uint8Array, p: Programs): EditResult {
  const o = open(bytes, p);
  if (o.kind === "refused") return o;
  if (o.kind === "blank") return { kind: "refused", refusal: { kind: "check-failed", detail: "the file is blank" } };
  const apps = appElements(o.doc, p);
  if (apps.length === 0) return finish(o, [insertEdit(o.doc, p.program)], p, "add");
  const first = appEntry(apps[0], p);
  if (apps.length === 1 && first.on && first.same) return { kind: "unchanged" };
  const edits = apps.slice(1).map((e) => removeEdit(o.doc, e));
  if (!(first.on && first.same)) edits.push(rewriteEdit(o.doc, apps[0], p.program));
  return finish(o, edits, p, "add");
}

/** Turning off and --unregister: every entry of the app's removed, with its lines or by its own bytes; then checked. */
// @spec DESK-START-MSFS-036, DESK-START-MSFS-044, DESK-START-MSFS-045, DESK-START-MSFS-046, DESK-START-MSFS-047, DESK-START-MSFS-048
export function removeEntries(bytes: Uint8Array, p: Programs): EditResult {
  const o = open(bytes, p);
  if (o.kind === "refused") return o;
  if (o.kind === "blank") return { kind: "unchanged" };
  const apps = appElements(o.doc, p);
  if (apps.length === 0) return { kind: "unchanged" };
  return finish(
    o,
    apps.map((e) => removeEdit(o.doc, e)),
    p,
    "remove",
  );
}
