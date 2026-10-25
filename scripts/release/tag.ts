/**
 * The release workflow's first step: the pushed tag must be `v<version>` (a release) or
 * `dry-run-v<version>` (a rehearsal, no draft) with package.json's version; anything else fails the
 * workflow before it builds anything.
 *
 *   npx tsx scripts/release/tag.ts <tag>     # prints release or dry-run; exits 1 with the reason otherwise
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type TagCheck = { kind: "release" | "dry-run"; version: string } | { error: string };

const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// @spec DESK-DIST-REL-001, DESK-DIST-REL-015, DESK-DIST-REL-018
export function checkTag(refName: string, packageVersion: string): TagCheck {
  const m = /^(dry-run-)?v(.+)$/.exec(refName);
  if (!m || !VERSION.test(m[2])) {
    return { error: `The tag "${refName}" is neither v<version> nor dry-run-v<version>` };
  }
  if (m[2] !== packageVersion) {
    return { error: `The tag "${refName}" names version ${m[2]}, but package.json's version is ${packageVersion}` };
  }
  return { kind: m[1] ? "dry-run" : "release", version: m[2] };
}

const runDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (runDirectly) {
  const repo = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  const version: string = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")).version;
  const c = checkTag(process.argv[2] ?? "", version);
  if ("error" in c) {
    console.error(c.error);
    process.exit(1);
  }
  console.log(c.kind === "release" ? `Release ${c.version}` : `Dry run of ${c.version}: no draft will be made`);
}
