# Arrow: start-lists

Starting with MSFS and with Windows, one of the three parts of the desktop grouping: the `EXE.xml` editor
(MSFS 2024, Store and Steam) and its backups in Electron's folder, Windows' Run and StartupApproved keys,
the two tray items, and the start-list work `--unregister` does for the uninstaller.

## Status

**MAPPED** — LLD and EARS specs written 2026-10-23, before any code, with the intent-narrowing edge
audit's findings for the desktop group applied; built test-first on 2026-10-25, every spec but the
deferred one implemented and unit-tested on fixtures and stand-ins; not yet audited against code, nor
tried on the real `EXE.xml`, `reg.exe` or Electron's login item. Its one note for another segment, the README's advice for MSFS 2020, is in app-shell's
LLD (Docs This Segment Owns); its other reliances are on the desktop shell, each cited by spec in the
LLD's Relies On.

## References

### HLD
- docs/high-level-design.md (Tenets → A guest in the sim's house; Key Design Decisions → Starting with
  the sim)
- docs/intent/desktop/desktop-design.md (sub-HLD: the tenets, names and folders, test mode)

### LLD
- docs/intent/desktop/start-lists/start-lists-design.md

### EARS
- docs/intent/desktop/start-lists/start-lists-specs.md — 76 specs (prefix `DESK-START`), 75
  implemented, 1 deferred

