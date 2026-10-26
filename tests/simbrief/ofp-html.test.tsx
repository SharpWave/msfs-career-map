import { describe, expect, it } from "vitest";
import { cleanOfpHtml, outsideLink } from "../../src/client/ofp-html.ts";

/** The installed app's page, with a hand-off fragment the plan must not be able to change. */
const PAGE = "http://127.0.0.1:3380/#hop=5";

/** A plan's OFP text as the card would show it, parsed back into elements to look at. */
function shown(html: string): HTMLDivElement {
  const box = document.createElement("div");
  box.innerHTML = cleanOfpHtml(html, PAGE);
  return box;
}

const tags = (box: Element) => Array.from(box.querySelectorAll("*"), (e) => e.localName);
const attrs = (e: Element) => e.getAttributeNames().sort();

describe("the OFP text, cleaned through an allowlist", () => {
  // @spec SB-CARD-006
  it("keeps the text, the layout elements and the table layout attributes", () => {
    const box = shown(
      '<div style="line-height:14px"><pre><b>FUEL</b> <i>PLAN</i><br>' +
        '<table border="1" cellpadding="2" cellspacing="0" width="100%"><caption>Burn</caption><colgroup><col width="50"></colgroup>' +
        '<thead><tr><th align="left" valign="top">TRIP</th></tr></thead><tbody><tr><td colspan="2" rowspan="1" height="10">1234</td></tr></tbody></table>' +
        '</pre><h1>OFP</h1><h6>end</h6><hr><p><span title="Block fuel">BLOCK</span> <small>a</small><big>b</big><sub>c</sub><sup>d</sup>' +
        "<code>e</code><tt>f</tt><u>g</u><s>h</s><strong>i</strong><em>j</em></p><ul><li>k</li></ul><ol><li>l</li></ol><dl><dt>m</dt><dd>n</dd></dl>" +
        "<font>o</font><center>p</center></div>",
    );
    expect(tags(box)).toEqual([
      "div", "pre", "b", "i", "br", "table", "caption", "colgroup", "col", "thead", "tr", "th", "tbody", "tr", "td",
      "h1", "h6", "hr", "p", "span", "small", "big", "sub", "sup", "code", "tt", "u", "s", "strong", "em",
      "ul", "li", "ol", "li", "dl", "dt", "dd", "font", "center",
    ]);
    expect(attrs(box.querySelector("table")!)).toEqual(["border", "cellpadding", "cellspacing", "width"]);
    expect(attrs(box.querySelector("th")!)).toEqual(["align", "valign"]);
    expect(attrs(box.querySelector("td")!)).toEqual(["colspan", "height", "rowspan"]);
    expect(box.querySelector("span")!.getAttribute("title")).toBe("Block fuel");
    expect(box.textContent).toBe("FUEL PLANBurnTRIP1234OFPendBLOCK abcdefghijklmnop");
  });

  // @spec SB-CARD-006
  it("removes scripts, style sheets, <base> and <meta>, with what a script or style sheet holds", () => {
    const box = shown(
      '<base href="http://evil.example/"><meta http-equiv="refresh" content="0;url=/#hop=9"><link rel="stylesheet" href="https://evil.example/x.css">' +
        "<style>body { display: none }</style><script>window.ran = 1</script><pre>FUEL</pre>",
    );
    expect(tags(box)).toEqual(["pre"]);
    expect(box.textContent).toBe("FUEL");
  });

  // @spec SB-CARD-006
  it("removes every event-handler attribute", () => {
    const box = shown('<div onclick="x()" onmouseover="y()" onfocus="z()" tabindex="0">FUEL</div>');
    expect(attrs(box.querySelector("div")!)).toEqual([]);
  });

  // @spec SB-CARD-006
  it("removes forms and their controls, keeping their text", () => {
    const box = shown(
      '<form action="/api/hops" method="post"><input name="origin" value="KBOS"><select><option>A</option></select>' +
        '<textarea>T</textarea><button type="submit">Go</button><label>L</label></form><pre>FUEL</pre>',
    );
    expect(tags(box)).toEqual(["pre"]);
    expect(box.querySelector("[name]")).toBeNull();
    expect(box.textContent).toBe("ATGoLFUEL");
  });

  // @spec SB-CARD-006
  it("removes frames, objects, embeds, SVG and MathML with what they hold", () => {
    const box = shown(
      '<iframe src="/">frame text</iframe><object data="/x">object text</object><embed src="/y">' +
        '<svg><text>svg text</text><a href="https://evil.example/">svg link</a></svg><math><mi>math text</mi></math><pre>FUEL</pre>',
    );
    expect(tags(box)).toEqual(["pre"]);
    expect(box.textContent).toBe("FUEL");
  });

  // @spec SB-CARD-006
  it("keeps no colour, size or face on a font", () => {
    const box = shown('<font color="red" size="7" face="Comic Sans MS">FUEL</font>');
    expect(attrs(box.querySelector("font")!)).toEqual([]);
  });

  // @spec SB-CARD-006
  it("removes every id, name, class, data-*, aria-* and role attribute, keeping title", () => {
    const box = shown(
      '<div id="root" name="menu" class="flight-panel" data-handoff-focus="1" aria-label="x" aria-hidden="true" role="menu" title="t">FUEL</div>',
    );
    expect(attrs(box.querySelector("div")!)).toEqual(["title"]);
  });

  // @spec SB-CARD-006
  it("keeps the text inside an element it removes", () => {
    const box = shown("<section><article><marquee>KEPT</marquee></article></section><nav>ALSO</nav>");
    expect(tags(box)).toEqual([]);
    expect(box.textContent).toBe("KEPTALSO");
  });
});

