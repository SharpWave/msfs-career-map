# Arrow: start-lists

Starting with MSFS and with Windows, one of the three parts of the desktop grouping: the `EXE.xml` editor
(MSFS 2024, Store and Steam) and its backups in Electron's folder, Windows' Run and StartupApproved keys,
the two tray items, and the start-list work `--unregister` does for the uninstaller.

## Status

**MAPPED** — LLD and EARS specs written 2026-10-23, before any code (greenfield), with the
intent-narrowing edge audit's findings for the desktop group applied; not yet audited against code. No
tests or code yet. Its one note for another segment, the README's advice for MSFS 2020, is in app-shell's
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
- docs/intent/desktop/start-lists/start-lists-specs.md — 76 specs (prefix `DESK-START`), none
  implemented, 1 deferred

### Tests
- None yet. Planned: tests/desktop/start-lists/ (Vitest unit tests of the `EXE.xml` editor against fixture
  files in temporary folders, the two tray items, and `--unregister`'s exit codes; the process list,
  Windows' known folders, both editions' folders, Electron's folder, `HKCU` and Electron's login item
  reached only through injected stand-ins, a test failing when it reaches a real one)

### Code
- None yet. Planned: the start-list code in src/desktop/

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
| Start with MSFS: editions, the item, the app's entry, the `EXE.xml` editor, backups, an entry another program removed | DESK-START-MSFS-001 to 055 | 0 | 1 | 54 |
| Start with Windows | DESK-START-WINDOWS-001 to 009 | 0 | 0 | 9 |
| Test mode and unit tests | DESK-START-TEST-001 to 004 | 0 | 0 | 4 |
| Unregistering | DESK-START-UNREG-001 to 008 | 0 | 0 | 8 |

**Summary:** 0 of 76 specs implemented; 75 gaps; 1 deferred (DESK-START-MSFS-010, Starting with MSFS
2020). No tests yet.

## Key Findings

1. **Greenfield** — the LLD and specs exist; tests and code do not.
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
4. **Platform behaviour not yet seen working** — the Steam edition's `EXE.xml` folder and process name
   (from community sources only), and a start by the Store edition of MSFS (the folders, the lock,
   outliving MSFS; an open question in the desktop design, checked by hand before the first release).

## Work Required

### Must Fix
1. Review the LLD and specs together with the desktop shell's, which they build on.

### Should Fix
2. Build the `EXE.xml` editor and the Run and StartupApproved writer test-first against the fixtures,
   behind the injected stand-ins, on the desktop shell's tray and settings, which now exist
   (src/desktop/tray-model.ts, settings.ts, ports.ts).
