/**
 * The notifications' pure parts (src/desktop/toast.ts; m5a contract §4.1): the click's launch string
 * and its parser (DESK-SHELL-NOTE-012, NOTE-014), the page's fragment for a hop or pending leg
 * (NOTE-012), the toast's XML — silent while the sim is in use, never urgent (AWAY-004, NOTE-011) — the
 * Start-menu shortcut and whether it lacks the CLSID (NOTE-013), and the keys and command `--unregister`
 * uses to remove the registrations (NOTE-017).
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { APP_ID, TOAST_CLSID } from "../../../src/desktop/identity.ts";
import {
  aumidKey,
  clearHistoryArgs,
  clsidKey,
  fragmentOf,
  lacksClsid,
  launchOf,
  parseLaunch,
  regDeleteKeyArgs,
  startMenuShortcut,
  toastXml,
} from "../../../src/desktop/toast.ts";
import type { NoticeTarget } from "../../../src/desktop/ports.ts";

const PENDING_ID = "6f1c2a7e-9d4b-4e21-8c3a-1b2d3e4f5a6b";

describe("the click's launch string", () => {
  // @spec DESK-SHELL-NOTE-012, DESK-SHELL-NOTE-014
  it("names each target and reads back as it", () => {
    const targets: [NoticeTarget, string][] = [
      [{ kind: "window" }, "window"],
      [{ kind: "failure" }, "failure"],
      [{ kind: "hop", id: 12 }, "hop=12"],
      [{ kind: "pending", id: PENDING_ID }, `pending=${PENDING_ID}`],
    ];
    for (const [t, s] of targets) {
      expect(launchOf(t)).toBe(s);
      expect(parseLaunch(s)).toEqual(t);
    }
  });

  // @spec DESK-SHELL-NOTE-012
  it("encodes a pending id that holds characters a URL would read otherwise, and decodes it back", () => {
    const id = "a b&c#d";
    expect(launchOf({ kind: "pending", id })).toBe(`pending=${encodeURIComponent(id)}`);
    expect(parseLaunch(launchOf({ kind: "pending", id }))).toEqual({ kind: "pending", id });
  });

  // @spec DESK-SHELL-NOTE-014
  it("trims what Windows hands back, takes an empty string as the window, and refuses anything else", () => {
    expect(parseLaunch("  hop=7 ")).toEqual({ kind: "hop", id: 7 });
    expect(parseLaunch("")).toEqual({ kind: "window" });
    for (const s of ["hop=", "hop=abc", "hop=1.5", "hop=-3", "pending=", "update", "window=1", "hop=12&x=1"]) {
      expect(parseLaunch(s), s).toBeNull();
    }
  });
});

describe("the page's fragment", () => {
  // @spec DESK-SHELL-NOTE-012
  it("is hop=<id> or pending=<id> for a hop or a pending leg, and none for the window or the failure screen", () => {
    expect(fragmentOf({ kind: "hop", id: 12 })).toBe("hop=12");
    expect(fragmentOf({ kind: "pending", id: PENDING_ID })).toBe(`pending=${PENDING_ID}`);
    expect(fragmentOf({ kind: "pending", id: "a b" })).toBe("pending=a%20b");
    expect(fragmentOf({ kind: "window" })).toBeNull();
    expect(fragmentOf({ kind: "failure" })).toBeNull();
  });
});

describe("the toast's XML", () => {
  // @spec DESK-SHELL-NOTE-011, DESK-SHELL-AWAY-004
  it("holds the launch string, the title and one text per body line, with no audio element while not silent", () => {
    expect(toastXml({ title: "Hop logged", body: "Logged KBOS → KPVD, 45 min", launch: "hop=12", silent: false })).toBe(
      '<toast launch="hop=12" activationType="foreground"><visual><binding template="ToastGeneric">' +
        "<text>Hop logged</text><text>Logged KBOS → KPVD, 45 min</text></binding></visual></toast>",
    );
  });

  // @spec DESK-SHELL-AWAY-004
  it("is silent while the sim is in use", () => {
    const xml = toastXml({ title: "Leg waiting to be logged", body: "Cessna 172\nNo aircraft matches", launch: `pending=${PENDING_ID}`, silent: true });
    expect(xml).toBe(
      `<toast launch="pending=${PENDING_ID}" activationType="foreground"><visual><binding template="ToastGeneric">` +
        "<text>Leg waiting to be logged</text><text>Cessna 172</text><text>No aircraft matches</text></binding></visual>" +
        '<audio silent="true"/></toast>',
    );
  });

  // @spec DESK-SHELL-NOTE-011
  it("never asks to get past Do Not Disturb or Focus: no scenario, no urgency", () => {
    const xml = toastXml({ title: "MSFS Career Map stopped tracking", body: "x", launch: "failure", silent: false });
    expect(xml).not.toMatch(/scenario|urgent|priority/i);
  });

  // @spec DESK-SHELL-NOTE-005
  it("escapes the tracker's and server's words and the launch string", () => {
    const xml = toastXml({ title: "Hop logged", body: `Logged <KBOS> & "KPVD" 'x'`, launch: "pending=a%26b", silent: false });
    expect(xml).toContain("<text>Logged &lt;KBOS&gt; &amp; &quot;KPVD&quot; &apos;x&apos;</text>");
    expect(xml).toContain('launch="pending=a%26b"');
    expect(toastXml({ title: "t", body: "b", launch: 'a"&<', silent: false })).toContain('launch="a&quot;&amp;&lt;"');
  });
});

describe("the Start-menu shortcut", () => {
  // @spec DESK-SHELL-NOTE-013
  it("is MSFS Career Map.lnk in the account's Start-menu programs", () => {
    expect(startMenuShortcut("C:\\Users\\Pilot\\AppData\\Roaming")).toBe(
      path.win32.join("C:\\Users\\Pilot\\AppData\\Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "MSFS Career Map.lnk"),
    );
  });

  // @spec DESK-SHELL-NOTE-013
  it("lacks the CLSID when it carries none or another, and not when it carries the app's in any case, with or without braces", () => {
    expect(lacksClsid({})).toBe(true);
    expect(lacksClsid({ toastActivatorClsid: "" })).toBe(true);
    expect(lacksClsid({ toastActivatorClsid: "{00000000-0000-0000-0000-000000000000}" })).toBe(true);
    expect(lacksClsid({ toastActivatorClsid: TOAST_CLSID })).toBe(false);
    expect(lacksClsid({ toastActivatorClsid: TOAST_CLSID.toLowerCase() })).toBe(false);
    expect(lacksClsid({ toastActivatorClsid: TOAST_CLSID.slice(1, -1) })).toBe(false);
  });
});

describe("the registrations --unregister removes", () => {
  // @spec DESK-SHELL-NOTE-017
  it("are the CLSID's key and the AppUserModelId key under HKCU\\Software\\Classes", () => {
    expect(clsidKey()).toBe(`HKCU\\Software\\Classes\\CLSID\\${TOAST_CLSID}`);
    expect(aumidKey()).toBe(`HKCU\\Software\\Classes\\AppUserModelId\\${APP_ID}`);
  });

  // @spec DESK-SHELL-NOTE-017
  it("are deleted whole with reg.exe, without asking", () => {
    expect(regDeleteKeyArgs(clsidKey())).toEqual(["delete", clsidKey(), "/f"]);
  });

  // @spec DESK-SHELL-NOTE-017
  it("include the app's notifications, cleared from the notification centre through PowerShell", () => {
    const args = clearHistoryArgs();
    expect(args.slice(0, 3)).toEqual(["-NoProfile", "-NonInteractive", "-Command"]);
    expect(args).toHaveLength(4);
    expect(args[3]).toContain("ToastNotificationManager");
    expect(args[3]).toContain("History");
    expect(args[3]).toContain("Clear");
    expect(args[3]).toContain(`'${APP_ID}'`);
  });
});
