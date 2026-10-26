/**
 * The draft's installer and blockmap, copied under the name `latest.yml` gives the installer (its
 * `path`), which electron-updater asks the release for. electron-builder writes that name with hyphens
 * for the spaces of the local name; uploaded as it is, the local name would have each space turned into
 * a dot by GitHub, and `latest.yml` would name a file the release does not hold. Prints the copied
 * installer's path.
 *
 *   npx tsx scripts/release/assets.ts <installer.exe> <latest.yml> <folder>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The installer's name as latest.yml gives it, its quotes taken off. */
function latestPath(latestYml: string): string {
  const m = fs.readFileSync(latestYml, "utf8").match(/^path:[ \t]*(.*?)[ \t]*$/m);
  const name = m?.[1].replace(/^(['"])(.*)\1$/, "$2") ?? "";
  if (!name) throw new Error(`${latestYml} names no installer (no path:)`);
  if (/\s/.test(name)) throw new Error(`${latestYml} names the installer "${name}", with a space GitHub would turn into a dot`);
  return name;
}

// @spec DESK-DIST-REL-006
export function uploadAssets(o: { installer: string; latestYml: string; out: string }): { installer: string; blockmap: string } {
  const name = latestPath(o.latestYml);
  fs.mkdirSync(o.out, { recursive: true });
  const installer = path.join(o.out, name);
  const blockmap = `${installer}.blockmap`;
  fs.copyFileSync(o.installer, installer);
  fs.copyFileSync(`${o.installer}.blockmap`, blockmap);
  return { installer, blockmap };
}

const runDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (runDirectly) {
  const [installer, latestYml, out] = process.argv.slice(2);
  if (!installer || !latestYml || !out) {
    console.error("usage: assets.ts <installer.exe> <latest.yml> <folder>");
    process.exit(1);
  }
  console.log(uploadAssets({ installer, latestYml, out }).installer);
}
