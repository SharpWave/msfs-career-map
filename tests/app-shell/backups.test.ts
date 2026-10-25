/**
 * Taking a backup, in process on logbook files made for each test (APP-BAK-003, 004, 006, 007, 008,
 * 009): the online copy with its icons, the name and its kinds, the backups folder (Documents
 * looked up through a stand-in — no test ever reaches the real Documents folder), pruning by
 * logbook id, the two reasons of a failure, and the fallback into the data folder.
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { documentsFolder } from "../../src/server/documents.ts";
import {
  BackupFailed,
  backupFailure,
  backupFileName,
  backupWithFallback,
  backupsFolder,
  parseBackupName,
  pruneBackups,
  takeBackup,
} from "../../src/server/backup.ts";
import { iconBytes, logbookFolder, queryLogbook, someId, writeLogbook } from "../support/logbooks.ts";

vi.mock("../../src/server/documents.ts", () => ({ documentsFolder: vi.fn() }));

const ID = someId(0xabc);
const OTHER_ID = someId(0xdef);
const NAME = /^career-\d{8}T\d{6}Z-[a-z0-9.\-]+-[0-9a-f]{16}\.db$/;

let open: DatabaseSync[] = [];
afterEach(() => {
  for (const db of open) db.close();
  open = [];
  vi.useRealTimers();
});

/** A logbook in a data folder of its own, opened as the server holds it. */
async function logbook(spec: Parameters<typeof writeLogbook>[1] = {}) {
  const folder = logbookFolder();
  const file = await writeLogbook(path.join(folder, "career.db"), { logbookId: ID, ...spec });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL");
  open.push(db);
  return { folder, file, db, imagesDir: path.join(folder, "images"), backups: path.join(folder, "backups") };
}

const filesIn = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);

describe("backup names (APP-BAK-004)", () => {
  // @spec APP-BAK-004
  it("names a backup career-<UTC start time>-<kind>-<logbook id>.db", () => {
    const at = new Date("2026-10-25T04:37:50.123Z");
    expect(backupFileName(at, "daily", ID)).toBe(`career-20261025T043750Z-daily-${ID}.db`);
    expect(backupFileName(at, "manual", ID)).toBe(`career-20261025T043750Z-manual-${ID}.db`);
    expect(backupFileName(at, "quit", ID)).toBe(`career-20261025T043750Z-quit-${ID}.db`);
    expect(backupFileName(at, "update-1.2.0", ID)).toBe(`career-20261025T043750Z-update-1.2.0-${ID}.db`);
    expect(backupFileName(at, "upgrade-0.9.0-beta.1", ID)).toBe(`career-20261025T043750Z-upgrade-0.9.0-beta.1-${ID}.db`);
  });

  // @spec APP-BAK-004
  it("reads a backup's name back into its time, kind and logbook id, and nothing from other names", () => {
    expect(parseBackupName(`career-20261025T043750Z-update-1.2.0-${ID}.db`)).toEqual({
      time: new Date("2026-10-25T04:37:50Z"),
      kind: "update-1.2.0",
      logbookId: ID,
    });
    for (const name of ["career.db", `career-20261025T043750Z-daily-${ID}.db.partial`, "career-2026-daily-x.db", "notes.txt", `career-20261025T043750Z-daily-${ID.toUpperCase()}.db`]) {
      expect(parseBackupName(name), name).toBeNull();
    }
  });
});

