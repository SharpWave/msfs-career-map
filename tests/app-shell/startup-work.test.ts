/**
 * The start-up work on the logbook, run in process on data folders made for each test
 * (runStartupWork, the worker's own body): finishing a logbook brought in (APP-IMP-004, 005), a
 * restored backup's icons and new id (APP-BAK-011, APP-DATA-006), the backup before an upgrade and
 * the upgrade (APP-BAK-010, APP-DATA-004), and the steps reported (APP-SRV-001).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { parseBackupName } from "../../src/server/backup.ts";
import { StartupFailed, runStartupWork } from "../../src/server/startup-work.ts";
import type { StartupStep } from "../../src/server/status.ts";
import { OLD_COLUMN, iconBytes, logbookFolder, logbookIdOf, queryLogbook, schemaOf, someId, tableNames, writeLogbook } from "../support/logbooks.ts";

const VERSION = "0.9.0";
const NOW = new Date("2026-10-25T05:06:07.890Z");
const STAMP = "20261025T050607Z";
const ID = /^[0-9a-f]{16}$/;

/** Run the start-up work on `folder`, collecting the steps it reports. */
async function run(folder: string, o: { backups?: string; now?: () => Date } = {}) {
  const steps: StartupStep[] = [];
  const result = await runStartupWork(
    {
      dataFolder: folder,
      dbPath: path.join(folder, "career.db"),
      backups: { kind: "folder", folder: o.backups ?? path.join(folder, "backups") },
      version: VERSION,
      now: o.now ?? (() => NOW),
    },
    (step) => steps.push(step),
  );
  return { ...result, steps };
}

const filesIn = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []);
const db = (folder: string) => path.join(folder, "career.db");

describe("opening and the logbook's id (APP-DATA-006, APP-DATA-004)", () => {
  // @spec APP-DATA-006, APP-DATA-004, APP-SRV-001
  it("creates a new database, gives it an id once the schema step has created it, and takes no backup", async () => {
    const folder = logbookFolder();
    const r = await run(folder);
    expect(r.steps).toEqual(["opening"]);
    expect(r.logbookId).toMatch(ID);
    expect(logbookIdOf(db(folder))).toBe(r.logbookId);
    expect(tableNames(db(folder))).toEqual(expect.arrayContaining(["aircraft", "hops", "settings", "tracker_state"]));
    expect(filesIn(path.join(folder, "backups"))).toEqual([]);
    expect(r.outcome).toBeNull();
  });

  // @spec APP-DATA-006, APP-DATA-004
  it("keeps a current logbook's id and takes no backup", async () => {
    const folder = logbookFolder();
    await writeLogbook(db(folder), { logbookId: someId(7) });
    const r = await run(folder);
    expect(r.steps).toEqual(["opening"]);
    expect(r.logbookId).toBe(someId(7));
    expect(filesIn(path.join(folder, "backups"))).toEqual([]);
  });

  // @spec APP-DATA-006
  it("gives a current logbook from an earlier version that has no id a new one, with no backup", async () => {
    const folder = logbookFolder();
    await writeLogbook(db(folder), { logbookId: null });
    const r = await run(folder);
    expect(r.logbookId).toMatch(ID);
    expect(logbookIdOf(db(folder))).toBe(r.logbookId);
    expect(filesIn(path.join(folder, "backups"))).toEqual([]);
  });
});

