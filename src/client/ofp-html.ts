import DOMPurify from "dompurify";

/**
 * A SimBrief plan's OFP text is SimBrief's HTML, shown on the page's own origin, where anything
 * active in it would act as the page. It is shown as text and layout only: cleaned through an
 * allowlist, its links kept only to other origins, nothing in it able to load, and every kept
 * inline style stripped of `!important` so the box's own rules win (simbrief-design, The OFP Text).
 */

const KEPT_TAGS = [
  "div", "span", "p", "br", "hr", "pre", "h1", "h2", "h3", "h4", "h5", "h6",
  "b", "strong", "i", "em", "u", "s", "small", "big", "sub", "sup", "code", "tt", "font", "center",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "caption", "thead", "tbody", "tfoot", "tr", "th", "td", "col", "colgroup",
  "a",
];

/** `href` is kept only on a link, and only as `outsideLink` judges it. */
const KEPT_ATTRS = ["style", "title", "align", "valign", "width", "height", "colspan", "rowspan", "border", "cellpadding", "cellspacing", "href"];

/** Removed with what they hold, beside DOMPurify's own list (scripts, style sheets, SVG, MathML, media…). */
const DROPPED_WITH_CONTENTS = ["frame", "frameset", "iframe", "noframes", "object", "embed", "applet"];

/** An inline style that names an address, or holds a CSS escape that could spell one. */
const STYLE_NAMES_ADDRESS = /url\(|image-set\(|\\/i;

/**
 * An address from a plan, resolved as the page would resolve it, when it is an http or https
 * address with a host on another origin than the page's; else null.
 * @spec SB-CARD-009
 */
export function outsideLink(address: string | null | undefined, pageHref: string = window.location.href): string | null {
  if (address == null) return null;
  let url: URL;
  try {
    url = new URL(address, pageHref);
  } catch {
    return null;
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.host) return null;
  if (url.origin === new URL(pageHref).origin) return null;
  return url.href;
}

/**
 * The plan's OFP text as the SimBrief card shows it.
 * @spec SB-CARD-006, SB-CARD-009, SB-CARD-010, SB-CARD-011
 */
export function cleanOfpHtml(html: string, pageHref: string = window.location.href): string {
  // With RETURN_DOM, DOMPurify hands back the cleaned document's <body>, though it is typed as a Node.
  const body = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: KEPT_TAGS,
    ALLOWED_ATTR: KEPT_ATTRS,
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    ADD_FORBID_CONTENTS: DROPPED_WITH_CONTENTS,
    RETURN_DOM: true,
  }) as HTMLElement;

  for (const el of Array.from(body.querySelectorAll("[href]"))) if (el.localName !== "a") el.removeAttribute("href");

  for (const a of Array.from(body.querySelectorAll("a"))) {
    const href = outsideLink(a.getAttribute("href"), pageHref);
    if (href) {
      a.setAttribute("href", href);
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    } else {
      a.replaceWith(...Array.from(a.childNodes));
    }
  }

  for (const el of Array.from(body.querySelectorAll<HTMLElement>("[style]"))) {
    if (STYLE_NAMES_ADDRESS.test(el.getAttribute("style") ?? "")) {
      el.removeAttribute("style");
      continue;
    }
    // Written back through the browser's own parsing, without each declaration's priority.
    const declarations: [string, string][] = [];
    for (let i = 0; i < el.style.length; i++) {
      const property = el.style.item(i);
      declarations.push([property, el.style.getPropertyValue(property)]);
    }
    el.removeAttribute("style");
    for (const [property, value] of declarations) el.style.setProperty(property, value);
    if (!el.getAttribute("style")) el.removeAttribute("style");
  }

  return body.innerHTML;
}
