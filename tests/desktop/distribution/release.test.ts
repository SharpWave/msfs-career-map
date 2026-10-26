/**
 * The release workflow's own scripts (scripts/release/; m3 contract §8): the pushed tag checked
 * against `package.json`'s version, a `v<version>` tag making a draft and a `dry-run-v<version>` tag
 * only rehearsing (DESK-DIST-REL-001, DESK-DIST-REL-015, DESK-DIST-REL-018); a published release for
 * the version stopping the workflow (DESK-DIST-REL-010); the draft's notes with the installer's
 * SHA-256 and the folders kept, and its installer and blockmap under the name latest.yml gives them
 * (DESK-DIST-REL-006); and the installer round trip's guard, seeded
 * logbook, seeded backups and newer build's version (DESK-DIST-TRIP-003, DESK-DIST-TRIP-007).
 */
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { uploadAssets } from "../../../scripts/release/assets.ts";
import { roundTripAllowed, ROUND_TRIP_REFUSED } from "../../../scripts/release/guard.ts";
import { releaseNotes, sha256File } from "../../../scripts/release/notes.ts";
import { publishedFor } from "../../../scripts/release/published.ts";
import { seedLogbook, seededBackupNames, tripVersion } from "../../../scripts/release/seed.ts";
import { checkTag } from "../../../scripts/release/tag.ts";
import { tempFolder } from "../support/fakes.ts";

describe("the pushed tag", () => {
  // @spec DESK-DIST-REL-001
  it("builds a release for v<version> matching package.json's version", () => {
    expect(checkTag("v0.8.0", "0.8.0")).toEqual({ kind: "release", version: "0.8.0" });
    expect(checkTag("v1.2.3-beta.1", "1.2.3-beta.1")).toEqual({ kind: "release", version: "1.2.3-beta.1" });
  });

  // @spec DESK-DIST-REL-001, DESK-DIST-REL-018
  it("rehearses for dry-run-v<version> matching package.json's version", () => {
    expect(checkTag("dry-run-v0.8.0", "0.8.0")).toEqual({ kind: "dry-run", version: "0.8.0" });
  });

  // @spec DESK-DIST-REL-015
  it("fails a tag whose version differs from package.json's, naming both", () => {
    for (const tag of ["v0.8.1", "dry-run-v0.9.0"]) {
      const c = checkTag(tag, "0.8.0");
      expect(c).toHaveProperty("error");
      const error = (c as { error: string }).error;
      expect(error).toContain(tag.replace(/^(dry-run-)?v/, ""));
      expect(error).toContain("0.8.0");
    }
  });

  // @spec DESK-DIST-REL-015
  it("fails a tag of neither form", () => {
    for (const tag of ["0.8.0", "dry-run-0.8.0", "v0.8", "release-v0.8.0", "vv0.8.0", "v0.8.0 ", ""]) {
      expect(checkTag(tag, "0.8.0"), tag).toHaveProperty("error");
    }
  });
});

describe("a release already published", () => {
  // @spec DESK-DIST-REL-010
  it("is found only when a release for the version is published, not a draft", () => {
    const releases = [
      { tag_name: "v0.7.0", draft: false },
      { tag_name: "v0.8.0", draft: true },
    ];
    expect(publishedFor(releases, "0.8.0")).toBe(false);
    expect(publishedFor(releases, "0.7.0")).toBe(true);
    expect(publishedFor([], "0.8.0")).toBe(false);
    expect(publishedFor([{ tag_name: "dry-run-v0.8.0", draft: false }], "0.8.0")).toBe(false);
  });
});