describe("taking a backup (APP-BAK-003, APP-BAK-004)", () => {
  // @spec APP-BAK-003, APP-BAK-004
  it("copies the open logbook, what still waits in its write-ahead log included, into the backups folder under its name", async () => {
    const lb = await logbook({ aircraft: ["Cub"] });
    // Written after the last checkpoint: only in the write-ahead log so far.
    lb.db.prepare(`INSERT INTO hops (aircraft_id, seq, origin, dest, notes) VALUES (1, 1, 'KPVD', 'KBOS', '')`).run();
    const before = Date.now();
    const file = await takeBackup(lb.db, { folder: lb.backups, kind: "manual", logbookId: ID, imagesDir: lb.imagesDir });

    expect(path.dirname(file)).toBe(lb.backups);
    expect(path.basename(file)).toMatch(NAME);
    const parsed = parseBackupName(path.basename(file))!;
    expect(parsed.kind).toBe("manual");
    expect(parsed.logbookId).toBe(ID);
    expect(parsed.time.getTime()).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(queryLogbook(file, `SELECT origin, dest FROM hops`)).toEqual([{ origin: "KPVD", dest: "KBOS" }]);
    expect(filesIn(lb.backups)).toEqual([path.basename(file)]);
  });

  // @spec APP-BAK-003
  it("adds a backup_icons table holding each uploaded icon an aircraft row names", async () => {
    const lb = await logbook({ aircraft: ["Cub", "Baron", "Comanche"], icons: { 0: iconBytes(1), 2: iconBytes(3) } });
    // An aircraft with a built-in icon names no file; one naming a file that is gone holds nothing.
    lb.db.prepare(`INSERT INTO aircraft (name, icon) VALUES ('Ghost', '/images/aircraft-99.png?v=2')`).run();
    const file = await takeBackup(lb.db, { folder: lb.backups, kind: "daily", logbookId: ID, imagesDir: lb.imagesDir });
    const rows = queryLogbook<{ file: string; data: Uint8Array }>(file, `SELECT file, data FROM backup_icons ORDER BY file`);
    expect(rows.map((r) => r.file)).toEqual(["aircraft-1.png", "aircraft-3.png"]);
    expect(Buffer.from(rows[0].data)).toEqual(iconBytes(1));
    expect(Buffer.from(rows[1].data)).toEqual(iconBytes(3));
    // The logbook itself is unchanged.
    expect(lb.db.prepare(`SELECT name FROM sqlite_master WHERE name = 'backup_icons'`).get()).toBeUndefined();
  });

  // @spec APP-BAK-003
  it("adds an empty backup_icons table when no aircraft names an uploaded icon", async () => {
    const lb = await logbook({ aircraft: ["Cub"] });
    const file = await takeBackup(lb.db, { folder: lb.backups, kind: "daily", logbookId: ID, imagesDir: lb.imagesDir });
    expect(queryLogbook(file, `SELECT COUNT(*) AS n FROM backup_icons`)).toEqual([{ n: 0 }]);
  });

  // @spec APP-BAK-004
  it("starts no backup whose name is taken until the next second", async () => {
    const lb = await logbook();
    const first = await takeBackup(lb.db, { folder: lb.backups, kind: "manual", logbookId: ID, imagesDir: lb.imagesDir });
    const second = await takeBackup(lb.db, { folder: lb.backups, kind: "manual", logbookId: ID, imagesDir: lb.imagesDir });
    expect(second).not.toBe(first);
    const t1 = parseBackupName(path.basename(first))!.time.getTime();
    const t2 = parseBackupName(path.basename(second))!.time.getTime();
    expect(t2 - t1).toBeGreaterThanOrEqual(1000);
    expect(filesIn(lb.backups)).toHaveLength(2);
  });

  // @spec APP-BAK-003
  it("leaves no file behind when the backup is abandoned", async () => {
    const lb = await logbook({ aircraft: ["Cub"] });
    const insert = lb.db.prepare(`INSERT INTO kv_cache (key, value, fetched_at) VALUES (?, ?, '')`);
    lb.db.exec("BEGIN");
    for (let i = 0; i < 4000; i++) insert.run(`k${i}`, "x".repeat(2000));
    lb.db.exec("COMMIT");
    const ac = new AbortController();
    const p = takeBackup(lb.db, { folder: lb.backups, kind: "quit", logbookId: ID, imagesDir: lb.imagesDir, signal: ac.signal });
    ac.abort();
    await expect(p).rejects.toThrow();
    expect(filesIn(lb.backups)).toEqual([]);
  });

  // @spec APP-BAK-003, APP-BAK-008
  it("fails with no file left when the folder cannot be made", async () => {
    const lb = await logbook();
    const blocker = path.join(lb.folder, "not-a-folder");
    fs.writeFileSync(blocker, "a file where the backups folder would go");
    const folder = path.join(blocker, "backups");
    const err = await takeBackup(lb.db, { folder, kind: "manual", logbookId: ID, imagesDir: lb.imagesDir }).catch((e) => e);
    expect(err).toBeInstanceOf(BackupFailed);
    expect(err.short).toBe("the backup failed");
    expect(err.reason.startsWith(`the backup failed — ${folder}: `)).toBe(true);
    expect(filesIn(lb.folder).filter((f) => f.includes(".partial"))).toEqual([]);
  });
});

