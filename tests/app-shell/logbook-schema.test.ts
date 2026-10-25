/**
 * The schema step and the logbook's id, in process on logbook files made for each test: what counts
 * as a schema upgrade (APP-DATA-004), the step as one transaction (APP-DATA-005), only additions
 * (APP-DATA-009), and the logbook id (APP-DATA-006).
 */
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { applySchema, holdsAppTables, upgradeNeeded } from "../../src/server/schema.ts";
import { newLogbookId, readLogbookId, writeNewLogbookId } from "../../src/server/logbook-id.ts";
import { OLD_COLUMN, logbookFolder, schemaOf, writeLogbook } from "../support/logbooks.ts";

const ID = /^[0-9a-f]{16}$/;

/** Open a file for the module under test; closed by the test. */
const open = (file: string) => new DatabaseSync(file);

describe("what counts as a schema upgrade (APP-DATA-004)", () => {
  // @spec APP-DATA-004
  it("counts a new, empty database as no upgrade, and it holds none of the app's tables", () => {
    const db = open(path.join(logbookFolder(), "career.db"));
    try {
      expect(holdsAppTables(db)).toBe(false);
      expect(upgradeNeeded(db)).toBe(false);
    } finally {
      db.close();
    }
  });

  // @spec APP-DATA-004
  it("counts a current logbook as no upgrade", async () => {
    const file = await writeLogbook(path.join(logbookFolder(), "career.db"));
    const db = open(file);
    try {
      expect(holdsAppTables(db)).toBe(true);
      expect(upgradeNeeded(db)).toBe(false);
    } finally {
      db.close();
    }
  });

  // @spec APP-DATA-004
  it.each<["old" | "pre-settings", string]>([
    ["old", "a column the schema step adds"],
    ["pre-settings", "a table and a column the schema step adds"],
  ])("counts a logbook missing %s as an upgrade (%s), deciding without changing it", async (schema) => {
    const file = await writeLogbook(path.join(logbookFolder(), "career.db"), { schema });
    const before = schemaOf(file);
    const db = open(file);
    try {
      expect(upgradeNeeded(db)).toBe(true);
    } finally {
      db.close();
    }
    expect(schemaOf(file)).toEqual(before);
  });

  // @spec APP-DATA-004
  it("counts a logbook missing only a table the schema step creates as an upgrade", async () => {
    const file = await writeLogbook(path.join(logbookFolder(), "career.db"));
    const db = open(file);
    try {
      db.exec("DROP TABLE tracker_state_aside");
      expect(upgradeNeeded(db)).toBe(true);
      applySchema(db);
      expect(upgradeNeeded(db)).toBe(false);
    } finally {
      db.close();
    }
  });

  // @spec APP-DATA-004, APP-DATA-009
  it("counts a logbook with tables and columns of a newer version, and nothing missing, as no upgrade, and the step leaves them as they are", async () => {
    const file = await writeLogbook(path.join(logbookFolder(), "career.db"));
    const db = open(file);
    try {
      db.exec(`CREATE TABLE newer_things (id INTEGER PRIMARY KEY, what TEXT); ALTER TABLE hops ADD COLUMN newer_field TEXT`);
      db.exec(`INSERT INTO newer_things (what) VALUES ('kept')`);
      expect(upgradeNeeded(db)).toBe(false);
      applySchema(db);
      expect((db.prepare(`SELECT what FROM newer_things`).get() as { what: string }).what).toBe("kept");
      expect((db.prepare(`PRAGMA table_info(hops)`).all() as { name: string }[]).map((c) => c.name)).toContain("newer_field");
    } finally {
      db.close();
    }
  });
});

describe("the schema step (APP-DATA-005, APP-DATA-009)", () => {
  // @spec APP-DATA-009
  it("upgrades an older logbook by adding what it lacks, keeping every row", async () => {
    const file = await writeLogbook(path.join(logbookFolder(), "career.db"), {
      schema: "pre-settings",
      aircraft: ["Old Cub"],
      hops: [[0, "KPVD", "KBOS", "2026-01-01T10:00:00.000Z"]],
    });
    const db = open(file);
    try {
      applySchema(db);
      expect(upgradeNeeded(db)).toBe(false);
      const cols = (db.prepare(`PRAGMA table_info(${OLD_COLUMN.table})`).all() as { name: string }[]).map((c) => c.name);
      expect(cols).toContain(OLD_COLUMN.column);
      expect(db.prepare(`SELECT origin, dest FROM hops`).all()).toEqual([{ origin: "KPVD", dest: "KBOS" }]);
      expect(db.prepare(`SELECT name FROM sqlite_master WHERE name = 'settings'`).get()).toBeDefined();
    } finally {
      db.close();
    }
  });

  // @spec APP-DATA-005
  it("runs as one transaction: a step that fails part way leaves the logbook exactly as it was", async () => {
    const file = await writeLogbook(path.join(logbookFolder(), "career.db"), { schema: "old" });
    const db = open(file);
    try {
      // A table created early, one created later, and a column added at the end are all missing;
      // the last column the step adds goes to a view, which SQLite refuses.
      db.exec(`DROP TABLE runways; DROP TABLE kv_cache; DROP TABLE airport_rwy; CREATE VIEW airport_rwy AS SELECT 'x' AS ident`);
    } finally {
      db.close();
    }
    const before = schemaOf(file);
    const again = open(file);
    try {
      expect(() => applySchema(again)).toThrow();
      expect(again.isTransaction).toBe(false);
    } finally {
      again.close();
    }
    expect(schemaOf(file)).toEqual(before);
  });
});

describe("the logbook's id (APP-DATA-006)", () => {
  // @spec APP-DATA-006
  it("makes ids of 16 random lowercase hexadecimal characters", () => {
    const ids = new Set(Array.from({ length: 200 }, () => newLogbookId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(ID);
  });

  // @spec APP-DATA-006
  it("reads the id a logbook holds, and none from one without", async () => {
    const withId = await writeLogbook(path.join(logbookFolder(), "career.db"), { logbookId: "0123456789abcdef" });
    const without = await writeLogbook(path.join(logbookFolder(), "career.db"), { schema: "old" });
    const preSettings = await writeLogbook(path.join(logbookFolder(), "career.db"), { schema: "pre-settings" });
    for (const [file, id] of [[withId, "0123456789abcdef"], [without, null], [preSettings, null]] as const) {
      const db = open(file);
      try {
        expect(readLogbookId(db)).toBe(id);
      } finally {
        db.close();
      }
    }
  });

  // @spec APP-DATA-006
  it("writes a new id under logbook_id, creating the settings table in a logbook from before it had one", async () => {
    const file = await writeLogbook(path.join(logbookFolder(), "career.db"), { schema: "pre-settings" });
    const db = open(file);
    try {
      const id = writeNewLogbookId(db);
      expect(id).toMatch(ID);
      expect(readLogbookId(db)).toBe(id);
      expect(db.prepare(`SELECT value FROM settings WHERE key = 'logbook_id'`).get()).toEqual({ value: id });
      const next = writeNewLogbookId(db);
      expect(next).not.toBe(id);
      expect(readLogbookId(db)).toBe(next);
      expect(db.prepare(`SELECT COUNT(*) AS n FROM settings WHERE key = 'logbook_id'`).get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  // @spec APP-DATA-006, APP-API-004
  it("gives the test servers' own database an id, which /api/status reports", async () => {
    const { db } = await import("../../src/server/db.ts");
    const { serverStatus } = await import("../../src/server/status.ts");
    const id = readLogbookId(db);
    expect(id).toMatch(ID);
    expect(serverStatus().logbookId).toBe(id);
  });
});
