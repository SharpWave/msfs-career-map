import fs from "node:fs";
import path from "node:path";
import type { CheckResult, UpdaterOutcome, UpdaterPort } from "./ports.ts";

/**
 * The real `UpdaterPort` on electron-updater. main.ts passes in its `autoUpdater` and `CancellationToken`,
 * so this module loads without Electron. The provider (GitHub Releases, SharpWave/msfs-career-map) comes
 * from the packaged `app-update.yml`; nothing here names it.
 */

interface ReleaseInfo {
  version: string;
  files: { sha512: string }[];
}

interface Token {
  cancel(): void;
}

/** The part of electron-updater's AppUpdater this module uses. */
export interface AutoUpdaterLike<T extends Token> {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  logger: { info(m: unknown): void; warn(m: unknown): void; error(m: unknown): void; debug?(m: unknown): void } | null;
  checkForUpdates(): Promise<{ isUpdateAvailable: boolean; updateInfo: ReleaseInfo } | null>;
  downloadUpdate(token: T): Promise<string[]>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: "error", fn: (e: Error) => void): unknown;
  off(event: "error", fn: (e: Error) => void): unknown;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Whether the release's installer is already in electron-updater's cache: `pending\update-info.json`
 * names a file inside `pending\` that exists, with the sha512 the release gives. Never throws.
 */
// @spec DESK-SHELL-UPD-009, DESK-SHELL-UPD-026
export function cachedInstaller(cacheFolder: string, info: ReleaseInfo): boolean {
  try {
    const want = info.files[0]?.sha512;
    if (typeof want !== "string") return false;
    const pending = path.join(cacheFolder, "pending");
    const cached: unknown = JSON.parse(fs.readFileSync(path.join(pending, "update-info.json"), "utf8"));
    if (typeof cached !== "object" || cached === null) return false;
    const { fileName, sha512 } = cached as { fileName?: unknown; sha512?: unknown };
    if (typeof fileName !== "string" || fileName === "" || path.win32.basename(fileName) !== fileName) return false;
    if (path.posix.basename(fileName) !== fileName) return false;
    return sha512 === want && fs.statSync(path.join(pending, fileName)).isFile();
  } catch {
    return false;
  }
}

/** A port made at its first call. */
export function lazyUpdater(make: () => UpdaterPort): UpdaterPort {
  let port: UpdaterPort | null = null;
  const get = () => (port ??= make());
  return {
    check: () => get().check(),
    download: (version) => get().download(version),
    cancelCheck: () => get().cancelCheck(),
    install: () => get().install(),
    discard: () => get().discard(),
  };
}

/** electron-updater set once for the shell's own flows: nothing downloaded or installed by itself, no prerelease, no downgrade. */
// @spec DESK-SHELL-UPD-001, DESK-SHELL-UPD-002, DESK-SHELL-UPD-010
export function electronUpdater<T extends Token>(o: {
  autoUpdater: AutoUpdaterLike<T>;
  CancellationToken: new () => T;
  /** electron-updater's download folder, downloadsFolder(LOCALAPPDATA). */
  cacheFolder: string;
  log(line: string): void;
}): UpdaterPort {
  const u = o.autoUpdater;
  u.autoDownload = false;
  u.autoInstallOnAppQuit = false;
  u.allowPrerelease = false;
  u.allowDowngrade = false;
  const line = (m: unknown) => o.log(`[update] ${message(m)}`);
  u.logger = { info: line, warn: line, error: line };
  // An error emitted outside a call (electron-updater emits as well as rejects) is only logged.
  u.on("error", () => {});

  let cancelCheck: (() => void) | null = null;
  return {
    check() {
      return new Promise<CheckResult>((resolve) => {
        let settled = false;
        const settle = (r: CheckResult) => {
          if (settled) return;
          settled = true;
          cancelCheck = null;
          resolve(r);
        };
        cancelCheck = () => settle({ kind: "failed", reason: "cancelled" });
        u.checkForUpdates().then(
          (r) => {
            if (r === null || !r.isUpdateAvailable) return settle({ kind: "none" });
            settle({ kind: "found", version: r.updateInfo.version, downloaded: cachedInstaller(o.cacheFolder, r.updateInfo) });
          },
          (e: unknown) => settle({ kind: "failed", reason: message(e) }),
        );
      });
    },
    cancelCheck() {
      cancelCheck?.();
    },
    download() {
      const token = new o.CancellationToken();
      let cancelled = false;
      const done = u.downloadUpdate(token).then(
        (): UpdaterOutcome => (cancelled ? { ok: false, reason: "cancelled" } : { ok: true }),
        (e: unknown): UpdaterOutcome => ({ ok: false, reason: cancelled ? "cancelled" : message(e) }),
      );
      return {
        done,
        cancel() {
          cancelled = true;
          token.cancel();
        },
      };
    },
    install() {
      let failure: string | null = null;
      const onError = (e: Error) => (failure ??= message(e));
      u.on("error", onError);
      try {
        u.quitAndInstall(true, false);
      } catch (e) {
        failure ??= message(e);
      } finally {
        u.off("error", onError);
      }
      return failure === null ? { ok: true } : { ok: false, reason: failure };
    },
    async discard() {
      try {
        await fs.promises.rm(path.join(o.cacheFolder, "pending"), { recursive: true, force: true });
      } catch {
        // Nothing more to do: the next download replaces it.
      }
    },
  };
}