describe("the backup before an upgrade (APP-BAK-010)", () => {
  // @spec APP-BAK-010, APP-DATA-006, APP-SRV-001
  it.each<["old" | "pre-settings"]>([["old"], ["pre-settings"]])(
    "backs a %s logbook up as upgrade-<version>, named with the id it keeps, then upgrades it",
    async (schema) => {
      const folder = logbookFolder();
      await writeLogbook(db(folder), { schema, aircraft: ["Cub"], hops: [[0, "KPVD", "KBOS", "2026-01-01T10:00:00.000Z"]] });
      const r = await run(folder);
      expect(r.steps).toEqual(["opening", "backing-up", "upgrading"]);
      expect(r.logbookId).toMatch(ID);
      expect(logbookIdOf(db(folder))).toBe(r.logbookId);

      const files = filesIn(path.join(folder, "backups"));
      expect(files).toHaveLength(1);
      // Named by the time it started on the PC's clock, its kind and the id the logbook keeps.
      expect(parseBackupName(files[0])).toMatchObject({ kind: `upgrade-${VERSION}`, logbookId: r.logbookId });
      const backup = path.join(folder, "backups", files[0]);
      // The backup holds the logbook as it was before the upgrade, with its id.
      expect(schemaOf(backup)[OLD_COLUMN.table]).not.toContain(OLD_COLUMN.column);
      expect(logbookIdOf(backup)).toBe(r.logbookId);
      expect(queryLogbook(backup, `SELECT origin FROM hops`)).toEqual([{ origin: "KPVD" }]);
      expect(queryLogbook(backup, `SELECT COUNT(*) AS n FROM backup_icons`)).toEqual([{ n: 0 }]);
      // The logbook in use is upgraded, its rows kept.
      expect(schemaOf(db(folder))[OLD_COLUMN.table]).toContain(OLD_COLUMN.column);
      expect(queryLogbook(db(folder), `SELECT origin FROM hops`)).toEqual([{ origin: "KPVD" }]);
    },
  );

  // @spec APP-BAK-010, APP-BAK-009
  it("takes it into the data folder as career.before-<version>.db when the backups folder cannot be written", async () => {
    const folder = logbookFolder();
    await writeLogbook(db(folder), { schema: "old", logbookId: someId(9) });
    fs.writeFileSync(path.join(folder, "blocked"), "");
    const r = await run(folder, { backups: path.join(folder, "blocked", "Backups") });
    expect(r.steps).toEqual(["opening", "backing-up", "upgrading"]);
    expect(filesIn(folder)).toContain(`career.before-${VERSION}.db`);
    expect(logbookIdOf(path.join(folder, `career.before-${VERSION}.db`))).toBe(someId(9));
    expect(schemaOf(db(folder))[OLD_COLUMN.table]).toContain(OLD_COLUMN.column);
  });

  // @spec APP-BAK-010, APP-SRV-014
  it("leaves the logbook unchanged and fails with the full reason when the backup fails both ways", async () => {
    const folder = logbookFolder();
    await writeLogbook(db(folder), { schema: "old", logbookId: someId(10), aircraft: ["Cub"] });
    const before = schemaOf(db(folder));
    fs.writeFileSync(path.join(folder, "blocked"), "");
    // The data folder's fallback cannot be written either: a folder stands where its file is made.
    fs.mkdirSync(path.join(folder, `career.before-${VERSION}.db.partial`));
    const err = await run(folder, { backups: path.join(folder, "blocked", "Backups") }).catch((e) => e);
    expect(err).toBeInstanceOf(StartupFailed);
    expect(err.line).toMatch(/^Could not back up the logbook before upgrading it: the backup failed — .+: .+/);
    expect(schemaOf(db(folder))).toEqual(before);
    expect(queryLogbook(db(folder), `SELECT name FROM aircraft`)).toEqual([{ name: "Cub" }]);
  });
});

