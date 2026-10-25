/**
 * The screens the window shows in place of the page: whole documents in `data:` URLs, packaged with
 * the shell, that load nothing from any address.
 */

export type Screen = { kind: "start" } | { kind: "failure"; reason: string } | { kind: "quitting" } | { kind: "stopped" };

export const SCREEN_TEXT = {
  start: "Starting MSFS Career Map…",
  failure: "MSFS Career Map could not start its server",
  failureHint: "Choose Try again or Show log in the tray icon's menu.",
  quitting: "Quitting MSFS Career Map…",
  stopped: "The page stopped. Close this window and open it again from the tray.",
} as const;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);
}

const STYLE = [
  "html, body { margin: 0; height: 100%; }",
  "body { background: #0a0e13; color: #e8edf2; font: 15px/1.5 'Segoe UI', system-ui, sans-serif;",
  "  display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }",
  "h1 { font-size: 20px; font-weight: 600; margin: 0 24px 12px; }",
  "p { margin: 0 24px 8px; max-width: 640px; }",
  ".hint { opacity: 0.75; }",
].join("\n");

function body(s: Screen): string {
  switch (s.kind) {
    case "start":
      return `<h1>${escapeHtml(SCREEN_TEXT.start)}</h1>`;
    case "failure":
      return [
        `<h1>${escapeHtml(SCREEN_TEXT.failure)}</h1>`,
        `<p>${escapeHtml(s.reason)}</p>`,
        `<p class="hint">${escapeHtml(SCREEN_TEXT.failureHint)}</p>`,
      ].join("\n");
    case "quitting":
      return `<h1>${escapeHtml(SCREEN_TEXT.quitting)}</h1>`;
    case "stopped":
      return `<h1>${escapeHtml(SCREEN_TEXT.stopped)}</h1>`;
  }
}

/** A whole document: the title, a CSP that loads nothing, the page's colours and the screen's text, every text escaped. */
// @spec DESK-SHELL-WIN-001, DESK-SHELL-WIN-002, DESK-SHELL-WIN-021, DESK-SHELL-WIN-032
export function screenHtml(s: Screen): string {
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
    "<title>MSFS Career Map</title>",
    `<style>\n${STYLE}\n</style>`,
    "</head>",
    "<body>",
    body(s),
    "</body>",
    "</html>",
  ].join("\n");
}

/** The screen as a UTF-8 `data:` URL. */
export function screenUrl(s: Screen): string {
  return "data:text/html;charset=utf-8," + encodeURIComponent(screenHtml(s));
}
