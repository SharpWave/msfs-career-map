/**
 * The window's address rules (src/desktop/address.ts; m2 contract §13.1): the window and every
 * frame in it load only the page's own origin, `http://127.0.0.1:<port>` (DESK-SHELL-WIN-005);
 * another http or https address navigated to, or asked for as a new window, goes to the pilot's
 * default browser (WIN-006, WIN-007); a new window on the own origin is refused (WIN-008); any
 * other kind of address is refused (WIN-009); and the browser is handed only an http or https
 * address with a host, re-serialised (WIN-010).
 *
 * Acting on an outcome (`preventDefault`, `openExternal`, the `[window] …` log lines) is the
 * Electron glue's (§16), which the unit tests do not load.
 */
import { describe, expect, it } from "vitest";
import { browserAddress, isOwnOrigin, navigationOutcome, newWindowOutcome } from "../../../src/desktop/address.ts";

/** A stand-in port: nothing listens on it. */
const PORT = 3280;

const OWN = [
  "http://127.0.0.1:3280/",
  "http://127.0.0.1:3280",
  "http://127.0.0.1:3280/api/hops?aircraft=3",
  "http://127.0.0.1:3280/#hop=42",
  "http://127.0.0.1:3280/#pending=5d2f6a3e-1c0b-4a8e-9b1d-0f3c2e7a9b11",
  "http://127.0.0.1:3280/images/aircraft/7.png",
];

const NOT_OWN = [
  "http://localhost:3280/",
  "http://[::1]:3280/",
  "http://127.0.0.1:3281/",
  "http://127.0.0.1:3380/",
  "https://127.0.0.1:3280/",
  "http://127.0.0.2:3280/",
  "http://127.0.0.1/",
  "https://www.simbrief.com/system/dispatch.php",
];

const OUTSIDE = [
  "https://www.simbrief.com/system/dispatch.php?type=api&orig=KBOS&dest=KPVD",
  "https://en.wikipedia.org/wiki/Logan_International_Airport",
  "https://skyvector.com/airport/KBOS",
  "https://aviationweather.gov/data/metar/?ids=KBOS",
  "http://www.massport.com/logan-airport",
  "https://www.openstreetmap.org/copyright",
];

/** Neither http nor https with a host, or not an address at all. */
const OTHER_KINDS = [
  "file:///C:/Users/pilot/Documents/plan.pdf",
  "file://server/share/plan.pdf",
  "javascript:alert(1)",
  "data:text/html,<p>hi</p>",
  "about:blank",
  "mailto:pilot@example.com",
  "ftp://example.com/plan.pdf",
  "chrome://settings",
  "devtools://devtools/bundled/inspector.html",
  "not an address",
  "",
  "http://",
];

describe("the own origin", () => {
  // @spec DESK-SHELL-WIN-005
  it("is http on 127.0.0.1 at the given port, with any path, query or fragment", () => {
    for (const url of OWN) expect(isOwnOrigin(url, PORT), url).toBe(true);
  });

  // @spec DESK-SHELL-WIN-005
  it("is not localhost, [::1], another port, https, another address or something unparseable", () => {
    for (const url of NOT_OWN) expect(isOwnOrigin(url, PORT), url).toBe(false);
    for (const url of OTHER_KINDS) expect(isOwnOrigin(url, PORT), url).toBe(false);
  });

  // @spec DESK-SHELL-WIN-005
  it("follows the port it is given", () => {
    expect(isOwnOrigin("http://127.0.0.1:3380/", 3380)).toBe(true);
    expect(isOwnOrigin("http://127.0.0.1:3280/", 3380)).toBe(false);
  });
});

describe("a navigation of the window or a frame", () => {
  // @spec DESK-SHELL-WIN-005
  it("loads an address on the own origin", () => {
    for (const url of OWN) expect(navigationOutcome(url, PORT), url).toBe("load");
  });

  // @spec DESK-SHELL-WIN-006
  it("sends any other http or https address with a host to the browser", () => {
    for (const url of OUTSIDE) expect(navigationOutcome(url, PORT), url).toBe("browser");
    for (const url of NOT_OWN) expect(navigationOutcome(url, PORT), url).toBe("browser");
  });

  // @spec DESK-SHELL-WIN-009
  it("refuses file:, javascript:, data:, about:, mailto:, other schemes and anything unparseable", () => {
    for (const url of OTHER_KINDS) expect(navigationOutcome(url, PORT), url).toBe("refuse");
  });
});

describe("a new window asked for by the page", () => {
  // @spec DESK-SHELL-WIN-007
  it("opens an outside http or https address in the browser", () => {
    for (const url of OUTSIDE) expect(newWindowOutcome(url, PORT), url).toBe("browser");
    for (const url of NOT_OWN) expect(newWindowOutcome(url, PORT), url).toBe("browser");
  });

  // @spec DESK-SHELL-WIN-008
  it("refuses one on the own origin as refuse-own", () => {
    for (const url of OWN) expect(newWindowOutcome(url, PORT), url).toBe("refuse-own");
  });

  // @spec DESK-SHELL-WIN-009
  it("refuses any other kind of address", () => {
    for (const url of OTHER_KINDS) expect(newWindowOutcome(url, PORT), url).toBe("refuse");
  });
});

describe("the address handed to the browser", () => {
  // @spec DESK-SHELL-WIN-010
  it("is the re-serialised form of an http or https address with a host", () => {
    expect(browserAddress("https://example.com")).toBe("https://example.com/");
    expect(browserAddress("HTTPS://SkyVector.COM/airport/KBOS")).toBe("https://skyvector.com/airport/KBOS");
    expect(browserAddress("https://en.wikipedia.org/wiki/Boston Logan")).toBe("https://en.wikipedia.org/wiki/Boston%20Logan");
    expect(browserAddress("http://www.massport.com:80/logan-airport")).toBe("http://www.massport.com/logan-airport");
    expect(browserAddress("https://www.simbrief.com/system/dispatch.php?orig=KBOS&dest=KPVD#top")).toBe(
      "https://www.simbrief.com/system/dispatch.php?orig=KBOS&dest=KPVD#top",
    );
    for (const url of OUTSIDE) expect(browserAddress(url), url).toBe(new URL(url).href);
  });

  // @spec DESK-SHELL-WIN-010
  it("is null for anything else", () => {
    for (const url of OTHER_KINDS) expect(browserAddress(url), url).toBeNull();
  });
});
