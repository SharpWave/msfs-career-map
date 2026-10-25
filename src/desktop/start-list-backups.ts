/**
 * The start-up list backups' names and pruning, in the `start-up list backups` folder of Electron's
 * own folder: `EXE.xml.<Store|Steam>.<yyyyMMddTHHmmssZ>` and `Run.<yyyyMMddTHHmmssZ>.reg`, the time in
 * UTC to the second, with `-2`, `-3`, … for a second one within that second. The five newest of each
 * kind are kept, judged by the time in the name and then the suffix; only names of the app's own form
 * are ever deleted. Plain functions of names; the passes do the file work.
 */

export const BACKUPS_FOLDER = "start-up list backups";
export const KEEP = 5;
export type Edition = "Store" | "Steam";

const pad = (n: number) => String(n).padStart(2, "0");

/** "20261025T120000Z" from a time, UTC, to the second. */
export function backupStamp(now: Date): string {
  return (
    `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
    `T${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}Z`
  );
}

/** The first of `name(1)`, `name(2)`, … not in `taken`, compared ignoring case. */
function firstFree(name: (n: number) => string, taken: readonly string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  for (let n = 1; ; n++) {
    const candidate = name(n);
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

const suffix = (n: number) => (n === 1 ? "" : `-${n}`);

/** EXE.xml.<edition>.<stamp>, or with -2, -3, … after the stamp, the first not in `taken`. */
// @spec DESK-START-MSFS-029
export function exeXmlBackupName(edition: Edition, now: Date, taken: readonly string[]): string {
  const stamp = backupStamp(now);
  return firstFree((n) => `EXE.xml.${edition}.${stamp}${suffix(n)}`, taken);
}

/** Run.<stamp>.reg, or Run.<stamp>-2.reg, …, the first not in `taken`. */
// @spec DESK-START-WINDOWS-002
export function regBackupName(now: Date, taken: readonly string[]): string {
  const stamp = backupStamp(now);
  return firstFree((n) => `Run.${stamp}${suffix(n)}.reg`, taken);
}

const STAMP = "(\\d{8}T\\d{6}Z)(?:-(\\d+))?";

function pattern(kind: Edition | "reg"): RegExp {
  return kind === "reg" ? new RegExp(`^Run\\.${STAMP}\\.reg$`, "i") : new RegExp(`^EXE\\.xml\\.${kind}\\.${STAMP}$`, "i");
}

/**
 * The names to delete so the five newest of that kind stay: newest by the stamp, then the suffix as a
 * number (none counting as 1); only names of exactly that form, recognised in any letter case and
 * returned as found.
 */
// @spec DESK-START-MSFS-030, DESK-START-WINDOWS-002
export function namesToPrune(kind: Edition | "reg", names: readonly string[]): string[] {
  const re = pattern(kind);
  const own = names.flatMap((name) => {
    const m = re.exec(name);
    return m ? [{ name, stamp: m[1].toUpperCase(), n: m[2] === undefined ? 1 : Number(m[2]) }] : [];
  });
  own.sort((a, b) => (a.stamp === b.stamp ? b.n - a.n : a.stamp < b.stamp ? 1 : -1));
  return own.slice(KEEP).map((o) => o.name);
}