describe("an address taken from a plan", () => {
  // @spec SB-CARD-009
  it("is kept, resolved and re-serialised, when it reaches an http or https address on another origin", () => {
    expect(outsideLink("https://www.simbrief.com/ofp/flightplans/KBOSKPVD.pdf", PAGE)).toBe("https://www.simbrief.com/ofp/flightplans/KBOSKPVD.pdf");
    expect(outsideLink(" HTTPS://WWW.SimBrief.com/a b ", PAGE)).toBe("https://www.simbrief.com/a%20b");
    expect(outsideLink("//www.simbrief.com/x", PAGE)).toBe("http://www.simbrief.com/x");
    expect(outsideLink("http://127.0.0.1:5173/", PAGE)).toBe("http://127.0.0.1:5173/");
    expect(outsideLink("https://127.0.0.1:3380/", PAGE)).toBe("https://127.0.0.1:3380/");
  });

  // @spec SB-CARD-009
  it("is not kept when the page would resolve it to its own origin", () => {
    for (const a of ["http:/api/hops", "/api/hops", "api/hops", "?x=1", "#hop=3", "", "http://127.0.0.1:3380/api/hops", "HTTP://127.0.0.1:3380#pending=1"]) {
      expect(outsideLink(a, PAGE), a).toBeNull();
    }
  });

  // @spec SB-CARD-009
  it("is not kept for any other scheme, or when it does not parse", () => {
    for (const a of ["javascript:alert(1)", "java\tscript:alert(1)", " JavaScript:alert(1)", "data:text/html,<b>x</b>", "file:///C:/x", "mailto:a@b.example", "ftp://x.example/", "https://", "http://[::1"]) {
      expect(outsideLink(a, PAGE), a).toBeNull();
    }
    expect(outsideLink(null, PAGE)).toBeNull();
    expect(outsideLink(undefined, PAGE)).toBeNull();
  });

  // @spec SB-CARD-009
  it("is a link opening as a new window inside the OFP text when kept", () => {
    const box = shown('<a href=" HTTPS://WWW.SimBrief.com/x" target="_self" rel="opener" title="SimBrief">SimBrief</a>');
    const a = box.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://www.simbrief.com/x");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("title")).toBe("SimBrief");
  });

  // @spec SB-CARD-009
  it("is shown as what the link holds, with no link, when not kept", () => {
    const box = shown(
      '<pre><a href="#hop=3"><b>HOP</b> 3</a> <a href="/api/hops">R</a> <a href="javascript:alert(1)">J</a> <a name="top">T</a> <a>N</a></pre>',
    );
    expect(box.querySelector("a")).toBeNull();
    expect(box.querySelector("pre")!.innerHTML).toBe("<b>HOP</b> 3 R J T N");
  });
});

describe("nothing in the OFP text loads", () => {
  // @spec SB-CARD-010
  it("removes images and media", () => {
    const box = shown(
      '<img src="https://x.example/a.png"><picture><source srcset="/b.png"></picture><video src="/c.mp4" poster="/d.png">v</video>' +
        '<audio src="/e.mp3">a</audio><pre>FUEL</pre>',
    );
    expect(tags(box)).toEqual(["pre"]);
  });

  // @spec SB-CARD-010
  it("removes every attribute that names an address, a link's own href aside", () => {
    const box = shown(
      '<table background="/a.png"><tr><td background="https://x.example/b.png">1</td></tr></table>' +
        '<div src="/c" href="https://x.example/" poster="/d" srcset="/e" lowsrc="/f" action="/g" formaction="/h" xlink:href="/i">2</div>',
    );
    expect(attrs(box.querySelector("table")!)).toEqual([]);
    expect(attrs(box.querySelector("td")!)).toEqual([]);
    expect(attrs(box.querySelector("div")!)).toEqual([]);
  });

  // @spec SB-CARD-010
  it("removes the whole style of an element whose style names an address or holds a CSS escape", () => {
    const styles = [
      "color: red; background: url(https://x.example/a.png)",
      "color: red; background-image: URL('/b.png')",
      "color: red; background-image: image-set('/c.png' 1x)",
      "color: red; background-image: -webkit-image-set('/d.png' 1x)",
      "color: red; background-image: Image-Set('/e.png' 1x)",
      "color: red; background: u\\72l(/f.png)",
      "color: red; font-family: \\41 rial",
    ];
    for (const s of styles) {
      const box = shown(`<div style="${s.replace(/"/g, "&quot;")}">FUEL</div>`);
      expect(box.querySelector("div")!.hasAttribute("style"), s).toBe(false);
    }
  });

  // @spec SB-CARD-010
  it("keeps a style that names no address", () => {
    const span = shown('<span style="font-weight: bold; text-decoration: underline">FUEL</span>').querySelector("span")!;
    expect(span.style.getPropertyValue("font-weight")).toBe("bold");
    expect(span.style.getPropertyValue("text-decoration")).toBe("underline");
  });
});

describe("the OFP text kept in its box", () => {
  // @spec SB-CARD-011
  it("takes !important off every kept inline style", () => {
    const span = shown('<span style="color: red !important; font-weight: bold !IMPORTANT; font-size: 40px">FUEL</span>').querySelector("span")!;
    expect(span.style.getPropertyValue("color")).toBe("red");
    expect(span.style.getPropertyValue("font-weight")).toBe("bold");
    expect(span.style.getPropertyValue("font-size")).toBe("40px");
    for (const p of ["color", "font-weight", "font-size"]) expect(span.style.getPropertyPriority(p), p).toBe("");
    expect(span.getAttribute("style")).not.toMatch(/important/i);
  });
});
