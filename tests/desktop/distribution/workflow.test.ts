/**
 * The release workflow as written (.github/workflows/release.yml; m3 contract §8), read with js-yaml.
 * What it does on a runner is seen only there, on a dry-run tag; this pins its shape: the two tags it
 * runs for, on windows-latest (DESK-DIST-REL-001, DESK-DIST-REL-018); the tag checked before anything
 * is built (DESK-DIST-REL-015) and a published release stopping it (DESK-DIST-REL-010); its steps in
 * order — the checks, the include's tests and the browser tests, the build with fresh seed lists, the
 * packaging, the smoke test and the round trip, then the draft (DESK-DIST-REL-002 to DESK-DIST-REL-006);
 * the draft only for a `v<version>` tag and only once every step before it passed, never published
 * (DESK-DIST-REL-007, DESK-DIST-REL-009, DESK-DIST-REL-018); its own GitHub token only
 * (DESK-DIST-REL-008); Electron's binary fetched before Electron runs (DESK-DIST-DEV-006); and the
 * round trip run here alone, asked for by this workflow (DESK-DIST-TRIP-001).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { describe, expect, it } from "vitest";

const REPO = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const TEXT = fs.readFileSync(path.join(REPO, ".github", "workflows", "release.yml"), "utf8");

interface Step {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
  "continue-on-error"?: unknown;
}
interface Job {
  "runs-on"?: string;
  steps?: Step[];
  if?: string;
  env?: Record<string, string>;
  defaults?: unknown;
}
interface Workflow {
  on?: Record<string, unknown>;
  permissions?: Record<string, string>;
  jobs?: Record<string, Job>;
  env?: Record<string, string>;
}

const workflow = yaml.load(TEXT) as Workflow;
const jobs = Object.values(workflow.jobs ?? {});
const job = jobs[0];
const steps: Step[] = job?.steps ?? [];

/** The index of the one step whose `run` holds `text` (and not `unless`); fails when none or several do. */
function stepWith(text: string, unless?: string): number {
  const found = steps.flatMap((s, i) => (s.run?.includes(text) && !(unless && s.run.includes(unless)) ? [i] : []));
  expect(found, `steps running ${text}`).toHaveLength(1);
  return found[0];
}

/** The release's own packaging, as against the round trip's newer build (which sets another version). */
const packaging = () => stepWith("electron-builder --win --x64 --publish never", "extraMetadata.version");

describe("when it runs", () => {
  // @spec DESK-DIST-REL-001, DESK-DIST-REL-018
  it("runs for a pushed v<version> or dry-run-v<version> tag and nothing else", () => {
    expect(Object.keys(workflow.on ?? {})).toEqual(["push"]);
    expect(workflow.on?.push).toEqual({ tags: ["v*", "dry-run-v*"] });
  });

  // @spec DESK-DIST-REL-001
  it("builds in one job on GitHub Actions windows-latest", () => {
    expect(jobs).toHaveLength(1);
    expect(job["runs-on"]).toBe("windows-latest");
    expect(job.if).toBeUndefined();
    // Bash, so `npm run <script> -- <flags>` keeps its flags: Windows PowerShell drops the bare `--`.
    expect(job.defaults).toEqual({ run: { shell: "bash" } });
  });
});

