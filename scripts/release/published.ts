/**
 * The release workflow's check, for a `v<version>` tag, that no published release of that version
 * exists: a published release is never changed or replaced.
 *
 *   npx tsx scripts/release/published.ts <version>   # reads the repository's releases with gh; exits 1 when one is published
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Whether `releases` holds a published (not draft) release tagged `v<version>`. */
// @spec DESK-DIST-REL-010
export function publishedFor(releases: { tag_name: string; draft: boolean }[], version: string): boolean {
  return releases.some((r) => r.tag_name === `v${version}` && !r.draft);
}

const runDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (runDirectly) {
  const version = process.argv[2] ?? "";
  const out = execFileSync("gh", ["api", "--paginate", "repos/{owner}/{repo}/releases", "--jq", ".[] | {tag_name, draft}"], { encoding: "utf8" });
  const releases = out.split(/\r?\n/).filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as { tag_name: string; draft: boolean });
  if (publishedFor(releases, version)) {
    console.error(`Release v${version} is already published: it is never changed. Publish a higher version instead.`);
    process.exit(1);
  }
  console.log(`No published release of v${version}.`);
}
