/**
 * The app's licence and the third-party notices (scripts/third-party-notices.ts, scripts/page-packages.ts,
 * scripts/desktop-build.ts), run here on stand-in repositories in temp folders, never Vite:
 * - the page build's record of the packages its bundle takes in, and the desktop build leaving it out of
 *   `page/` (DESK-DIST-PKG-025; the copy itself in desktop-build.test.ts);
 * - the notices listing exactly what ships, once per name and version, sorted, with each package's
 *   licence, the parts carrying it and its licence files' text (DESK-DIST-PKG-026);
 * - a package with no licence file given the standard MIT or ISC text, and the build stopped for any
 *   other (DESK-DIST-PKG-027);
 * - the notices' opening and end (DESK-DIST-PKG-028);
 * - the desktop build writing the app's licence as LICENSE.txt and the notices into its output
 *   (DESK-DIST-PKG-024, DESK-DIST-PKG-026).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { writeLicences } from "../../../scripts/desktop-build.ts";
import { pagePackages } from "../../../scripts/page-packages.ts";
import { packageDirOf, thirdPartyNotices, type Part } from "../../../scripts/third-party-notices.ts";
import { tempFolder } from "../support/fakes.ts";

const REPO = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const read = (file: string) => fs.readFileSync(file, "utf8");

/** A package folder under `root`, with its package.json and the given files. */
function pkg(root: string, rel: string, manifest: Record<string, unknown>, files: Record<string, string> = {}): string {
  const dir = path.join(root, ...rel.split("/"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, "index.js"), "module.exports = 1;\n");
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}

/** A stand-in repository's node_modules: one package of each kind the notices treat differently. */
function fixtureRepo() {
  const repo = tempFolder("notices-repo-");
  const nm = (rel: string) => `node_modules/${rel}`;
  const dirs = {
    alpha: pkg(repo, nm("alpha"), { name: "alpha", version: "1.0.0", license: "MIT" }, { LICENSE: "alpha licence text\n" }),
    alpha2: pkg(repo, nm("zeta/node_modules/alpha"), { name: "alpha", version: "2.0.0", license: "MIT" }, { "license.md": "alpha two licence\n" }),
    zeta: pkg(repo, nm("zeta"), { name: "zeta", version: "0.3.0", license: "BSD-3-Clause" }, { "LICENCE.txt": "zeta licence\n" }),
    beta: pkg(repo, nm("beta"), { name: "beta", version: "3.4.17", license: "(MPL-2.0 OR Apache-2.0)" }, { LICENSE: "beta apache\n", "LICENSE-MPL": "beta mpl\n", "README.md": "not a licence\n" }),
    gamma: pkg(repo, nm("gamma"), { name: "gamma", version: "6.0.0", license: "ISC", author: "Jane Doe <jane@example.com> (https://example.com)" }),
    eta: pkg(repo, nm("eta"), { name: "eta", version: "1.0.5", license: "MIT", author: { name: "Ann Example", email: "ann@example.com" } }),
    delta: pkg(repo, nm("@scope/delta"), { name: "@scope/delta", version: "4.2.1", license: "Hippocratic-2.1" }, { "LICENSE.md": "hippocratic text\n" }),
    sim: pkg(repo, nm("simlib"), { name: "simlib", version: "4.2.1", license: "LGPL-3.0-or-later" }, { LICENSE: "lgpl text\r\n" }),
    font: pkg(repo, nm("@fonts/b612"), { name: "@fonts/b612", version: "5.3.0", license: "OFL-1.1" }, { LICENSE: "ofl text\n" }),
    unused: pkg(repo, nm("unused"), { name: "unused", version: "9.0.0", license: "MIT" }, { LICENSE: "never shipped\n" }),
  };
  return { repo, dirs };
}

const shipped = (dirs: ReturnType<typeof fixtureRepo>["dirs"]): { dir: string; part: Part }[] => [
  { dir: dirs.beta, part: "page" },
  { dir: dirs.alpha, part: "server" },
  { dir: dirs.alpha, part: "page" },
  { dir: dirs.alpha2, part: "desktop shell" },
  { dir: dirs.zeta, part: "desktop shell" },
  { dir: dirs.gamma, part: "desktop shell" },
  { dir: dirs.eta, part: "server" },
  { dir: dirs.delta, part: "page" },
  { dir: dirs.sim, part: "beside the server" },
  { dir: dirs.font, part: "page" },
  { dir: dirs.alpha, part: "server" },
];

