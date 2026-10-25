/**
 * The screens the window shows in place of the page (src/desktop/screens.ts; m2 contract §13.4),
 * packaged with the desktop shell and needing no network: the start screen "Starting MSFS Career
 * Map…" (DESK-SHELL-WIN-001), the failure screen with its heading, the reason and the hint
 * (WIN-002), "The page stopped. …" (WIN-021) and "Quitting MSFS Career Map…" (WIN-032). Each is a
 * whole document in a `data:` URL that loads nothing from any address, on the page's dark
 * background, with every text HTML-escaped.
 */
import { describe, expect, it } from "vitest";
import { SCREEN_TEXT, type Screen, screenHtml, screenUrl } from "../../../src/desktop/screens.ts";
import { screenHtmlOf, screenOf } from "../support/fakes.ts";

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`;
const ALL: Screen[] = [{ kind: "start" }, { kind: "failure", reason: "Port 3280 is in use by another program" }, { kind: "quitting" }, { kind: "stopped" }];

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** The document's text: tags dropped, character references (named or numeric, any spelling) undone. */
function textOf(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|amp|lt|gt|quot|apos);/gi, (whole, ref: string) => {
      if (ref[0] === "#") {
        const code = ref[1] === "x" || ref[1] === "X" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
        return String.fromCodePoint(code);
      }
      return NAMED[ref.toLowerCase()] ?? whole;
    });
}

/** Each of the five characters, escaped: its named reference or a numeric one, decimal or hex. */
const ESCAPED = {
  "&": /&amp;|&#0*38;|&#x0*26;/i,
  "<": /&lt;|&#0*60;|&#x0*3c;/i,
  ">": /&gt;|&#0*62;|&#x0*3e;/i,
  '"': /&quot;|&#0*34;|&#x0*22;/i,
  "'": /&apos;|&#0*39;|&#x0*27;/i,
};

describe("the screens' texts", () => {
  // @spec DESK-SHELL-WIN-001, DESK-SHELL-WIN-002, DESK-SHELL-WIN-021, DESK-SHELL-WIN-032
  it("are exactly the specs' words", () => {
    expect(SCREEN_TEXT).toEqual({
      start: "Starting MSFS Career Map…",
      failure: "MSFS Career Map could not start its server",
      failureHint: "Choose Try again or Show log in the tray icon's menu.",
      quitting: "Quitting MSFS Career Map…",
      stopped: "The page stopped. Close this window and open it again from the tray.",
    });
  });

  // @spec DESK-SHELL-WIN-001
  it("shows the start screen's text", () => {
    const html = screenHtml({ kind: "start" });
    expect(html).toContain("Starting MSFS Career Map…");
    expect(screenOf(screenUrl({ kind: "start" }), 3280)).toBe("start");
  });

  // @spec DESK-SHELL-WIN-032
  it("shows the quitting screen's text", () => {
    expect(screenHtml({ kind: "quitting" })).toContain("Quitting MSFS Career Map…");
    expect(screenOf(screenUrl({ kind: "quitting" }), 3280)).toBe("quitting");
  });

  // @spec DESK-SHELL-WIN-021
  it("shows the stopped screen's text", () => {
    expect(screenHtml({ kind: "stopped" })).toContain("The page stopped. Close this window and open it again from the tray.");
    expect(screenOf(screenUrl({ kind: "stopped" }), 3280)).toBe("stopped");
  });

  // @spec DESK-SHELL-WIN-002
  it("shows the failure screen's heading, then the reason, then the hint", () => {
    const reason = "Windows reserves port 3280 (an excluded port range); restarting Windows may free it";
    const html = screenHtml({ kind: "failure", reason });
    expect(html).toContain("MSFS Career Map could not start its server");
    const text = textOf(html);
    const heading = text.indexOf("MSFS Career Map could not start its server");
    const at = text.indexOf(reason);
    const hint = text.indexOf("Choose Try again or Show log in the tray icon's menu.");
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(at).toBeGreaterThan(heading);
    expect(hint).toBeGreaterThan(at);
    expect(screenOf(screenUrl({ kind: "failure", reason }), 3280)).toBe("failure");
  });
});

describe("the failure screen's reason", () => {
  // @spec DESK-SHELL-WIN-002
  it("is HTML-escaped, each of & < > \" '", () => {
    const reason = `Port 3280 is in use by <another> program & "quoted" or 'single' here`;
    const html = screenHtml({ kind: "failure", reason });
    expect(html).not.toContain("<another>");
    expect(html).not.toContain("program & ");
    expect(html).not.toContain(`"quoted"`);
    expect(html).not.toContain(`'single'`);
    for (const [ch, escaped] of Object.entries(ESCAPED)) expect(html, ch).toMatch(escaped);
    expect(textOf(html)).toContain(reason);
  });

  // @spec DESK-SHELL-WIN-002
  it("escapes the screen's own texts too: the hint's apostrophe", () => {
    const html = screenHtml({ kind: "failure", reason: "The server stopped responding" });
    expect(html).not.toContain("icon's menu");
    expect(textOf(html)).toContain("Choose Try again or Show log in the tray icon's menu.");
  });

  // @spec DESK-SHELL-WIN-002
  it("can carry no markup into the screen", () => {
    const reason = `</title></style><script>alert(1)</script><img src=x onerror=alert(2)>`;
    const html = screenHtml({ kind: "failure", reason });
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/<img/i);
    expect(textOf(html)).toContain(reason);
  });
});

describe("every screen", () => {
  // @spec DESK-SHELL-WIN-001, DESK-SHELL-WIN-002, DESK-SHELL-WIN-021, DESK-SHELL-WIN-032
  it("is a whole document titled MSFS Career Map, with a CSP that loads nothing", () => {
    for (const s of ALL) {
      const html = screenHtml(s);
      expect(html, s.kind).toMatch(/<html[\s>]/i);
      expect(html, s.kind).toMatch(/<\/html>/i);
      expect(html, s.kind).toMatch(/<body[\s>]/i);
      expect(html, s.kind).toContain("<title>MSFS Career Map</title>");
      expect(html, s.kind).toContain(CSP);
    }
  });

  // @spec DESK-SHELL-WIN-001, DESK-SHELL-WIN-028
  it("draws on the page's dark background in the page's text colour", () => {
    for (const s of ALL) {
      const html = screenHtml(s);
      expect(html.toLowerCase(), s.kind).toContain("#0a0e13");
      expect(html.toLowerCase(), s.kind).toContain("#e8edf2");
    }
  });

  // @spec DESK-SHELL-WIN-001
  it("refers to no address: nothing with src= or href=, no url( or @import", () => {
    for (const s of ALL) {
      const html = screenHtml(s);
      expect(html, s.kind).not.toMatch(/\bsrc\s*=/i);
      expect(html, s.kind).not.toMatch(/\bhref\s*=/i);
      expect(html, s.kind).not.toMatch(/url\s*\(/i);
      expect(html, s.kind).not.toMatch(/@import/i);
    }
  });

  // @spec DESK-SHELL-WIN-001
  it("is loaded as a UTF-8 data: URL of its HTML", () => {
    for (const s of ALL) {
      const url = screenUrl(s);
      expect(url, s.kind).toBe("data:text/html;charset=utf-8," + encodeURIComponent(screenHtml(s)));
      expect(screenHtmlOf(url), s.kind).toBe(screenHtml(s));
    }
  });
});
