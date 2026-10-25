/**
 * The start lists' unit tests reach nothing real (DESK-START-TEST-004; m4 contract §1, §9.2): loading
 * every start-list module calls nothing the desktop guard stands in for (the process list and the
 * registry through child_process, Electron's login item through electron), and the editions' folders
 * built from the account's known folders lie in the guard's decoy, so a test that forgets its own temp
 * folders still never touches the sim's real `EXE.xml`.
 */
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decoyFolder, takeGuardHits } from "../support/guard.ts";

const MODULES = [
  "exe-xml.ts",
  "start-list-backups.ts",
  "msfs-start.ts",
  "windows-start.ts",
  "startup-keys.ts",
  "start-lists.ts",
  "unregister.ts",
] as const;

const inside = (folder: string, root: string) => {
  const rel = path.win32.relative(root.toLowerCase(), folder.toLowerCase());
  return rel !== "" && !rel.startsWith("..") && !path.win32.isAbsolute(rel);
};

describe("the start lists' tests", () => {
  // @spec DESK-START-TEST-004, DESK-START-TEST-003
  it("load every start-list module without reaching a process, the registry or Electron", async () => {
    takeGuardHits();
    for (const name of MODULES) await import(`../../../src/desktop/${name}`);
    expect(takeGuardHits()).toEqual([]);
  });

  // @spec DESK-START-TEST-004, DESK-START-MSFS-002
  it("find both editions' folders inside the decoy, never the pilot's own", async () => {
    const { editionFolders } = await import("../../../src/desktop/msfs-start.ts");
    const folders = editionFolders(process.env);
    expect(folders.map((f) => f.edition)).toEqual(["Store", "Steam"]);
    for (const f of folders) expect(inside(f.folder, decoyFolder())).toBe(true);
  });
});