describe("a restored backup (APP-BAK-011)", () => {
  // @spec APP-BAK-011, APP-DATA-006
  it("moves the images folder aside, writes the backup's icons, then gives a new id and drops the table", async () => {
    const folder = logbookFolder();
    await writeLogbook(db(folder), {
      logbookId: someId(11),
      aircraft: ["Cub"],
      backupIcons: { "aircraft-1.png": iconBytes(1), "aircraft-2.webp": iconBytes(2) },
    });
    // The replaced logbook's icons, one sharing an aircraft id with the restored rows.
    fs.mkdirSync(path.join(folder, "images"), { recursive: true });
    fs.writeFileSync(path.join(folder, "images", "aircraft-1.png"), "the replaced logbook's icon");
    fs.writeFileSync(path.join(folder, "images", "aircraft-5.png"), "another of its icons");

    const r = await run(folder);
    expect(r.steps).toEqual(["opening"]);
    expect(r.logbookId).toMatch(ID);
    expect(r.logbookId).not.toBe(someId(11));
    expect(logbookIdOf(db(folder))).toBe(r.logbookId);
    expect(tableNames(db(folder))).not.toContain("backup_icons");

    expect(filesIn(path.join(folder, "images"))).toEqual(["aircraft-1.png", "aircraft-2.webp"]);
    expect(fs.readFileSync(path.join(folder, "images", "aircraft-1.png"))).toEqual(iconBytes(1));
    const aside = path.join(folder, `images.before-restore-${STAMP}`);
    expect(filesIn(aside)).toEqual(["aircraft-1.png", "aircraft-5.png"]);
    expect(fs.readFileSync(path.join(aside, "aircraft-1.png"), "utf8")).toBe("the replaced logbook's icon");
  });

  // @spec APP-BAK-011
  it("does the same for an empty table with no images folder: a new id, an empty images folder, nothing moved aside", async () => {
    const folder = logbookFolder();
    await writeLogbook(db(folder), { logbookId: someId(12), backupIcons: {} });
    const r = await run(folder);
    expect(r.logbookId).not.toBe(someId(12));
    expect(tableNames(db(folder))).not.toContain("backup_icons");
    expect(filesIn(path.join(folder, "images"))).toEqual([]);
    expect(filesIn(folder).filter((f) => f.startsWith("images.before-restore-"))).toEqual([]);
  });

  // @spec APP-BAK-011
  it("does it all again at a start after one cut short before the table was dropped", async () => {
    const folder = logbookFolder();
    await writeLogbook(db(folder), { logbookId: someId(13), backupIcons: { "aircraft-1.png": iconBytes(1) } });
    // As a start cut short leaves it: the icons written, the earlier images moved aside, the table still there.
    fs.mkdirSync(path.join(folder, "images.before-restore-20261024T000000Z"));
    fs.mkdirSync(path.join(folder, "images"));
    fs.writeFileSync(path.join(folder, "images", "aircraft-1.png"), iconBytes(1));
    const r = await run(folder);
    expect(tableNames(db(folder))).not.toContain("backup_icons");
    expect(r.logbookId).not.toBe(someId(13));
    expect(fs.readFileSync(path.join(folder, "images", "aircraft-1.png"))).toEqual(iconBytes(1));
    expect(filesIn(folder).filter((f) => f.startsWith("images.before-restore-"))).toEqual([
      "images.before-restore-20261024T000000Z",
      `images.before-restore-${STAMP}`,
    ]);
  });

  // @spec APP-BAK-011, APP-BAK-010
  it("names the backup before upgrading a restored older backup with its new id, carrying its icons", async () => {
    const folder = logbookFolder();
    await writeLogbook(db(folder), { schema: "old", logbookId: someId(14), aircraft: ["Cub"], backupIcons: { "aircraft-1.png": iconBytes(1) } });
    const raw = new DatabaseSync(db(folder));
    raw.prepare(`UPDATE aircraft SET icon = '/images/aircraft-1.png?v=1' WHERE id = 1`).run();
    raw.close();
    const r = await run(folder);
    expect(r.steps).toEqual(["opening", "backing-up", "upgrading"]);
    const [file] = filesIn(path.join(folder, "backups"));
    expect(parseBackupName(file)?.logbookId).toBe(r.logbookId);
    expect(r.logbookId).not.toBe(someId(14));
    const icons = queryLogbook<{ file: string }>(path.join(folder, "backups", file), `SELECT file FROM backup_icons`);
    expect(icons.map((i) => i.file)).toEqual(["aircraft-1.png"]);
  });
});

