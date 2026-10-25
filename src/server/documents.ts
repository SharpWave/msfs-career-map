import { execFile } from "node:child_process";

/**
 * Windows' Documents known folder, looked up when asked (at each backup), so a Documents folder that
 * OneDrive's folder backup or the pilot moves while the app runs is followed. Node has no call for
 * known folders; the user's `User Shell Folders` value is where Windows keeps the folder's place, as
 * a path that may hold `%VARIABLES%`.
 */

const KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders";

/** `%NAME%` replaced from the environment, matched without regard to case as Windows does. */
function expand(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => {
    const key = Object.keys(env).find((k) => k.toLowerCase() === name.toLowerCase());
    return key && env[key] !== undefined ? (env[key] as string) : whole;
  });
}

/** The Documents folder's path; rejects when Windows cannot say. Never creates anything. */
// @spec APP-BAK-006
export function documentsFolder(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("reg.exe", ["query", KEY, "/v", "Personal"], { windowsHide: true, timeout: 10_000 }, (err, stdout) => {
      if (err) return reject(new Error(`Windows did not say where Documents is: ${err.message}`));
      const m = /^\s*Personal\s+REG_(?:EXPAND_)?SZ\s+(.+?)\s*$/m.exec(stdout);
      if (!m) return reject(new Error("Windows did not say where Documents is"));
      resolve(expand(m[1], env));
    });
  });
}
