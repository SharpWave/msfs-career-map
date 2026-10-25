/**
 * The `EXE.xml` editor's pure part (src/desktop/exe-xml.ts; m4 contract §2), against the fixtures:
 * reading a file — blank, refused (does not parse, wrong root, an encoding other than UTF-8 and
 * windows-1252, a program path its encoding cannot hold) or read with the app's entries, turned on or
 * off, the same or altered; adding the app's entry as text, every other byte as it was; removing it,
 * with its lines or by its own bytes; and the new file written where there is none.
 */
import { describe, expect, it } from "vitest";
import {
  ENTRY_NAME,
  addEntry,
  entryText,
  newExeXml,
  readExeXml,
  refusalText,
  removeEntries,
  type EditResult,
  type Programs,
  type ReadResult,
} from "../../../src/desktop/exe-xml.ts";
import { TEST_PROGRAM, encodeText, fixture, fixtureText, xmlEscape } from "./support/sims.ts";

const P = (program = TEST_PROGRAM, earlier: string[] = []): Programs => ({ program, earlier });
const EARLIER = "C:\\Users\\Pilot\\AppData\\Local\\Programs\\Career Map\\Career Map.exe";
/** A program windows-1252 cannot hold. */
const CYRILLIC = "C:\\Users\\Пилот\\AppData\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe";
/** A program holding the characters XML escapes. */
const AMPERSAND = "C:\\Users\\R&D <Lab>\\AppData\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe";
const ROOT_END = "</SimBase.Document>";

const utf8 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("utf8");
const bytesOf = (text: string): Uint8Array => new Uint8Array(Buffer.from(text, "utf8"));
const latin1 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("latin1");

/** The app's entry as the contract pins it, an oracle independent of entryText. */
function block(program: string, indent: string, step: string, eol: string): string {
  const inner = indent + step;
  return [
    `${indent}<Launch.Addon>`,
    `${inner}<Name>MSFS Career Map</Name>`,
    `${inner}<Disabled>False</Disabled>`,
    `${inner}<ManualLoad>False</ManualLoad>`,
    `${inner}<Path>${xmlEscape(program)}</Path>`,
    `${inner}<CommandLine>--background</CommandLine>`,
    `${indent}</Launch.Addon>`,
  ].join(eol);
}

function read(r: ReadResult): Extract<ReadResult, { kind: "read" }> {
  if (r.kind !== "read") throw new Error(`expected read, got ${JSON.stringify(r)}`);
  return r;
}

function changed(r: EditResult): Uint8Array {
  if (r.kind !== "changed") throw new Error(`expected changed, got ${JSON.stringify(r)}`);
  return r.bytes;
}

function entries(bytes: Uint8Array, p: Programs = P()) {
  return read(readExeXml(bytes, p)).entries;
}

/** The text with `find` replaced once, failing when it is not there exactly once. */
function replaceOnce(text: string, find: string, by: string): string {
  const at = text.indexOf(find);
  if (at < 0 || text.indexOf(find, at + 1) >= 0) throw new Error(`replaceOnce: ${JSON.stringify(find)} not there exactly once`);
  return text.slice(0, at) + by + text.slice(at + find.length);
}

// -------------------------------------------------------------------------------------------------

