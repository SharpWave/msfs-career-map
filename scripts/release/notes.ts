/**
 * The draft release's notes: the installer's SHA-256 and the folders an install, update or uninstall
 * keeps.
 *
 *   npx tsx scripts/release/notes.ts <version> <installer.exe> <notes.md>
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The file's SHA-256 as lower-case hex. */
export function sha256File(file: string): string {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

// @spec DESK-DIST-REL-006
export function releaseNotes(o: { version: string; installer: string; sha256: string }): string {
  return [
    `MSFS Career Map ${o.version} for Windows.`,
    "",
    `Download \`${o.installer}\` and run it. It installs for your Windows account only and needs no administrator rights.`,
    "",
    `SHA-256 of \`${o.installer}\`: \`${o.sha256}\``,
    "",
    "Your logbook is never inside the program's folder. Installing, updating and uninstalling leave these alone:",
    "",
    "- the data folder, `%LOCALAPPDATA%\\MSFS Career Map` (the logbook, its icons and the airport lists)",
    "- the backups folder, `MSFS Career Map\\Backups` in your Documents folder",
    "",
    "The installer is not code-signed, so Windows SmartScreen may warn the first time it runs.",
    "",
  ].join("\n");
}

const runDirectly = process.argv[1] !== undefined && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (runDirectly) {
  const [version, installer, notesFile] = process.argv.slice(2);
  if (!version || !installer || !notesFile) {
    console.error("usage: notes.ts <version> <installer.exe> <notes.md>");
    process.exit(1);
  }
  fs.writeFileSync(notesFile, releaseNotes({ version, installer: path.basename(installer), sha256: sha256File(installer) }));
}
