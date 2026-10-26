/**
 * The page build's record of the npm packages its bundle takes in, `.vite/packages.json` in its output,
 * which the desktop build's third-party notices are written from (distribution-design, Packaging: The
 * licences).
 */
import fs from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";
import { packageDirOf } from "./third-party-notices.ts";

/** One package the page bundle takes in; `dir` is its folder relative to the repository, with forward slashes. */
export interface PagePackage {
  name: string;
  version: string;
  dir: string;
}

/** The record's place in the page build's output. */
export const PAGE_RECORD = [".vite", "packages.json"] as const;

/**
 * Records every package the page's script chunks and its assets' source files come from.
 * @spec DESK-DIST-PKG-025
 */
export function pagePackages(repo: string): Plugin {
  let dirs = new Set<string>();
  // Vite gives an asset's source files relative to its root (src/client), a chunk's modules as full paths.
  let root = repo;
  return {
    name: "page-packages",
    apply: "build",
    configResolved(config) {
      root = config.root;
    },
    generateBundle(_options, bundle) {
      dirs = new Set();
      for (const item of Object.values(bundle)) {
        const files = item.type === "chunk" ? Object.keys(item.modules) : (item.originalFileNames ?? []).map((f) => path.resolve(root, f));
        for (const file of files) {
          const dir = packageDirOf(file);
          if (dir) dirs.add(dir);
        }
      }
    },
    writeBundle(options) {
      const packages: PagePackage[] = [...dirs]
        .map((dir) => {
          const m = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")) as { name: string; version: string };
          return { name: m.name, version: m.version, dir: path.relative(repo, dir).split(path.sep).join("/") };
        })
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.version.localeCompare(b.version, "en", { numeric: true })));
      const file = path.join(options.dir ?? "dist", ...PAGE_RECORD);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify({ packages }, null, 2)}\n`);
    },
  };
}