describe("reading a file", () => {
  // @spec DESK-START-MSFS-016, DESK-START-MSFS-026, DESK-START-MSFS-046
  it("counts an empty file, or one holding only whitespace, as blank", () => {
    expect(readExeXml(new Uint8Array(0), P())).toEqual({ kind: "blank" });
    expect(readExeXml(bytesOf("  \r\n\t \r\n"), P())).toEqual({ kind: "blank" });
    expect(readExeXml(new Uint8Array([0xef, 0xbb, 0xbf, 0x20, 0x0d, 0x0a]), P())).toEqual({ kind: "blank" });
  });

  // @spec DESK-START-MSFS-016, DESK-START-MSFS-027
  it("reads a UTF-8 file with no entry of the app's, telling its encoding and byte-order mark", () => {
    expect(readExeXml(fixture("real-six.xml"), P())).toEqual({ kind: "read", encoding: "utf-8", bom: false, entries: [] });
    expect(readExeXml(fixture("real-six.xml", { bom: true }), P())).toEqual({ kind: "read", encoding: "utf-8", bom: true, entries: [] });
    expect(readExeXml(fixture("real-six.xml", { eol: "lf" }), P())).toEqual({ kind: "read", encoding: "utf-8", bom: false, entries: [] });
  });

  // @spec DESK-START-MSFS-016, DESK-START-MSFS-027
  it("reads a windows-1252 file, its declaration's name compared ignoring case", () => {
    expect(readExeXml(fixture("real-six-1252.xml", { encoding: "windows-1252" }), P())).toEqual({
      kind: "read",
      encoding: "windows-1252",
      bom: false,
      entries: [],
    });
    const cp = fixtureText("real-six-1252.xml").replace('encoding="Windows-1252"', 'encoding="cp1252"');
    expect(read(readExeXml(encodeText(cp, "windows-1252"), P())).encoding).toBe("windows-1252");
  });

  // @spec DESK-START-MSFS-016, DESK-START-MSFS-027
  it("takes a file with no encoding declared, or declared utf8, as UTF-8", () => {
    const none = fixtureText("real-six.xml").replace(' encoding="UTF-8"', "");
    expect(read(readExeXml(bytesOf(none), P())).encoding).toBe("utf-8");
    const noDeclaration = fixtureText("real-six.xml").replace('<?xml version="1.0" encoding="UTF-8"?>\r\n', "");
    expect(read(readExeXml(bytesOf(noDeclaration), P())).encoding).toBe("utf-8");
    const alias = fixtureText("real-six.xml").replace('encoding="UTF-8"', 'encoding="utf8"');
    expect(read(readExeXml(bytesOf(alias), P())).encoding).toBe("utf-8");
  });

  // @spec DESK-START-MSFS-016, DESK-START-MSFS-027
  it("refuses a file that does not parse as XML", () => {
    const r = readExeXml(fixture("malformed.xml"), P());
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.refusal.kind).toBe("not-xml");
  });

  // @spec DESK-START-MSFS-016, DESK-START-MSFS-027
  it("refuses UTF-8 bytes that are not valid UTF-8 as not parsing", () => {
    const good = Buffer.from(fixture("real-six.xml"));
    const at = good.indexOf("Volanta");
    const bad = new Uint8Array(Buffer.concat([good.subarray(0, at), Buffer.from([0xe9]), good.subarray(at)]));
    const r = readExeXml(bad, P());
    expect(r.kind).toBe("refused");
    if (r.kind === "refused") expect(r.refusal.kind).toBe("not-xml");
  });

  // @spec DESK-START-MSFS-016, DESK-START-MSFS-027
  it("refuses a root other than SimBase.Document with Type=\"Launch\", even holding the app's entry", () => {
    expect(readExeXml(fixture("wrong-root.xml"), P())).toEqual({ kind: "refused", refusal: { kind: "wrong-root" } });
    const otherRoot = fixtureText("real-six.xml").replace(/SimBase\.Document/g, "Launch.Document");
    expect(readExeXml(bytesOf(otherRoot), P())).toEqual({ kind: "refused", refusal: { kind: "wrong-root" } });
  });

  // @spec DESK-START-MSFS-016, DESK-START-MSFS-027
  it("refuses an encoding other than UTF-8 and windows-1252", () => {
    expect(readExeXml(fixture("real-six.xml", { encoding: "utf-16le", bom: true }), P())).toEqual({
      kind: "refused",
      refusal: { kind: "encoding", encoding: "UTF-16" },
    });
    const latin = fixtureText("real-six.xml").replace('encoding="UTF-8"', 'encoding="ISO-8859-1"');
    expect(readExeXml(bytesOf(latin), P())).toEqual({ kind: "refused", refusal: { kind: "encoding", encoding: "ISO-8859-1" } });
  });

  // @spec DESK-START-MSFS-027
  it("refuses a UTF-8 byte-order mark beside a declaration naming another encoding", () => {
    const bytes = fixture("real-six-1252.xml", { bom: true });
    expect(readExeXml(bytes, P())).toEqual({ kind: "refused", refusal: { kind: "encoding", encoding: "Windows-1252" } });
  });

  // @spec DESK-START-MSFS-027
  it("refuses a windows-1252 file that cannot hold the program's path, with no entry of the app's in it", () => {
    const bytes = fixture("real-six-1252.xml", { encoding: "windows-1252" });
    expect(readExeXml(bytes, P(CYRILLIC))).toEqual({ kind: "refused", refusal: { kind: "path-encoding" } });
  });

  // @spec DESK-START-MSFS-027
  it("refuses such a file holding an entry named for the app whose path lost its characters", () => {
    const lost = CYRILLIC.replace("Пилот", "?????");
    const withEntry = replaceOnce(fixtureText("real-six-1252.xml"), ROOT_END, `${block(lost, "  ", "  ", "\r\n")}\r\n${ROOT_END}`);
    expect(readExeXml(encodeText(withEntry, "windows-1252"), P(CYRILLIC))).toEqual({ kind: "refused", refusal: { kind: "path-encoding" } });
  });

  // @spec DESK-START-MSFS-027
  it("reads a UTF-8 file whatever characters the program's path holds", () => {
    expect(entries(fixture("with-app.xml", { program: CYRILLIC }), P(CYRILLIC))).toEqual([{ on: true, same: true }]);
  });

  // @spec DESK-START-MSFS-005, DESK-START-MSFS-022, DESK-START-MSFS-023
  it("finds the app's entry differently indented, reordered, padded and in lower case, as on and the same", () => {
    expect(entries(fixture("with-app.xml"))).toEqual([{ on: true, same: true }]);
  });

  // @spec DESK-START-MSFS-022
  it("tells the app's entry by its name trimmed and ignoring case", () => {
    expect(entries(fixture("name-case.xml"))).toEqual([{ on: true, same: true }]);
  });

  // @spec DESK-START-MSFS-022
  it("tells the app's entry by its path ignoring case", () => {
    const upper = fixture("with-app.xml", { program: TEST_PROGRAM.toUpperCase() });
    expect(entries(upper)).toEqual([{ on: true, same: true }]);
  });

  // @spec DESK-START-MSFS-022
  it("counts neither the program under another name nor the name with another program as the app's", () => {
    expect(entries(fixture("other-name.xml"))).toEqual([]);
  });

  // @spec DESK-START-MSFS-005
  it("counts the app's entry turned off when Disabled or ManualLoad is not False", () => {
    expect(entries(fixture("off-disabled.xml"))).toEqual([{ on: false, same: false }]);
    expect(entries(fixture("off-manualload.xml"))).toEqual([{ on: false, same: false }]);
  });

  // @spec DESK-START-MSFS-023
  it("counts an entry missing an element, adding one or changing one as altered, still on", () => {
    expect(entries(fixture("altered-missing.xml"))).toEqual([{ on: true, same: false }]);
    expect(entries(fixture("altered-added.xml"))).toEqual([{ on: true, same: false }]);
    expect(entries(fixture("altered-changed.xml"))).toEqual([{ on: true, same: false }]);
  });

  // @spec DESK-START-MSFS-022
  it("gives every entry of the app's in order", () => {
    expect(entries(fixture("twice.xml"))).toEqual([
      { on: true, same: true },
      { on: false, same: false },
    ]);
  });

  // @spec DESK-START-MSFS-022
  it("reads the path XML-unescaped", () => {
    expect(entries(fixture("with-app.xml", { program: AMPERSAND }), P(AMPERSAND))).toEqual([{ on: true, same: true }]);
  });

  // @spec DESK-START-MSFS-054
  it("counts an entry naming the earlier installed program as the app's, altered", () => {
    const earlier = fixture("with-app.xml", { program: EARLIER });
    expect(entries(earlier, P(TEST_PROGRAM, []))).toEqual([]);
    expect(entries(earlier, P(TEST_PROGRAM, [EARLIER]))).toEqual([{ on: true, same: false }]);
  });
});