/** One package's entry: from its heading line to the next entry's. */
function entry(text: string, heading: string): string {
  const lines = text.split("\r\n");
  const start = lines.indexOf(heading);
  expect(start, heading).toBeGreaterThan(-1);
  const end = lines.findIndex((l, i) => i > start && l.startsWith("-----"));
  return lines.slice(start, end === -1 ? undefined : end).join("\r\n");
}

describe("the package a bundled file belongs to", () => {
  // @spec DESK-DIST-PKG-026
  it("is the innermost package folder in its path, scoped packages included", () => {
    expect(packageDirOf("C:\\r\\node_modules\\zeta\\node_modules\\alpha\\lib\\index.js")).toBe(path.resolve("C:\\r\\node_modules\\zeta\\node_modules\\alpha"));
    expect(packageDirOf("C:/r/node_modules/@scope/delta/dist/x.js")).toBe(path.resolve("C:/r/node_modules/@scope/delta"));
    expect(packageDirOf("C:\\r\\src\\client\\main.tsx")).toBeNull();
    expect(packageDirOf("\0vite/preload-helper.js")).toBeNull();
  });
});

describe("the third-party notices", () => {
  // @spec DESK-DIST-PKG-026
  it("list each shipped package once for each version, sorted by name, and nothing else", () => {
    const { dirs } = fixtureRepo();
    const text = thirdPartyNotices(shipped(dirs));
    const headings = text.split("\r\n").filter((l) => /^\S+ \d+\.\d+\.\d+$/.test(l));
    expect(headings).toEqual(["@fonts/b612 5.3.0", "@scope/delta 4.2.1", "alpha 1.0.0", "alpha 2.0.0", "beta 3.4.17", "eta 1.0.5", "gamma 6.0.0", "simlib 4.2.1", "zeta 0.3.0"]);
    expect(text).not.toContain("unused");
    expect(text).not.toContain("never shipped");
  });

  // @spec DESK-DIST-PKG-026
  it("list one version found in several folders once, with every part carrying any of them", () => {
    const { repo, dirs } = fixtureRepo();
    const copy = pkg(repo, "node_modules/zeta/node_modules/eta", { name: "eta", version: "1.0.5", license: "MIT", author: "Ann Example" });
    const text = thirdPartyNotices([...shipped(dirs), { dir: copy, part: "beside the server" }]);
    expect(text.split("\r\n").filter((l) => l === "eta 1.0.5")).toHaveLength(1);
    expect(entry(text, "eta 1.0.5")).toContain("Carried by: the server, beside the server");
  });

  // @spec DESK-DIST-PKG-026
  it("give each package's licence, the parts carrying it and the text of every licence and notice file at its root", () => {
    const { dirs } = fixtureRepo();
    const text = thirdPartyNotices(shipped(dirs));
    const alpha = entry(text, "alpha 1.0.0");
    expect(alpha).toContain("Licence: MIT");
    expect(alpha).toContain("Carried by: the page, the server");
    expect(alpha).toContain("alpha licence text");
    expect(entry(text, "alpha 2.0.0")).toContain("alpha two licence");
    expect(entry(text, "zeta 0.3.0")).toContain("zeta licence");
    const beta = entry(text, "beta 3.4.17");
    expect(beta).toContain("Licence: (MPL-2.0 OR Apache-2.0)");
    expect(beta).toContain("LICENSE:\r\nbeta apache");
    expect(beta).toContain("LICENSE-MPL:\r\nbeta mpl");
    expect(beta).not.toContain("not a licence");
    expect(entry(text, "simlib 4.2.1")).toContain("Carried by: beside the server");
  });

  // @spec DESK-DIST-PKG-026
  it("are the same text each time, with Windows line endings throughout", () => {
    const { dirs } = fixtureRepo();
    const text = thirdPartyNotices(shipped(dirs));
    expect(thirdPartyNotices([...shipped(dirs)].reverse())).toBe(text);
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(text.endsWith("\r\n")).toBe(true);
  });

  // @spec DESK-DIST-PKG-027
  it("give a package with no licence file the standard MIT or ISC text, its author as the holder", () => {
    const { dirs } = fixtureRepo();
    const text = thirdPartyNotices(shipped(dirs));
    const gamma = entry(text, "gamma 6.0.0");
    expect(gamma).toContain("Copyright (c) Jane Doe\r\n");
    expect(gamma).toContain("Permission to use, copy, modify, and/or distribute this software for any purpose");
    expect(gamma).not.toContain("jane@example.com");
    const eta = entry(text, "eta 1.0.5");
    expect(eta).toContain("Copyright (c) Ann Example\r\n");
    expect(eta).toContain("Permission is hereby granted, free of charge, to any person obtaining a copy");
  });

  // @spec DESK-DIST-PKG-027
  it("stop the build, naming the package, for one with no licence file and no standard text or no author", () => {
    const { repo, dirs } = fixtureRepo();
    const odd = pkg(repo, "node_modules/odd", { name: "odd", version: "1.0.0", license: "WTFPL", author: "Someone" });
    const anon = pkg(repo, "node_modules/anon", { name: "anon", version: "2.0.0", license: "MIT" });
    expect(() => thirdPartyNotices([...shipped(dirs), { dir: odd, part: "page" }])).toThrow(/odd 1\.0\.0/);
    expect(() => thirdPartyNotices([...shipped(dirs), { dir: anon, part: "server" }])).toThrow(/anon 2\.0\.0/);
  });

  // @spec DESK-DIST-PKG-028
  it("open with the app's licence, Electron's and Chromium's, and every package not under a permissive licence", () => {
    const { dirs } = fixtureRepo();
    const text = thirdPartyNotices(shipped(dirs));
    const firstEntry = text.indexOf("\r\n-----");
    const opening = text.slice(0, firstEntry);
    expect(opening).toContain("MIT License");
    expect(opening).toContain("LICENSE.txt");
    expect(opening).toContain("LICENSE.electron.txt");
    expect(opening).toContain("LICENSES.chromium.html");
    expect(opening).toContain("- @fonts/b612 5.3.0: OFL-1.1 (the page)");
    expect(opening).toContain("- @scope/delta 4.2.1: Hippocratic-2.1 (the page)");
    expect(opening).toContain("- beta 3.4.17: (MPL-2.0 OR Apache-2.0) (the page)");
    expect(opening).toContain("- simlib 4.2.1: LGPL-3.0-or-later (beside the server)");
    for (const permissive of ["alpha", "zeta", "gamma", "eta"]) expect(opening, permissive).not.toMatch(new RegExp(`^- ${permissive} `, "m"));
    expect(opening).toMatch(/Hippocratic License 2\.1[^\r\n]*bind whoever uses the app[^\r\n]*not an OSI/);
    expect(opening).toMatch(/LGPL-3\.0[^\r\n]*resources\\node_modules[^\r\n]*replaced/);
  });

  // @spec DESK-DIST-PKG-028
  it("end with OurAirports' seed airport lists, in the public domain", () => {
    const { dirs } = fixtureRepo();
    const lines = thirdPartyNotices(shipped(dirs)).trimEnd().split("\r\n");
    expect(lines.at(-1)).toMatch(/OurAirports.*airports\.csv.*runways\.csv.*public domain/);
  });

  // @spec DESK-DIST-PKG-028
  it("say nothing of the Hippocratic or LGPL licences when no package is under them", () => {
    const { dirs } = fixtureRepo();
    const text = thirdPartyNotices([{ dir: dirs.alpha, part: "page" }]);
    expect(text).not.toContain("Hippocratic");
    expect(text).not.toContain("resources\\node_modules");
  });
});