describe("the backups folder (APP-BAK-006)", () => {
  beforeEach(() => {
    vi.mocked(documentsFolder).mockReset();
  });

  // @spec APP-BAK-006
  it("uses a literal folder as given, created with its parents when missing", async () => {
    const lb = await logbook();
    const folder = path.join(lb.folder, "deep", "er", "backups");
    expect(await backupsFolder({ kind: "folder", folder })).toBe(folder);
    const file = await takeBackup(lb.db, { folder, kind: "manual", logbookId: ID, imagesDir: lb.imagesDir });
    expect(path.dirname(file)).toBe(folder);
    expect(documentsFolder).not.toHaveBeenCalled();
  });

  // @spec APP-BAK-006
  it("looks Documents up at each backup and uses the path under it, following a Documents folder that moved", async () => {
    const root = logbookFolder();
    const docsA = path.join(root, "Documents");
    const docsB = path.join(root, "OneDrive", "Documents");
    fs.mkdirSync(docsA, { recursive: true });
    fs.mkdirSync(docsB, { recursive: true });
    vi.mocked(documentsFolder).mockResolvedValueOnce(docsA).mockResolvedValueOnce(docsB);
    const input = { kind: "documents" as const, path: path.join("MSFS Career Map", "Backups") };
    expect(await backupsFolder(input)).toBe(path.join(docsA, "MSFS Career Map", "Backups"));
    expect(await backupsFolder(input)).toBe(path.join(docsB, "MSFS Career Map", "Backups"));
    expect(documentsFolder).toHaveBeenCalledTimes(2);
  });

  // @spec APP-BAK-006, APP-BAK-008
  it("fails because the Documents folder does not exist, naming it, and never creates it", async () => {
    const root = logbookFolder();
    const docs = path.join(root, "Documents");
    vi.mocked(documentsFolder).mockResolvedValue(docs);
    const err = await backupsFolder({ kind: "documents", path: path.join("MSFS Career Map", "Backups") }).catch((e) => e);
    expect(err).toBeInstanceOf(BackupFailed);
    expect(err.short).toBe("the Documents folder does not exist");
    expect(err.reason.startsWith(`the Documents folder does not exist — ${docs}: `)).toBe(true);
    expect(fs.existsSync(docs)).toBe(false);
  });

  // @spec APP-BAK-006, APP-BAK-008
  it("fails as a missing Documents folder when Windows cannot say where Documents is", async () => {
    vi.mocked(documentsFolder).mockRejectedValue(new Error("the registry value is missing"));
    const err = await backupsFolder({ kind: "documents", path: "MSFS Career Map\\Backups" }).catch((e) => e);
    expect(err).toBeInstanceOf(BackupFailed);
    expect(err.short).toBe("the Documents folder does not exist");
    expect(err.reason).toContain("the registry value is missing");
  });
});

