/**
 * The real updater's pure part (src/desktop/updater.ts; m5b contract §2.2): whether a found update's
 * installer is already in electron-updater's cache — `pending\update-info.json` naming a file that exists
 * in `pending\` with the sha512 the release gives — so a check counts it ready at once (DESK-SHELL-UPD-009,
 * UPD-026). The module loads without electron-updater, which main.ts passes in (DESK-SHELL-UPD-001); a
 * stand-in for its autoUpdater shows how `electronUpdater` sets it and answers the shell's calls.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cachedInstaller, electronUpdater, type AutoUpdaterLike } from "../../../src/desktop/updater.ts";
import { tempFolder } from "../support/fakes.ts";
import { takeGuardHits } from "../support/guard.ts";

const SHA = "kF3x7bKz0m1tYw2pQ9sV4uE8rN6cL5hG0jD3aB7nM2oP1qR8sT4vW9xY0zA1bC2dE3fG4hI5jK6lM7nO8pQ==";
const INSTALLER = "MSFS Career Map Setup 0.9.0.exe";
const info = (sha512 = SHA) => ({ version: "0.9.0", files: [{ sha512 }] });

let folders: string[] = [];
afterEach(() => {
  for (const f of folders) fs.rmSync(f, { recursive: true, force: true });
  folders = [];
});

/** A cache folder; `pending` holds what `o` asks for. */
function cache(o: { infoJson?: string | object; installer?: boolean } = {}): string {
  const folder = tempFolder("updater-cache-");
  folders.push(folder);
  const pending = path.join(folder, "pending");
  if (o.infoJson === undefined && !o.installer) return folder;
  fs.mkdirSync(pending, { recursive: true });
  if (o.infoJson !== undefined) {
    fs.writeFileSync(path.join(pending, "update-info.json"), typeof o.infoJson === "string" ? o.infoJson : JSON.stringify(o.infoJson));
  }
  if (o.installer) fs.writeFileSync(path.join(pending, INSTALLER), "MZ installer bytes");
  return folder;
}

describe("loading the module", () => {
  // @spec DESK-SHELL-TEST-001
  it("reaches no process, port or Electron", () => {
    expect(takeGuardHits()).toEqual([]);
  });
});

describe("an installer already in the cache", () => {
  // @spec DESK-SHELL-UPD-009, DESK-SHELL-UPD-026
  it("counts when update-info.json names an installer present in pending with the release's sha512", () => {
    const folder = cache({ infoJson: { fileName: INSTALLER, sha512: SHA, isAdminRightsRequired: false }, installer: true });
    expect(cachedInstaller(folder, info())).toBe(true);
  });

  // @spec DESK-SHELL-UPD-009
  it("does not count with another sha512 (another release's installer)", () => {
    const folder = cache({ infoJson: { fileName: INSTALLER, sha512: SHA }, installer: true });
    expect(cachedInstaller(folder, info("bm90IHRoZSBzYW1lIGluc3RhbGxlcg=="))).toBe(false);
  });

  // @spec DESK-SHELL-UPD-009
  it("does not count when the installer it names is gone", () => {
    const folder = cache({ infoJson: { fileName: INSTALLER, sha512: SHA } });
    expect(cachedInstaller(folder, info())).toBe(false);
  });

  // @spec DESK-SHELL-UPD-009
  it("does not count without update-info.json, without pending, or without a cache folder at all", () => {
    expect(cachedInstaller(cache({ installer: true }), info())).toBe(false);
    expect(cachedInstaller(cache(), info())).toBe(false);
    const gone = cache();
    fs.rmSync(gone, { recursive: true, force: true });
    expect(cachedInstaller(gone, info())).toBe(false);
  });

  // @spec DESK-SHELL-UPD-009
  it("does not count, and does not throw, when update-info.json cannot be read or lacks its fields", () => {
    expect(cachedInstaller(cache({ infoJson: "{ not json", installer: true }), info())).toBe(false);
    expect(cachedInstaller(cache({ infoJson: { sha512: SHA }, installer: true }), info())).toBe(false);
    expect(cachedInstaller(cache({ infoJson: { fileName: INSTALLER }, installer: true }), info())).toBe(false);
    expect(cachedInstaller(cache({ infoJson: "null", installer: true }), info())).toBe(false);
  });

  // @spec DESK-SHELL-UPD-009
  it("does not count when the release gives no file", () => {
    const folder = cache({ infoJson: { fileName: INSTALLER, sha512: SHA }, installer: true });
    expect(cachedInstaller(folder, { version: "0.9.0", files: [] })).toBe(false);
  });

  // @spec DESK-SHELL-UPD-009
  it("does not count a fileName reaching outside pending", () => {
    const folder = cache({ infoJson: { fileName: `..\\${INSTALLER}`, sha512: SHA } });
    fs.writeFileSync(path.join(folder, INSTALLER), "MZ installer bytes");
    expect(cachedInstaller(folder, info())).toBe(false);
  });
});

class Token {
  cancelled = false;
  cancel(): void {
    this.cancelled = true;
  }
}

