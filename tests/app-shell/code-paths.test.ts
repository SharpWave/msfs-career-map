/**
 * Every file the server reads or writes is found through its inputs, never through a path worked out
 * from where its own code lies, but for a copy run from source's defaults (APP-SRV-008): read from the
 * server's source, so code bundled into one file finds the same files.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO } from "../support/server-process.ts";

const SERVER = path.join(REPO, "src", "server");
/** Ways code finds its own location. */
const OWN_LOCATION = /import\.meta\.(url|dirname|filename)|__dirname|__filename|process\.cwd\(\)|\bROOT\b/;

/**
 * The only places allowed, each with why: the repository root worked out once (locations.ts), used
 * for a copy run from source's defaults (inputs.ts) and its version (version.ts); and the start-up
 * worker's own module, which is code to load rather than a file the server reads or writes
 * (packaging it is the desktop build's, desktop distribution).
 */
const ALLOWED: Record<string, RegExp[]> = {
  "locations.ts": [/^const here = path\.dirname\(fileURLToPath\(import\.meta\.url\)\);$/, /^export const ROOT = /, /dataLocations|ROOT, "data", "career\.db"/],
  "inputs.ts": [/^import \{ ROOT \} from "\.\/locations\.ts";$/, /ROOT` is used/, /path\.join\(ROOT, "data"\)/, /path\.join\(ROOT, "dist"\)/],
  "version.ts": [/^import \{ ROOT \} from "\.\/locations\.ts";$/, /path\.join\(ROOT, "package\.json"\)/],
  "server.ts": [/new Worker\(new URL\("\.\/startup-worker\.ts", import\.meta\.url\)/],
};

describe("files found through the inputs (APP-SRV-008)", () => {
  // @spec APP-SRV-008
  it("works out no path from the location of its own code but the source copy's defaults", () => {
    const offending: string[] = [];
    for (const name of fs.readdirSync(SERVER).filter((n) => n.endsWith(".ts"))) {
      const lines = fs.readFileSync(path.join(SERVER, name), "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        const code = line.trim();
        if (!OWN_LOCATION.test(code) || code.startsWith("//") || code.startsWith("*")) return;
        if ((ALLOWED[name] ?? []).some((re) => re.test(code))) return;
        offending.push(`${name}:${i + 1}: ${code}`);
      });
    }
    expect(offending).toEqual([]);
  });
});