describe("the draft's release notes", () => {
  let folder: string | null = null;
  afterEach(() => {
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
    folder = null;
  });

  // @spec DESK-DIST-REL-006
  it("give the installer's SHA-256 and name the data and backups folders", () => {
    const notes = releaseNotes({
      version: "0.8.0",
      installer: "MSFS-Career-Map-Setup-0.8.0.exe",
      sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    });
    expect(notes).toContain("Download `MSFS-Career-Map-Setup-0.8.0.exe`");
    expect(notes).toContain("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
    expect(notes).toContain("SHA-256");
    expect(notes).toContain("%LOCALAPPDATA%\\MSFS Career Map");
    expect(notes).toContain("MSFS Career Map\\Backups");
    expect(notes).toContain("Documents");
  });

  // @spec DESK-DIST-REL-006
  it("hash the installer's bytes as lower-case hex", () => {
    folder = tempFolder("notes-");
    const file = path.join(folder, "setup.exe");
    fs.writeFileSync(file, "test");
    expect(sha256File(file)).toBe("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08");
  });
});

describe("the draft's installer and blockmap", () => {
  let folder: string | null = null;
  afterEach(() => {
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
    folder = null;
  });

  /** electron-builder's output as the workflow finds it: the installer, its blockmap and latest.yml. */
  function release(latest: string) {
    folder = tempFolder("assets-");
    const installer = path.join(folder, "MSFS Career Map Setup 0.8.0.exe");
    fs.writeFileSync(installer, "installer bytes");
    fs.writeFileSync(`${installer}.blockmap`, "blockmap bytes");
    const latestYml = path.join(folder, "latest.yml");
    fs.writeFileSync(latestYml, latest);
    return { installer, latestYml, out: path.join(folder, "upload") };
  }

  const LATEST = [
    "version: 0.8.0",
    "files:",
    "  - url: MSFS-Career-Map-Setup-0.8.0.exe",
    "    sha512: abc==",
    "    size: 15",
    "path: MSFS-Career-Map-Setup-0.8.0.exe",
    "sha512: abc==",
    "releaseDate: '2026-10-26T21:32:44.485Z'",
    "",
  ].join("\n");

  // @spec DESK-DIST-REL-006
  it("are copied, byte for byte, under the name latest.yml gives the installer, with .blockmap for the blockmap", () => {
    const r = release(LATEST);
    const up = uploadAssets(r);
    expect(up.installer).toBe(path.join(r.out, "MSFS-Career-Map-Setup-0.8.0.exe"));
    expect(up.blockmap).toBe(path.join(r.out, "MSFS-Career-Map-Setup-0.8.0.exe.blockmap"));
    expect(fs.readFileSync(up.installer, "utf8")).toBe("installer bytes");
    expect(fs.readFileSync(up.blockmap, "utf8")).toBe("blockmap bytes");
    expect(fs.readdirSync(r.out).sort()).toEqual(["MSFS-Career-Map-Setup-0.8.0.exe", "MSFS-Career-Map-Setup-0.8.0.exe.blockmap"]);
  });

  // @spec DESK-DIST-REL-006
  it("take the name as latest.yml writes it, quoted or not", () => {
    const r = release(LATEST.replace("path: MSFS-Career-Map-Setup-0.8.0.exe", "path: 'MSFS-Career-Map-Setup-0.8.0.exe'"));
    expect(path.basename(uploadAssets(r).installer)).toBe("MSFS-Career-Map-Setup-0.8.0.exe");
  });

  // @spec DESK-DIST-REL-006
  it("stop the draft when latest.yml names no installer, or one with a space", () => {
    const missing = release(LATEST.replace(/^path: .*$/m, ""));
    expect(() => uploadAssets(missing)).toThrow(/latest\.yml names no installer/);
    const spaced = release(LATEST.replace("path: MSFS-Career-Map-Setup-0.8.0.exe", "path: MSFS Career Map Setup 0.8.0.exe"));
    expect(() => uploadAssets(spaced)).toThrow(/space/);
    expect(fs.existsSync(spaced.out)).toBe(false);
  });
});

describe("the installer round trip's guard", () => {
  const RUNNER = {
    GITHUB_ACTIONS: "true",
    RUNNER_ENVIRONMENT: "github-hosted",
    GITHUB_WORKFLOW_REF: "SharpWave/msfs-career-map/.github/workflows/release.yml@refs/tags/dry-run-v0.8.0",
    CAREER_MAP_ROUND_TRIP: "release-workflow",
  };

  // @spec DESK-DIST-TRIP-001, DESK-DIST-TRIP-007
  it("lets it run only on the release workflow's GitHub-hosted runner, asked for by that workflow", () => {
    expect(roundTripAllowed(RUNNER)).toBe(true);
  });

  // @spec DESK-DIST-TRIP-007
  it("refuses anywhere else: a developer's PC, a self-hosted runner, another workflow, or no request", () => {
    expect(roundTripAllowed({})).toBe(false);
    expect(roundTripAllowed({ ...RUNNER, GITHUB_ACTIONS: undefined })).toBe(false);
    expect(roundTripAllowed({ ...RUNNER, RUNNER_ENVIRONMENT: "self-hosted" })).toBe(false);
    expect(roundTripAllowed({ ...RUNNER, GITHUB_WORKFLOW_REF: "SharpWave/msfs-career-map/.github/workflows/ci.yml@refs/heads/main" })).toBe(false);
    expect(roundTripAllowed({ ...RUNNER, CAREER_MAP_ROUND_TRIP: undefined })).toBe(false);
    expect(roundTripAllowed({ CAREER_MAP_ROUND_TRIP: "release-workflow" })).toBe(false);
  });

  // @spec DESK-DIST-TRIP-007
  it("says why it refused: the round trip overwrites the real data folder", () => {
    expect(ROUND_TRIP_REFUSED).toContain("release workflow");
    expect(ROUND_TRIP_REFUSED).toContain("%LOCALAPPDATA%\\MSFS Career Map");
  });
});

describe("the round trip's seeded logbook and backups", () => {
  let folder: string | null = null;
  afterEach(() => {
    if (folder) fs.rmSync(folder, { recursive: true, force: true });
    folder = null;
  });

  // @spec DESK-DIST-TRIP-003
  it("seeds a logbook holding hops, with the round trip's own logbook id where app-shell keeps it", () => {
    folder = tempFolder("seed-");
    const file = path.join(folder, "career.db");
    const id = "0123456789abcdef";
    const { hops } = seedLogbook(file, id);
    expect(hops).toBeGreaterThan(0);
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      expect(db.prepare("SELECT value FROM settings WHERE key = 'logbook_id'").get()).toEqual({ value: id });
      expect((db.prepare("SELECT COUNT(*) AS n FROM hops").get() as { n: number }).n).toBe(hops);
    } finally {
      db.close();
    }
  });

  // @spec DESK-DIST-TRIP-003
  it("names two daily backups as the server names its own, with that id and UTC times before now", () => {
    const id = "0123456789abcdef";
    const now = new Date("2026-10-25T12:00:00Z");
    const names = seededBackupNames(id, now);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    for (const name of names) {
      const m = /^career-(\d{8}T\d{6}Z)-daily-([0-9a-f]{16})\.db$/.exec(name);
      expect(m, name).not.toBeNull();
      expect(m![2]).toBe(id);
      const t = m![1];
      const time = new Date(`${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}Z`);
      expect(time.getTime()).toBeLessThan(now.getTime());
    }
  });

  // @spec DESK-DIST-TRIP-002
  it("gives the newer build a version above the release's", () => {
    expect(tripVersion("0.8.0")).toBe("0.8.1-trip.1");
    expect(tripVersion("1.2.9")).toBe("1.2.10-trip.1");
  });
});