// -------------------------------------------------------------------------------------------------

describe("the app's entry and a new file", () => {
  // @spec DESK-START-MSFS-021
  it("writes the entry's five elements in order, the path escaped", () => {
    expect(entryText(TEST_PROGRAM, { indent: "  ", step: "  ", eol: "\r\n" })).toBe(block(TEST_PROGRAM, "  ", "  ", "\r\n"));
    expect(entryText(AMPERSAND, { indent: "\t", step: "\t", eol: "\n" })).toBe(block(AMPERSAND, "\t", "\t", "\n"));
    expect(ENTRY_NAME).toBe("MSFS Career Map");
  });

  // @spec DESK-START-MSFS-021
  it("writes the entry inline when the line ending is empty", () => {
    expect(entryText(TEST_PROGRAM, { indent: "", step: "", eol: "" })).toBe(block(TEST_PROGRAM, "", "", ""));
  });

  // @spec DESK-START-MSFS-025
  it("writes a new file as UTF-8 without a byte-order mark, CR LF, holding the app's entry", () => {
    const expected = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<SimBase.Document Type="Launch" version="1,0">',
      "  <Descr>Launch</Descr>",
      "  <Filename>EXE.xml</Filename>",
      "  <Disabled>False</Disabled>",
      "  <Launch.ManualLoad>False</Launch.ManualLoad>",
      block(TEST_PROGRAM, "  ", "  ", "\r\n"),
      "</SimBase.Document>",
      "",
    ].join("\r\n");
    const bytes = newExeXml(TEST_PROGRAM);
    expect(bytes[0]).not.toBe(0xef);
    expect(utf8(bytes)).toBe(expected);
    expect(entries(bytes)).toEqual([{ on: true, same: true }]);
  });

  // @spec DESK-START-MSFS-025
  it("escapes the path in a new file", () => {
    const bytes = newExeXml(AMPERSAND);
    expect(utf8(bytes)).toContain("<Path>C:\\Users\\R&amp;D &lt;Lab&gt;\\AppData");
    expect(entries(bytes, P(AMPERSAND))).toEqual([{ on: true, same: true }]);
  });
});