describe("the page build's record of its packages", () => {
  // @spec DESK-DIST-PKG-025
  it("names every package the page's scripts and assets take in, by name, version and folder", async () => {
    const { repo, dirs } = fixtureRepo();
    const outDir = path.join(repo, "dist");
    fs.mkdirSync(outDir, { recursive: true });
    const plugin = pagePackages(repo);
    const bundle = {
      "assets/index.js": {
        type: "chunk",
        modules: {
          [path.join(dirs.alpha, "index.js")]: {},
          [path.join(dirs.alpha, "lib", "x.js")]: {},
          [path.join(dirs.delta, "index.js")]: {},
          [path.join(repo, "src", "client", "main.tsx")]: {},
          "\0vite/preload-helper.js": {},
        },
      },
      "assets/b612.woff2": { type: "asset", originalFileNames: [path.join(dirs.font, "files", "b612.woff2")] },
      "assets/index.css": { type: "asset", originalFileNames: [] },
    };
    await (plugin.generateBundle as (o: unknown, b: unknown) => unknown).call({}, { dir: outDir }, bundle);
    await (plugin.writeBundle as (o: unknown, b: unknown) => unknown).call({}, { dir: outDir }, bundle);
    const record = JSON.parse(read(path.join(outDir, ".vite", "packages.json")));
    expect(record).toEqual({
      packages: [
        { name: "@fonts/b612", version: "5.3.0", dir: "node_modules/@fonts/b612" },
        { name: "@scope/delta", version: "4.2.1", dir: "node_modules/@scope/delta" },
        { name: "alpha", version: "1.0.0", dir: "node_modules/alpha" },
      ],
    });
  });

  // @spec DESK-DIST-PKG-025
  it("is made by the page build Vite runs", () => {
    const config = read(path.join(REPO, "vite.config.ts"));
    expect(config).toMatch(/import \{ pagePackages \} from "\.\/scripts\/page-packages\.ts";/);
    expect(config).toMatch(/plugins: \[[^\]]*pagePackages\(/);
  });
});

describe("the licences in the desktop build output", () => {
  /** The fixture repository with a LICENSE, a page build and its record. */
  function repoWithPage() {
    const f = fixtureRepo();
    fs.writeFileSync(path.join(f.repo, "LICENSE"), "MIT License\r\n\r\nCopyright (c) 2026 SharpWave\r\n");
    fs.mkdirSync(path.join(f.repo, "dist", ".vite"), { recursive: true });
    fs.writeFileSync(path.join(f.repo, "dist", "index.html"), "<!doctype html>");
    fs.writeFileSync(
      path.join(f.repo, "dist", ".vite", "packages.json"),
      JSON.stringify({ packages: [{ name: "beta", version: "3.4.17", dir: "node_modules/beta" }, { name: "@scope/delta", version: "4.2.1", dir: "node_modules/@scope/delta" }] }),
    );
    return f;
  }

  // @spec DESK-DIST-PKG-024, DESK-DIST-PKG-026
  it("are the app's LICENSE as LICENSE.txt and the notices for the page, the bundles and the server's libraries", () => {
    const { repo, dirs } = repoWithPage();
    const out = tempFolder("desktop-out-");
    writeLicences({
      repo,
      out,
      serverInputs: [path.join(dirs.alpha, "index.js"), path.join(repo, "src", "server", "app.ts")],
      shellInputs: [path.join(dirs.alpha2, "index.js"), path.join(dirs.gamma, "index.js")],
      libraries: ["simlib"],
    });
    expect(fs.readFileSync(path.join(out, "LICENSE.txt"))).toEqual(fs.readFileSync(path.join(repo, "LICENSE")));
    const text = read(path.join(out, "THIRD-PARTY-NOTICES.txt"));
    expect(entry(text, "beta 3.4.17")).toContain("Carried by: the page");
    expect(entry(text, "@scope/delta 4.2.1")).toContain("Carried by: the page");
    expect(entry(text, "alpha 1.0.0")).toContain("Carried by: the server");
    expect(entry(text, "alpha 2.0.0")).toContain("Carried by: the desktop shell");
    expect(entry(text, "gamma 6.0.0")).toContain("Carried by: the desktop shell");
    expect(entry(text, "simlib 4.2.1")).toContain("Carried by: beside the server");
    expect(text).not.toContain("zeta 0.3.0");
  });

  // @spec DESK-DIST-PKG-027
  it("are not written when a shipped package has no licence text the build can give", () => {
    const { repo, dirs } = repoWithPage();
    const odd = pkg(repo, "node_modules/odd", { name: "odd", version: "1.0.0", license: "WTFPL", author: "Someone" });
    const out = tempFolder("desktop-out-");
    expect(() =>
      writeLicences({ repo, out, serverInputs: [path.join(odd, "index.js")], shellInputs: [path.join(dirs.alpha, "index.js")], libraries: [] }),
    ).toThrow(/odd 1\.0\.0/);
    expect(fs.existsSync(path.join(out, "THIRD-PARTY-NOTICES.txt"))).toBe(false);
  });
});
