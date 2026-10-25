import path from "node:path";
import { APP_ID, PRODUCT_NAME, TOAST_CLSID } from "./identity.ts";
import type { NoticeTarget } from "./ports.ts";

/**
 * The notifications' pure parts: the click's launch string carried in the toast and read back from
 * Electron's activation, the page's fragment for a hop or pending leg, the toast's XML, the Start-menu
 * shortcut and whether it lacks the CLSID, and the keys and command `--unregister` removes them with.
 * Nothing here runs anything.
 */

/** "window" | "failure" | "hop=12" | "pending=<id, URI-encoded>". */
// @spec DESK-SHELL-NOTE-012, DESK-SHELL-NOTE-014
export function launchOf(t: NoticeTarget): string {
  switch (t.kind) {
    case "window":
    case "failure":
      return t.kind;
    case "hop":
      return `hop=${t.id}`;
    case "pending":
      return `pending=${encodeURIComponent(t.id)}`;
  }
}

/** launchOf's inverse, trimmed; "" is the window; anything else is null. */
// @spec DESK-SHELL-NOTE-014
export function parseLaunch(s: string): NoticeTarget | null {
  const text = s.trim();
  if (text === "" || text === "window") return { kind: "window" };
  if (text === "failure") return { kind: "failure" };
  const hop = /^hop=(\d+)$/.exec(text);
  if (hop) return { kind: "hop", id: Number(hop[1]) };
  const pending = /^pending=([^&=]+)$/.exec(text);
  if (pending) {
    try {
      return { kind: "pending", id: decodeURIComponent(pending[1]) };
    } catch {
      return null;
    }
  }
  return null;
}

/** The page's fragment, without "#", for a hop or a pending leg; null for the window and the failure screen. */
// @spec DESK-SHELL-NOTE-012
export function fragmentOf(t: NoticeTarget): string | null {
  if (t.kind === "hop") return `hop=${t.id}`;
  if (t.kind === "pending") return `pending=${encodeURIComponent(t.id)}`;
  return null;
}

function xmlEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** A ToastGeneric toast: the title and one text per body line, silent when asked; never urgent, no scenario. */
// @spec DESK-SHELL-NOTE-011, DESK-SHELL-AWAY-004
export function toastXml(n: { title: string; body: string; launch: string; silent: boolean }): string {
  const texts = [n.title, ...n.body.split("\n")].map((t) => `<text>${xmlEscape(t)}</text>`).join("");
  const audio = n.silent ? '<audio silent="true"/>' : "";
  return `<toast launch="${xmlEscape(n.launch)}" activationType="foreground"><visual><binding template="ToastGeneric">${texts}</binding></visual>${audio}</toast>`;
}

/** <APPDATA>\Microsoft\Windows\Start Menu\Programs\MSFS Career Map.lnk, the installer's shortcut. */
// @spec DESK-SHELL-NOTE-013
export function startMenuShortcut(appData: string): string {
  return path.win32.join(appData, "Microsoft", "Windows", "Start Menu", "Programs", `${PRODUCT_NAME}.lnk`);
}

const bare = (clsid: string) => clsid.replace(/[{}]/g, "").toLowerCase();

/** Whether the shortcut's toastActivatorClsid differs from the app's, ignoring case and braces. */
// @spec DESK-SHELL-NOTE-013
export function lacksClsid(link: { toastActivatorClsid?: string }): boolean {
  const own = link.toastActivatorClsid;
  return own === undefined || own === "" || bare(own) !== bare(TOAST_CLSID);
}

export function clsidKey(): string {
  return `HKCU\\Software\\Classes\\CLSID\\${TOAST_CLSID}`;
}

export function aumidKey(): string {
  return `HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`;
}

/** A key deleted whole, without asking. */
// @spec DESK-SHELL-NOTE-017
export function regDeleteKeyArgs(key: string): string[] {
  return ["delete", key, "/f"];
}

/** PowerShell clearing the app's notifications from the notification centre. */
// @spec DESK-SHELL-NOTE-017
export function clearHistoryArgs(): string[] {
  return [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null; [Windows.UI.Notifications.ToastNotificationManager]::History.Clear('${APP_ID}')`,
  ];
}