/** electron-updater's autoUpdater as far as electronUpdater uses it; each call recorded. */
class StandIn implements AutoUpdaterLike<Token> {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  allowDowngrade = true;
  logger: AutoUpdaterLike<Token>["logger"] = null;
  calls: string[] = [];
  checkAnswer: () => Promise<{ isUpdateAvailable: boolean; updateInfo: { version: string; files: { sha512: string }[] } } | null> = () =>
    Promise.resolve(null);
  downloadAnswer: (t: Token) => Promise<string[]> = () => Promise.resolve([]);
  installError: Error | null = null;
  private errorListeners: ((e: Error) => void)[] = [];
  checkForUpdates() {
    this.calls.push("checkForUpdates");
    return this.checkAnswer();
  }
  downloadUpdate(t: Token) {
    this.calls.push("downloadUpdate");
    return this.downloadAnswer(t);
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) {
    this.calls.push(`quitAndInstall ${isSilent} ${isForceRunAfter}`);
    if (this.installError) for (const fn of [...this.errorListeners]) fn(this.installError);
  }
  on(_event: "error", fn: (e: Error) => void) {
    this.errorListeners.push(fn);
    return this;
  }
  off(_event: "error", fn: (e: Error) => void) {
    this.errorListeners = this.errorListeners.filter((f) => f !== fn);
    return this;
  }
}

function real(o: { cacheFolder?: string } = {}) {
  const u = new StandIn();
  const lines: string[] = [];
  const port = electronUpdater({ autoUpdater: u, CancellationToken: Token, cacheFolder: o.cacheFolder ?? cache(), log: (l) => lines.push(l) });
  return { u, port, lines };
}

describe("electron-updater, set up by the shell", () => {
  // @spec DESK-SHELL-UPD-001, DESK-SHELL-UPD-002, DESK-SHELL-UPD-010
  it("downloads and installs nothing by itself, takes no prerelease and never goes back to an older version", () => {
    const { u } = real();
    expect(u.autoDownload).toBe(false);
    expect(u.autoInstallOnAppQuit).toBe(false);
    expect(u.allowPrerelease).toBe(false);
    expect(u.allowDowngrade).toBe(false);
    expect(u.calls).toEqual([]);
  });

  // @spec DESK-SHELL-UPD-001
  it("logs electron-updater's own lines as [update] lines", () => {
    const { u, lines } = real();
    u.logger?.info("Checking for update");
    u.logger?.error(new Error("net::ERR_INTERNET_DISCONNECTED"));
    expect(lines).toEqual(["[update] Checking for update", "[update] net::ERR_INTERNET_DISCONNECTED"]);
  });

  // @spec DESK-SHELL-UPD-002, DESK-SHELL-UPD-004
  it("answers a check: none when nothing newer is offered, found with the version and whether it is cached, failed with the reason", async () => {
    const { u, port } = real({ cacheFolder: cache({ infoJson: { fileName: INSTALLER, sha512: SHA }, installer: true }) });
    expect(await port.check()).toEqual({ kind: "none" });
    u.checkAnswer = () => Promise.resolve({ isUpdateAvailable: false, updateInfo: info() });
    expect(await port.check()).toEqual({ kind: "none" });
    u.checkAnswer = () => Promise.resolve({ isUpdateAvailable: true, updateInfo: info() });
    expect(await port.check()).toEqual({ kind: "found", version: "0.9.0", downloaded: true });
    u.checkAnswer = () => Promise.resolve({ isUpdateAvailable: true, updateInfo: info("b3RoZXI=") });
    expect(await port.check()).toEqual({ kind: "found", version: "0.9.0", downloaded: false });
    u.checkAnswer = () => Promise.reject(new Error("HttpError: 404"));
    expect(await port.check()).toEqual({ kind: "failed", reason: "HttpError: 404" });
  });

  // @spec DESK-SHELL-QUIT-002
  it("settles a cancelled check as failed at once, ignoring its late answer", async () => {
    const { u, port } = real();
    let answer!: (r: null) => void;
    u.checkAnswer = () => new Promise((r) => (answer = r));
    const check = port.check();
    port.cancelCheck();
    expect(await check).toEqual({ kind: "failed", reason: "cancelled" });
    answer(null);
  });

  // @spec DESK-SHELL-UPD-024, DESK-SHELL-QUIT-002
  it("downloads with a cancellation token, a cancelled download settling as cancelled", async () => {
    const { u, port } = real();
    expect(await port.download("0.9.0").done).toEqual({ ok: true });
    u.downloadAnswer = () => Promise.reject(new Error("sha512 checksum mismatch"));
    expect(await port.download("0.9.0").done).toEqual({ ok: false, reason: "sha512 checksum mismatch" });
    let token!: Token;
    u.downloadAnswer = (t) => {
      token = t;
      return Promise.reject(new Error("cancelled by the token"));
    };
    const d = port.download("0.9.0");
    d.cancel();
    expect(token.cancelled).toBe(true);
    expect(await d.done).toEqual({ ok: false, reason: "cancelled" });
  });

  // @spec DESK-SHELL-UPD-010, DESK-SHELL-UPD-019
  it("installs by quitAndInstall, silent and without a run after, not ok when it reports an error", () => {
    const { u, port } = real();
    expect(port.install()).toEqual({ ok: true });
    u.installError = new Error("spawn EACCES");
    expect(port.install()).toEqual({ ok: false, reason: "spawn EACCES" });
    expect(u.calls).toEqual(["quitAndInstall true false", "quitAndInstall true false"]);
  });

  // @spec DESK-SHELL-UPD-008, DESK-SHELL-UPD-019
  it("discards the downloaded installer, and never rejects when there is none", async () => {
    const folder = cache({ infoJson: { fileName: INSTALLER, sha512: SHA }, installer: true });
    const { port } = real({ cacheFolder: folder });
    await port.discard();
    expect(fs.existsSync(path.join(folder, "pending"))).toBe(false);
    await expect(port.discard()).resolves.toBeUndefined();
  });
});