// -------------------------------------------------------------------------------------------------

describe("adding the app's entry", () => {
  // @spec DESK-START-MSFS-032, DESK-START-MSFS-036
  it("inserts it before the root's end tag, indented like the other entries, with CR LF, every other byte kept", () => {
    const original = fixtureText("real-six.xml");
    const result = changed(addEntry(fixture("real-six.xml"), P()));
    expect(utf8(result)).toBe(replaceOnce(original, ROOT_END, `${block(TEST_PROGRAM, "  ", "  ", "\r\n")}\r\n${ROOT_END}`));
    expect(entries(result)).toEqual([{ on: true, same: true }]);
  });

  // @spec DESK-START-MSFS-032
  it("uses the file's own LF line endings", () => {
    const original = fixtureText("real-six.xml", { eol: "lf" });
    const result = changed(addEntry(fixture("real-six.xml", { eol: "lf" }), P()));
    expect(utf8(result)).toBe(replaceOnce(original, ROOT_END, `${block(TEST_PROGRAM, "  ", "  ", "\n")}\n${ROOT_END}`));
  });

  // @spec DESK-START-MSFS-036
  it("keeps a byte-order mark as found", () => {
    const result = changed(addEntry(fixture("real-six.xml", { bom: true }), P()));
    expect([...result.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const expected = replaceOnce(fixtureText("real-six.xml"), ROOT_END, `${block(TEST_PROGRAM, "  ", "  ", "\r\n")}\r\n${ROOT_END}`);
    expect(utf8(result.subarray(3))).toBe(expected);
  });

  // @spec DESK-START-MSFS-032, DESK-START-MSFS-036
  it("writes in a windows-1252 file's own encoding, its other characters as they were", () => {
    const opts = { encoding: "windows-1252" as const, eol: "lf" as const };
    const result = changed(addEntry(fixture("real-six-1252.xml", opts), P()));
    const expected = replaceOnce(fixtureText("real-six-1252.xml", opts), ROOT_END, `${block(TEST_PROGRAM, "  ", "  ", "\n")}\n${ROOT_END}`);
    expect([...result]).toEqual([...encodeText(expected, "windows-1252")]);
  });

  // @spec DESK-START-MSFS-036
  it("keeps windows-1252 bytes 0x80 to 0x9F as they were, the unmapped ones included", () => {
    const opts = { encoding: "windows-1252" as const };
    const before = latin1(fixture("real-six-1252.xml", opts)).replace("Pushback Helper", "Pushback \x80\x81\x8d\x9d Helper");
    const bytes = new Uint8Array(Buffer.from(before, "latin1"));
    const result = changed(addEntry(bytes, P()));
    expect(latin1(result)).toBe(replaceOnce(before, ROOT_END, `${block(TEST_PROGRAM, "  ", "  ", "\r\n")}\r\n${ROOT_END}`));
  });

  // @spec DESK-START-MSFS-032
  it("inserts inline into a file whose entries share one line", () => {
    const original = fixtureText("minified.xml");
    const result = changed(addEntry(fixture("minified.xml"), P()));
    expect(utf8(result)).toBe(replaceOnce(original, ROOT_END, `${block(TEST_PROGRAM, "", "", "")}${ROOT_END}`));
  });

  // @spec DESK-START-MSFS-035, DESK-START-MSFS-036
  it("opens a self-closing root around the entry, the only other change", () => {
    const result = changed(addEntry(fixture("self-closing.xml"), P()));
    expect(utf8(result)).toBe(
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<SimBase.Document Type="Launch" version="1,0">',
        block(TEST_PROGRAM, "  ", "  ", "\r\n"),
        "</SimBase.Document>",
        "",
      ].join("\r\n"),
    );
    expect(entries(result)).toEqual([{ on: true, same: true }]);
  });

  // @spec DESK-START-MSFS-028
  it("changes nothing when the file holds exactly one entry of the app's, on and the same", () => {
    expect(addEntry(fixture("with-app.xml"), P())).toEqual({ kind: "unchanged" });
    expect(addEntry(fixture("name-case.xml"), P())).toEqual({ kind: "unchanged" });
    expect(addEntry(fixture("after-app.xml"), P())).toEqual({ kind: "unchanged" });
    expect(addEntry(fixture("inline-app.xml"), P())).toEqual({ kind: "unchanged" });
  });

  // @spec DESK-START-MSFS-028, DESK-START-MSFS-036
  it("changes nothing when repeated on its own result", () => {
    for (const name of ["real-six.xml", "minified.xml", "self-closing.xml", "off-disabled.xml", "twice.xml"]) {
      const once = changed(addEntry(fixture(name), P()));
      expect(addEntry(once, P()), name).toEqual({ kind: "unchanged" });
    }
  });

  // @spec DESK-START-MSFS-033, DESK-START-MSFS-036
  it("rewrites an entry turned off in place, everything outside it as it was", () => {
    for (const [name, from] of [
      ["off-disabled.xml", "<Disabled>True</Disabled>"],
      ["off-manualload.xml", "<ManualLoad>TRUE</ManualLoad>"],
    ] as const) {
      const original = fixtureText(name, { eol: "lf" });
      const result = changed(addEntry(fixture(name, { eol: "lf" }), P()));
      const to = from.startsWith("<Disabled>") ? "<Disabled>False</Disabled>" : "<ManualLoad>False</ManualLoad>";
      expect(utf8(result), name).toBe(replaceOnce(original, from, to));
    }
  });

  // @spec DESK-START-MSFS-033, DESK-START-MSFS-036
  it("rewrites an altered entry in place: a missing element added, an added one dropped, a changed one put right", () => {
    const lf = { eol: "lf" as const };
    const canonical = block(TEST_PROGRAM, "  ", "  ", "\n").trimStart();

    const missing = fixtureText("altered-missing.xml", lf);
    const missingEntry = missing.slice(missing.indexOf("<Launch.Addon>"), missing.indexOf("</Launch.Addon>") + "</Launch.Addon>".length);
    expect(utf8(changed(addEntry(fixture("altered-missing.xml", lf), P())))).toBe(replaceOnce(missing, missingEntry, canonical));

    const added = fixtureText("altered-added.xml", lf);
    expect(utf8(changed(addEntry(fixture("altered-added.xml", lf), P())))).toBe(replaceOnce(added, "    <NewConsole>True</NewConsole>\n", ""));

    const changedText = fixtureText("altered-changed.xml", lf);
    expect(utf8(changed(addEntry(fixture("altered-changed.xml", lf), P())))).toBe(
      replaceOnce(changedText, "<CommandLine>--minimized</CommandLine>", "<CommandLine>--background</CommandLine>"),
    );
  });

  // @spec DESK-START-MSFS-034, DESK-START-MSFS-045
  it("keeps the first of two entries and removes the second with its lines", () => {
    const lf = { eol: "lf" as const };
    const original = fixtureText("twice.xml", lf);
    const second = `${block(TEST_PROGRAM, "  ", "  ", "\n").replace("<Disabled>False</Disabled>", "<Disabled>True</Disabled>")}\n`;
    const result = changed(addEntry(fixture("twice.xml", lf), P()));
    expect(utf8(result)).toBe(replaceOnce(original, second, ""));
    expect(entries(result)).toEqual([{ on: true, same: true }]);
  });

  // @spec DESK-START-MSFS-032, DESK-START-MSFS-037
  it("keeps entries after the app's in order when the entry goes back in", () => {
    const removed = changed(removeEntries(fixture("after-app.xml"), P()));
    const back = changed(addEntry(removed, P()));
    const text = utf8(back);
    expect(text.indexOf("FSUIPC7")).toBeLessThan(text.indexOf("Volanta"));
    expect(text.indexOf("Volanta")).toBeLessThan(text.indexOf("<!-- BeyondATC below -->"));
    expect(text.indexOf("<!-- BeyondATC below -->")).toBeLessThan(text.indexOf("BeyondATC</Name>"));
    expect(text.indexOf("BeyondATC</Name>")).toBeLessThan(text.indexOf("MSFS Career Map"));
    expect(entries(back)).toEqual([{ on: true, same: true }]);
  });

  // @spec DESK-START-MSFS-022, DESK-START-MSFS-032
  it("adds an entry beside the program under another name and the name with another program, keeping both", () => {
    const original = fixtureText("other-name.xml");
    const result = changed(addEntry(fixture("other-name.xml"), P()));
    expect(utf8(result)).toBe(replaceOnce(original, ROOT_END, `${block(TEST_PROGRAM, "  ", "  ", "\r\n")}\r\n${ROOT_END}`));
  });

  // @spec DESK-START-MSFS-021, DESK-START-MSFS-022
  it("writes a path holding & and < escaped, and knows it again", () => {
    const result = changed(addEntry(fixture("real-six.xml"), P(AMPERSAND)));
    expect(utf8(result)).toContain("<Path>C:\\Users\\R&amp;D &lt;Lab&gt;\\AppData\\Local\\Programs\\MSFS Career Map\\MSFS Career Map.exe</Path>");
    expect(entries(result, P(AMPERSAND))).toEqual([{ on: true, same: true }]);
    expect(addEntry(result, P(AMPERSAND))).toEqual({ kind: "unchanged" });
  });

  // @spec DESK-START-MSFS-054, DESK-START-MSFS-033
  it("rewrites an entry naming the earlier program with the installed one", () => {
    const lf = { eol: "lf" as const };
    const original = fixtureText("off-disabled.xml", { ...lf, program: EARLIER });
    const result = changed(addEntry(fixture("off-disabled.xml", { ...lf, program: EARLIER }), P(TEST_PROGRAM, [EARLIER])));
    const fixed = replaceOnce(original, "<Disabled>True</Disabled>", "<Disabled>False</Disabled>");
    expect(utf8(result)).toBe(replaceOnce(fixed, `<Path>${EARLIER}</Path>`, `<Path>${TEST_PROGRAM}</Path>`));
  });

  // @spec DESK-START-MSFS-027
  it("refuses what reading refuses, the path encoding included", () => {
    expect(addEntry(fixture("malformed.xml"), P()).kind).toBe("refused");
    expect(addEntry(fixture("wrong-root.xml"), P())).toEqual({ kind: "refused", refusal: { kind: "wrong-root" } });
    expect(addEntry(fixture("real-six-1252.xml", { encoding: "windows-1252" }), P(CYRILLIC))).toEqual({
      kind: "refused",
      refusal: { kind: "path-encoding" },
    });
  });
});

// -------------------------------------------------------------------------------------------------

describe("removing the app's entries", () => {
  // @spec DESK-START-MSFS-044, DESK-START-MSFS-045, DESK-START-MSFS-036, DESK-START-MSFS-048
  it("removes an entry on lines of its own together with those lines", () => {
    const lf = { eol: "lf" as const };
    const original = fixtureText("after-app.xml", lf);
    const result = changed(removeEntries(fixture("after-app.xml", lf), P()));
    expect(utf8(result)).toBe(replaceOnce(original, `${block(TEST_PROGRAM, "  ", "  ", "\n")}\n`, ""));
    expect(entries(result)).toEqual([]);
  });

  // @spec DESK-START-MSFS-044, DESK-START-MSFS-045
  it("removes a reordered, tab-indented entry with its lines, CR LF kept elsewhere", () => {
    const original = fixtureText("with-app.xml");
    const start = original.indexOf("\t<Launch.Addon>");
    const end = original.indexOf("\t</Launch.Addon>\r\n") + "\t</Launch.Addon>\r\n".length;
    const result = changed(removeEntries(fixture("with-app.xml"), P()));
    expect(utf8(result)).toBe(original.slice(0, start) + original.slice(end));
  });

  // @spec DESK-START-MSFS-044
  it("removes every entry of the app's, turned on or not", () => {
    const lf = { eol: "lf" as const };
    const original = fixtureText("twice.xml", lf);
    const first = `${block(TEST_PROGRAM, "  ", "  ", "\n")}\n`;
    const second = first.replace("<Disabled>False</Disabled>", "<Disabled>True</Disabled>");
    const result = changed(removeEntries(fixture("twice.xml", lf), P()));
    expect(utf8(result)).toBe(replaceOnce(replaceOnce(original, first, ""), second, ""));
  });

  // @spec DESK-START-MSFS-045
  it("removes an entry sharing its line with another only by its own bytes", () => {
    const original = fixtureText("inline-app.xml");
    const result = changed(removeEntries(fixture("inline-app.xml"), P()));
    expect(utf8(result)).toBe(replaceOnce(original, block(TEST_PROGRAM, "", "", ""), ""));
  });

  // @spec DESK-START-MSFS-036, DESK-START-MSFS-045
  it("gives back the original bytes after adding then removing", () => {
    for (const [name, opts] of [
      ["real-six.xml", {}],
      ["real-six.xml", { eol: "lf" }],
      ["real-six.xml", { bom: true }],
      ["real-six-1252.xml", { encoding: "windows-1252" }],
      ["minified.xml", {}],
      ["other-name.xml", {}],
    ] as const) {
      const original = fixture(name, opts);
      const back = changed(removeEntries(changed(addEntry(original, P())), P()));
      expect([...back], `${name} ${JSON.stringify(opts)}`).toEqual([...original]);
    }
  });

  // @spec DESK-START-MSFS-046
  it("changes nothing in a file holding no entry of the app's", () => {
    expect(removeEntries(fixture("real-six.xml"), P())).toEqual({ kind: "unchanged" });
    expect(removeEntries(fixture("other-name.xml"), P())).toEqual({ kind: "unchanged" });
    expect(removeEntries(fixture("self-closing.xml"), P())).toEqual({ kind: "unchanged" });
  });

  // @spec DESK-START-MSFS-047
  it("leaves a file with its root when the app's entry was its only one", () => {
    const result = changed(removeEntries(fixture("altered-added.xml"), P()));
    const text = utf8(result);
    expect(text).toContain('<SimBase.Document Type="Launch" version="1,0">');
    expect(text).toContain("</SimBase.Document>");
    expect(text).not.toContain("Launch.Addon");
    expect(readExeXml(result, P())).toEqual({ kind: "read", encoding: "utf-8", bom: false, entries: [] });
  });

  // @spec DESK-START-MSFS-054
  it("removes an entry naming the earlier program", () => {
    const bytes = fixture("with-app.xml", { program: EARLIER });
    expect(removeEntries(bytes, P(TEST_PROGRAM))).toEqual({ kind: "unchanged" });
    expect(entries(changed(removeEntries(bytes, P(TEST_PROGRAM, [EARLIER]))), P(TEST_PROGRAM, [EARLIER]))).toEqual([]);
  });

  // @spec DESK-START-MSFS-027
  it("refuses a windows-1252 file that cannot hold the program's path, with an entry of the app's or without", () => {
    const without = fixture("real-six-1252.xml", { encoding: "windows-1252" });
    expect(removeEntries(without, P(CYRILLIC))).toEqual({ kind: "refused", refusal: { kind: "path-encoding" } });
    const lost = CYRILLIC.replace("Пилот", "?????");
    const withText = replaceOnce(fixtureText("real-six-1252.xml"), ROOT_END, `${block(lost, "  ", "  ", "\r\n")}\r\n${ROOT_END}`);
    expect(removeEntries(encodeText(withText, "windows-1252"), P(CYRILLIC))).toEqual({ kind: "refused", refusal: { kind: "path-encoding" } });
  });

  // @spec DESK-START-MSFS-027
  it("refuses a file that does not parse or has the wrong root", () => {
    expect(removeEntries(fixture("malformed.xml"), P()).kind).toBe("refused");
    expect(removeEntries(fixture("wrong-root.xml"), P())).toEqual({ kind: "refused", refusal: { kind: "wrong-root" } });
  });
});

// -------------------------------------------------------------------------------------------------

describe("refusals in words", () => {
  // @spec DESK-START-MSFS-027, DESK-START-MSFS-049
  it("says why a file was left as it was", () => {
    expect(refusalText({ kind: "not-xml", detail: "Unexpected close tag" })).toBe("it does not parse as XML (Unexpected close tag)");
    expect(refusalText({ kind: "wrong-root" })).toBe('its root is not SimBase.Document with Type="Launch"');
    expect(refusalText({ kind: "encoding", encoding: "UTF-16" })).toBe("its encoding, UTF-16, is neither UTF-8 nor windows-1252");
    expect(refusalText({ kind: "path-encoding" })).toBe("its encoding, windows-1252, cannot hold the program's path");
    expect(refusalText({ kind: "check-failed", detail: "an entry moved" })).toBe("the changed file did not check out (an entry moved)");
  });
});