describe("pruning (APP-BAK-007)", () => {
  /** An empty file named as a backup taken `minutesAgo` before a fixed moment. */
  function backupFile(folder: string, minutesAgo: number, kind: string, id = ID): string {
    const name = backupFileName(new Date(Date.parse("2026-10-25T12:00:00Z") - minutesAgo * 60_000), kind, id);
    fs.writeFileSync(path.join(folder, name), "");
    return name;
  }

  // @spec APP-BAK-007
  it("keeps the seven newest daily backups and the three newest others, the newest upgrade backup kept outside that count", () => {
    const folder = logbookFolder();
    const daily = Array.from({ length: 10 }, (_, i) => backupFile(folder, i * 1440, "daily")); // newest first
    const upgradeNewest = backupFile(folder, 30, "upgrade-0.9.0");
    const others = [
      backupFile(folder, 10, "quit"),
      backupFile(folder, 20, "update-1.2.0"),
      backupFile(folder, 40, "quit"),
      backupFile(folder, 50, "upgrade-0.8.0"),
      backupFile(folder, 60, "update-1.1.0"),
    ];
    const manual = [backupFile(folder, 5000, "manual"), backupFile(folder, 9000, "manual")];
    const theirs = Array.from({ length: 9 }, (_, i) => backupFile(folder, i * 1440 + 7, "daily", OTHER_ID));
    const strangers = ["career.db", "notes.txt", `career-20261025T120000Z-daily-${ID}.db.partial`];
    for (const s of strangers) fs.writeFileSync(path.join(folder, s), "");

    pruneBackups(folder, ID);

    const left = new Set(filesIn(folder));
    for (const n of daily.slice(0, 7)) expect(left.has(n), n).toBe(true);
    for (const n of daily.slice(7)) expect(left.has(n), n).toBe(false);
    expect(left.has(upgradeNewest)).toBe(true);
    for (const n of others.slice(0, 3)) expect(left.has(n), n).toBe(true);
    for (const n of others.slice(3)) expect(left.has(n), n).toBe(false);
    for (const n of [...manual, ...theirs, ...strangers]) expect(left.has(n), n).toBe(true);
  });

  // @spec APP-BAK-007
  it("prunes after each backup into the backups folder, only that logbook's", async () => {
    const lb = await logbook();
    fs.mkdirSync(lb.backups, { recursive: true });
    const old = Array.from({ length: 8 }, (_, i) => backupFile(lb.backups, (i + 1) * 1440, "daily"));
    const theirs = Array.from({ length: 8 }, (_, i) => backupFile(lb.backups, (i + 1) * 1440, "daily", OTHER_ID));
    const file = await takeBackup(lb.db, { folder: lb.backups, kind: "daily", logbookId: ID, imagesDir: lb.imagesDir });
    const left = new Set(filesIn(lb.backups));
    expect(left.has(path.basename(file))).toBe(true);
    // The new one and the six newest of the old.
    expect(old.filter((n) => left.has(n))).toEqual(old.slice(0, 6));
    for (const n of theirs) expect(left.has(n)).toBe(true);
  });
});

describe("why a backup failed (APP-BAK-008)", () => {
  const folder = "C:\\Users\\Pilot\\Documents\\MSFS Career Map\\Backups";
  const sys = (code: string, message: string) => Object.assign(new Error(message), { code });

  // @spec APP-BAK-008
  it.each<[string, Error, string]>([
    ["EPERM", sys("EPERM", "EPERM: operation not permitted, open 'x'"), "Windows refused the write (Controlled folder access?)"],
    ["EACCES", sys("EACCES", "EACCES: permission denied, open 'x'"), "Windows refused the write (Controlled folder access?)"],
    ["ENOSPC", sys("ENOSPC", "ENOSPC: no space left on device, write"), "the disk is full"],
    ["SQLite's full disk", Object.assign(new Error("database or disk is full"), { code: "ERR_SQLITE_ERROR", errcode: 13 }), "the disk is full"],
    ["anything else", sys("EIO", "EIO: i/o error, write"), "the backup failed"],
  ])("gives %s the short reason in fixed words and the full reason naming the folder and the error", (_what, err, short) => {
    const f = backupFailure(err, folder);
    expect(f).toBeInstanceOf(BackupFailed);
    expect(f.short).toBe(short);
    expect(f.short).not.toContain(folder);
    expect(f.reason).toBe(`${short} — ${folder}: ${err.message}`);
  });
});