### Tests
- tests/desktop/start-lists/ (desktop Vitest project): exe-xml, backups, startup-keys (pure parts);
  msfs-pass, msfs-item (the passes over the editions' folders and the Start with MSFS 2024 item, on temp
  folders through `ScriptedFs`); windows-start, unregister, shell-items, guard. Fixtures in
  tests/desktop/start-lists/fixtures/ (README there), loaded by support/sims.ts; `ScriptedFs` and `FakeKeys`
  in tests/desktop/support/fakes.ts. Also tests/desktop/shell/tray-model.test.ts (the items' place) and
  tests/desktop/distribution/packaging.test.ts (DESK-START-MSFS-024)

### Code
- src/desktop/exe-xml.ts (reading, adding and removing the app's entry as text, the result's check;
  XML parsed with `saxes`), start-list-backups.ts (names and pruning), msfs-start.ts (the editions'
  folders, the item's state, the passes, `nodeEditorFs`), windows-start.ts and startup-keys.ts (Start with
  Windows; reg.exe and Electron's login item), start-lists.ts (the two tray items), unregister.ts
  (`--unregister`); wired in tray-model.ts, shell.ts and main.ts; `EditorFs` and `StartupKeys` in ports.ts

## Architecture

**Purpose:** Let the pilot have MSFS or Windows start the app, changing the lists the sim and other
programs share only by the app's one entry, only when asked, and only after a backup.

**Key Components:**
1. `EXE.xml` editor — parse to check, insert or remove the app's entry as text, parse the result, read
   the file again and replace it in one step; every edition installed when turning on, every `EXE.xml`
   present when turning off; every pass over the editions' folders first deletes a temporary file a
   change cut short (a crash, a Windows session end) left there
2. Start-list backups — `EXE.xml` copies (five per edition) and `.reg` exports of Windows' keys (taken
   only when a key will change), in Electron's folder, named in UTC ending in `Z`, the five newest judged
   by the time in the name
3. Start with MSFS 2024 item — state read as the menu opens and again at the click, its words ("Start
   with MSFS 2024" in every state), its reasons logged once each time they start, an entry another
   program removed never put back, and the record of files last written kept in an order a change cut
   short cannot turn into a false "removed by another program"
4. Start with Windows — Electron's login item in the Run key, marked enabled under StartupApproved; the
   value named "MSFS Career Map" is the app's whatever it holds
5. `--unregister` — the uninstaller's clean-up of both lists, bounded to 15 s, its exit code (0 to 3)
   naming which list still holds the entry or could not be checked, each file taken out of the record of
   files last written before its entry is removed
6. Test mode — neither list read or written, both tray items left out, `--unregister` exiting at once
   with 0

## Spec Coverage

| Category | Spec IDs | Implemented | Deferred | Gaps |
|----------|----------|-------------|----------|------|
| Start with MSFS: editions, the item, the app's entry, the `EXE.xml` editor, backups, an entry another program removed | DESK-START-MSFS-001 to 055 | 54 | 1 | 0 |
| Start with Windows | DESK-START-WINDOWS-001 to 009 | 9 | 0 | 0 |
| Test mode and unit tests | DESK-START-TEST-001 to 004 | 4 | 0 | 0 |
| Unregistering | DESK-START-UNREG-001 to 008 | 8 | 0 | 0 |

**Summary:** 75 of 76 specs implemented; no gaps; 1 deferred (DESK-START-MSFS-010, Starting with MSFS
2020). Every implemented spec is cited by a test.

## Key Findings

1. **Built test-first** — the tests reach the sim's folders, the registry, the process list and Electron
   only through stand-ins; the real `reg.exe` and login-item port (startup-keys.ts) is tested only in its
   pure helpers. reg.exe's output is read as UTF-8, so a Run value naming a path outside ASCII may not
   compare equal; the effect is only an export and rewrite that were not needed.
2. **Built on the desktop shell** — the tray menu that offers the two items, the settings that record
   the `EXE.xml` files last written, `desktop.log`, and the command line that runs `--unregister` before
   the single-instance lock. DESK-SHELL-CLI-009 and DESK-START-TEST-002 agree that `--unregister`
   with `--test-data=<folder>` reaches neither start list, and DESK-START-UNREG-008 has that start exit
   at once with 0; a click on either item is ignored while the desktop shell is quitting
   (DESK-SHELL-QUIT-003), and at every quit but a Windows session end (an update installed at a quiet
   moment included) a change already under way finishes within its own bounds before the server shuts
   down, its outcome written to `desktop.log` with no message box (DESK-SHELL-QUIT-012, citing
   DESK-START-MSFS-040 and 041); a change a session end cuts short
   leaves at most the temporary file, deleted by the next pass over the editions' folders
   (DESK-START-MSFS-043), and a record of files last written that cannot read as an entry another program
   removed (DESK-START-MSFS-052). A start made by either list's entry (`--background`) comes at any
   moment, an update's install included: the shell starts it in the tray (DESK-SHELL-CLI-005), does
   nothing when a copy runs (DESK-SHELL-CLI-017), and leaves it for the installer to start while an
   install is under way (DESK-SHELL-CLI-020). Only the installed program runs outside test mode
   (DESK-DIST-DEV-004), so every entry the app writes names the program that writes it. `--unregister`
   takes each file out of the record of files last written before removing its entry
   (DESK-START-UNREG-007), the one exception to the shell's rule that such a start writes only to
   `desktop.log` (DESK-SHELL-CLI-012). The uninstaller's last page reads `--unregister`'s exit codes 0 to
   3 (DESK-START-UNREG-006, used by DESK-DIST-UNINST-009).
3. **One note for app-shell** — the README tells a pilot who flies MSFS 2020 to have the app start with
   Windows, since Start with MSFS 2024 starts it with MSFS 2024 alone; starting with MSFS 2020 is
   deferred (DESK-START-MSFS-010). app-shell's LLD lists it among the README's contents (Docs This
   Segment Owns); no EARS spec carries the README.
4. **Platform behaviour not yet seen working** — both items and `--unregister` on the real files and keys;
   the Steam edition's `EXE.xml` folder and process name
   (from community sources only), and a start by the Store edition of MSFS (the folders, the lock,
   outliving MSFS; an open question in the desktop design, checked by hand before the first release).

## Work Required

### Must Fix
1. Try both items and `--unregister` by hand on the installed app: the real `EXE.xml` (a backup taken
   first), Windows' keys with Task Manager's Startup apps, and the uninstaller's last page.

### Should Fix
2. Confirm the Steam edition's folder and process name (LLD Open Question 1).