describe("its steps", () => {
  // @spec DESK-DIST-REL-015, DESK-DIST-REL-010
  it("check the tag against package.json, then look for a published release, before anything is installed or built", () => {
    const tag = stepWith("scripts/release/tag.ts");
    const published = stepWith("scripts/release/published.ts");
    expect(steps[tag].run).toContain("github.ref_name");
    expect(tag).toBeLessThan(published);
    expect(published).toBeLessThan(stepWith("npm ci"));
    // The published-release check is for a release's tag; a dry run changes no release anyway.
    expect(steps[published].if).toMatch(/startsWith\(\s*github\.ref_name\s*,\s*'v'\s*\)/);
  });

  // @spec DESK-DIST-REL-002, DESK-DIST-REL-003, DESK-DIST-REL-004, DESK-DIST-REL-005, DESK-DIST-REL-006
  it("install, check, test, build with fresh seed lists, package, smoke-test, round-trip and draft, in that order", () => {
    const order = [
      stepWith("npm ci"),
      stepWith("npx install-electron"),
      stepWith("npm run typecheck"),
      stepWith("npm test"),
      stepWith("npm run test:installer"),
      stepWith("npm run test:e2e"),
      stepWith("npm run desktop:build -- --fresh"),
      packaging(),
      stepWith("npm run test:packaged"),
      stepWith("scripts/release/round-trip.ts"),
      stepWith("gh release create"),
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  // @spec DESK-DIST-REL-002
  it("run the large import's wall-clock tests alone, right after the rest of the Vitest suites leave them out", () => {
    const suites = stepWith("npm test");
    const timed = stepWith("npx vitest run");
    expect(timed).toBe(suites + 1);
    for (const file of ["tests/airports/import.test.ts", "tests/app-shell/server-airports.test.ts"]) {
      expect(steps[suites].run).toContain(`--exclude ${file}`);
      expect(steps[timed].run).toContain(file);
    }
  });

  // @spec DESK-DIST-REL-002
  it("install the browser for the Playwright tests before they run", () => {
    expect(stepWith("playwright install")).toBeLessThan(stepWith("npm run test:e2e"));
  });

  // @spec DESK-DIST-DEV-006
  it("fetch Electron's binary before any step that runs Electron", () => {
    const fetch = stepWith("npx install-electron");
    expect(fetch).toBeLessThan(stepWith("npm run test:packaged"));
    expect(fetch).toBeLessThan(stepWith("scripts/release/round-trip.ts"));
  });

  // @spec DESK-DIST-TRIP-002
  it("build the newer installer for the round trip from the same build, with a higher version, before the round trip", () => {
    const newer = steps.findIndex((s) => s.run?.includes("electron-builder") && s.run.includes("extraMetadata.version"));
    expect(newer).toBeGreaterThan(stepWith("npm run test:packaged"));
    expect(newer).toBeLessThan(stepWith("scripts/release/round-trip.ts"));
    expect(steps[newer].run).toContain("--publish never");
  });
});

describe("the draft", () => {
  // @spec DESK-DIST-REL-006, DESK-DIST-REL-018
  it("is made only for a v<version> tag", () => {
    const draft = steps[stepWith("gh release create")];
    expect(draft.if).toMatch(/startsWith\(\s*github\.ref_name\s*,\s*'v'\s*\)/);
    expect(draft.if).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
  });

  // @spec DESK-DIST-REL-006
  it("holds the installer, its blockmap and latest.yml, with notes made by the notes script", () => {
    const run = steps[stepWith("gh release create")].run!;
    expect(run).toContain("--draft");
    expect(run).toMatch(/Setup/);
    expect(run).toContain(".blockmap");
    expect(run).toContain("latest.yml");
    expect(TEXT).toContain("scripts/release/notes.ts");
  });

  // @spec DESK-DIST-REL-007
  it("waits on every step before it: none may fail and be passed over", () => {
    for (const s of steps) {
      expect(s["continue-on-error"], s.name ?? s.run).toBeUndefined();
      if (s.if) expect(s.if, s.name ?? s.run).not.toMatch(/always\(\)|failure\(\)|cancelled\(\)/);
    }
  });

  // @spec DESK-DIST-REL-009, DESK-DIST-REL-018
  it("is never published, nor any release changed: one create, as a draft, and electron-builder publishing nothing", () => {
    expect(TEXT.match(/gh release create/g)).toHaveLength(1);
    expect(TEXT).not.toMatch(/gh release (edit|delete|upload)/);
    expect(TEXT).not.toMatch(/--draft=false|--publish (always|onTag|onTagOrDraft)/);
    for (const s of steps.filter((s) => s.run?.includes("electron-builder"))) expect(s.run).toContain("--publish never");
  });
});

describe("its rights and the round trip", () => {
  // @spec DESK-DIST-REL-008
  it("uses only the token GitHub Actions gives it", () => {
    expect(TEXT).not.toMatch(/secrets\./);
    expect(TEXT).toContain("github.token");
    expect(workflow.permissions).toEqual({ contents: "write" });
  });

  // @spec DESK-DIST-TRIP-001, DESK-DIST-TRIP-007
  it("asks for the round trip on that step alone", () => {
    const trip = stepWith("scripts/release/round-trip.ts");
    expect(steps[trip].env?.CAREER_MAP_ROUND_TRIP).toBe("release-workflow");
    steps.forEach((s, i) => {
      if (i !== trip) expect(s.env?.CAREER_MAP_ROUND_TRIP, s.name ?? s.run).toBeUndefined();
    });
    expect(job.env?.CAREER_MAP_ROUND_TRIP).toBeUndefined();
    expect(workflow.env?.CAREER_MAP_ROUND_TRIP).toBeUndefined();
  });
});