describe("finishing a logbook brought in (APP-IMP-004, APP-IMP-005)", () => {
  const incoming = (folder: string) => path.join(folder, "career.db.incoming");
  const marker = (folder: string) => path.join(folder, "career.db.incoming.json");
  const markComplete = (folder: string) => fs.writeFileSync(marker(folder), JSON.stringify({ complete: true, from: "C:\\elsewhere", at: NOW.toISOString() }));

  /** A copy ready beside the database, as an accepted import leaves it. */
  async function copyReady(folder: string, complete = true) {
    await writeLogbook(incoming(folder), {
      logbookId: someId(0x77),
      aircraft: ["Brought Cub"],
      icons: undefined,
      hops: [[0, "KORH", "KBED", "2026-09-01T12:00:00.000Z"]],
      backupIcons: { "aircraft-1.png": iconBytes(77) },
    });
    if (complete) markComplete(folder);
  }

  // @spec APP-IMP-004, APP-IMP-005, APP-SRV-001
  it("swaps a complete copy into place when the logbook in use holds no hops, the old one kept aside", async () => {
    const folder = logbookFolder();
    await writeLogbook(db(folder), { logbookId: someId(1), aircraft: ["Here Cub"] });
    await copyReady(folder);
    const r = await run(folder);

    expect(r.steps).toEqual(["bringing-in", "opening"]);
    expect(r.outcome).toMatchObject({ outcome: "brought-in" });
    expect(queryLogbook(db(folder), `SELECT name FROM aircraft`)).toEqual([{ name: "Brought Cub" }]);
    expect(queryLogbook(db(folder), `SELECT origin, dest FROM hops`)).toEqual([{ origin: "KORH", dest: "KBED" }]);
    const aside = path.join(folder, `career.before-import-${STAMP}.db`);
    expect(queryLogbook(aside, `SELECT name FROM aircraft`)).toEqual([{ name: "Here Cub" }]);
    expect(filesIn(folder)).not.toContain("career.db.incoming");
    expect(filesIn(folder)).not.toContain("career.db.incoming.json");
    // Then opened as a restored backup: its icons in place and a new id.
    expect(tableNames(db(folder))).not.toContain("backup_icons");
    expect(fs.readFileSync(path.join(folder, "images", "aircraft-1.png"))).toEqual(iconBytes(77));
    expect(r.logbookId).not.toBe(someId(0x77));
    expect(r.logbookId).not.toBe(someId(1));
  });

  // @spec APP-IMP-004
  it("checkpoints the logbook in use first, and moves a write-ahead log left beside it aside with it", async () => {
    const folder = logbookFolder();
    await writeLogbook(db(folder), { logbookId: someId(2) });
    // A logbook left with committed writes still in its write-ahead log, as a crash leaves it.
    const live = new DatabaseSync(db(folder));
    live.exec("PRAGMA wal_autocheckpoint = 0");
    live.prepare(`INSERT INTO aircraft (name) VALUES ('Only in the log')`).run();
    const snapshot = logbookFolder();
    for (const f of ["career.db", "career.db-wal", "career.db-shm"]) {
      if (fs.existsSync(path.join(folder, f))) fs.copyFileSync(path.join(folder, f), path.join(snapshot, f));
    }
    live.close();
    expect(fs.existsSync(path.join(snapshot, "career.db-wal"))).toBe(true);
    await copyReady(snapshot);

    const r = await run(snapshot);
    expect(r.outcome).toMatchObject({ outcome: "brought-in" });
    const aside = path.join(snapshot, `career.before-import-${STAMP}.db`);
    // What waited in the log is in the logbook set aside, and no log is left beside the new one that is not its own.
    expect(queryLogbook(aside, `SELECT name FROM aircraft`)).toEqual([{ name: "Only in the log" }]);
    expect(queryLogbook(db(snapshot), `SELECT name FROM aircraft`)).toEqual([{ name: "Brought Cub" }]);
    for (const f of filesIn(snapshot).filter((n) => n.startsWith("career.before-import-"))) {
      expect(f).toMatch(new RegExp(`^career\\.before-import-${STAMP}\\.db(-wal|-shm)?$`));
    }
  });

  // @spec APP-IMP-004, APP-IMP-005
  it("discards the copy when the logbook in use holds hops by then, a hop still in its write-ahead log included", async () => {
    const folder = logbookFolder();
    await writeLogbook(db(folder), { logbookId: someId(3), aircraft: ["Here Cub"] });
    const live = new DatabaseSync(db(folder));
    live.exec("PRAGMA wal_autocheckpoint = 0");
    live.prepare(`INSERT INTO hops (aircraft_id, seq, origin, dest, notes) VALUES (1, 1, 'KPVD', 'KBOS', '')`).run();
    const snapshot = logbookFolder();
    for (const f of ["career.db", "career.db-wal", "career.db-shm"]) {
      if (fs.existsSync(path.join(folder, f))) fs.copyFileSync(path.join(folder, f), path.join(snapshot, f));
    }
    live.close();
    await copyReady(snapshot);

    const r = await run(snapshot);
    expect(r.outcome).toMatchObject({ outcome: "not-brought-in" });
    expect(r.logbookId).toBe(someId(3));
    expect(queryLogbook(db(snapshot), `SELECT origin FROM hops`)).toEqual([{ origin: "KPVD" }]);
    expect(filesIn(snapshot).filter((f) => f.startsWith("career.db.incoming") || f.startsWith("career.before-import-"))).toEqual([]);
  });

  // @spec APP-IMP-004
  it("renames a complete copy into place when the database was already moved aside (a swap cut short)", async () => {
    const folder = logbookFolder();
    await copyReady(folder);
    fs.writeFileSync(path.join(folder, `career.before-import-20261024T000000Z.db`), "the logbook moved aside");
    const r = await run(folder);
    expect(r.outcome).toMatchObject({ outcome: "brought-in" });
    expect(queryLogbook(db(folder), `SELECT name FROM aircraft`)).toEqual([{ name: "Brought Cub" }]);
    expect(fs.readFileSync(path.join(folder, `career.before-import-20261024T000000Z.db`), "utf8")).toBe("the logbook moved aside");
  });

  // @spec APP-IMP-004
  it.each<[string, (folder: string) => void]>([
    ["with no mark", () => {}],
    ["marked as not complete", (folder) => fs.writeFileSync(marker(folder), JSON.stringify({ complete: false }))],
    ["with a mark that is not JSON", (folder) => fs.writeFileSync(marker(folder), "{half")],
  ])("deletes a copy %s and opens the logbook in use as it is", async (_what, mark) => {
    const folder = logbookFolder();
    await writeLogbook(db(folder), { logbookId: someId(4), aircraft: ["Here Cub"] });
    await copyReady(folder, false);
    mark(folder);
    const r = await run(folder);
    expect(r.outcome).toBeNull();
    expect(r.logbookId).toBe(someId(4));
    expect(queryLogbook(db(folder), `SELECT name FROM aircraft`)).toEqual([{ name: "Here Cub" }]);
    expect(filesIn(folder).filter((f) => f.startsWith("career.db.incoming"))).toEqual([]);
  });
});