describe("the fallback into the data folder (APP-BAK-009)", () => {
  /** A logbook whose backups folder cannot be made (a file stands where it would go). */
  async function blockedLogbook() {
    const lb = await logbook({ aircraft: ["Cub"] });
    const blocker = path.join(lb.folder, "blocked");
    fs.writeFileSync(blocker, "");
    return { ...lb, blockedBackups: { kind: "folder" as const, folder: path.join(blocker, "Backups") } };
  }

  // @spec APP-BAK-009
  it("takes a backup before an update into the data folder as career.before-update-V.db, keeping one", async () => {
    const lb = await blockedLogbook();
    fs.writeFileSync(path.join(lb.folder, "career.before-update-1.1.0.db"), "older");
    fs.writeFileSync(path.join(lb.folder, "career.before-0.9.0.db"), "an upgrade's");
    const file = await backupWithFallback(lb.db, { backups: lb.blockedBackups, dataFolder: lb.folder, kind: "update-1.2.0", logbookId: ID, imagesDir: lb.imagesDir });
    expect(file).toBe(path.join(lb.folder, "career.before-update-1.2.0.db"));
    expect(queryLogbook(file, `SELECT name FROM aircraft`)).toEqual([{ name: "Cub" }]);
    expect(queryLogbook(file, `SELECT COUNT(*) AS n FROM backup_icons`)).toEqual([{ n: 0 }]);
    const left = filesIn(lb.folder);
    expect(left).not.toContain("career.before-update-1.1.0.db");
    expect(left).toContain("career.before-0.9.0.db");
    expect(left.filter((f) => f.endsWith(".partial"))).toEqual([]);
  });

  // @spec APP-BAK-009
  it("takes a backup before an upgrade into the data folder as career.before-V.db, keeping one and leaving update ones alone", async () => {
    const lb = await blockedLogbook();
    fs.writeFileSync(path.join(lb.folder, "career.before-0.8.0.db"), "older");
    fs.writeFileSync(path.join(lb.folder, "career.before-update-1.1.0.db"), "an update's");
    fs.writeFileSync(path.join(lb.folder, "career.before-import-20261001T000000Z.db"), "an import's");
    const file = await backupWithFallback(lb.db, { backups: lb.blockedBackups, dataFolder: lb.folder, kind: "upgrade-0.9.0", logbookId: ID, imagesDir: lb.imagesDir });
    expect(file).toBe(path.join(lb.folder, "career.before-0.9.0.db"));
    const left = filesIn(lb.folder);
    expect(left).not.toContain("career.before-0.8.0.db");
    expect(left).toContain("career.before-update-1.1.0.db");
    expect(left).toContain("career.before-import-20261001T000000Z.db");
  });

  // @spec APP-BAK-009
  it("uses the backups folder when it can be written, and touches no fallback file", async () => {
    const lb = await logbook();
    fs.writeFileSync(path.join(lb.folder, "career.before-update-1.1.0.db"), "older");
    const file = await backupWithFallback(lb.db, { backups: { kind: "folder", folder: lb.backups }, dataFolder: lb.folder, kind: "update-1.2.0", logbookId: ID, imagesDir: lb.imagesDir });
    expect(path.dirname(file)).toBe(lb.backups);
    expect(path.basename(file)).toMatch(new RegExp(`-update-1\\.2\\.0-${ID}\\.db$`));
    expect(filesIn(lb.folder)).toContain("career.before-update-1.1.0.db");
  });

  // @spec APP-BAK-009, APP-BAK-008
  it("fails with the reason when the data folder cannot be written either", async () => {
    const lb = await blockedLogbook();
    const gone = path.join(lb.folder, "blocked", "data");
    const err = await backupWithFallback(lb.db, { backups: lb.blockedBackups, dataFolder: gone, kind: "upgrade-0.9.0", logbookId: ID, imagesDir: lb.imagesDir }).catch((e) => e);
    expect(err).toBeInstanceOf(BackupFailed);
    expect(err.reason).toContain(gone);
  });
});
