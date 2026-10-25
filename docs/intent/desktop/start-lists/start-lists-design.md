---
parent: desktop
prefix: DESK-START
---

# Start Lists

## Context and Design Philosophy

Two lists outside the app can start it for the pilot: the sim's list of programs to start (`EXE.xml`),
read as MSFS starts, and Windows' per-user start-up list, read at sign-in. This design is how the app
uses them as the HLD's **A guest in the sim's house** asks
([Desktop › Tenets](../desktop-design.md#tenets)): the two settings that add the app to them, offered in
the tray menu ([Shell › The Tray](../shell/shell-design.md#the-tray)); the editor that adds and removes
the app's one entry; the backups taken before each change; and the clean-up `--unregister` does when the
app is uninstalled.

## Starting with MSFS

**Start with MSFS 2024** in the tray menu is off until the pilot turns it on. It starts the app with
MSFS 2024 only, and its name says so in every state: MSFS 2020 keeps an `EXE.xml` of its own that the
app does not edit (Open Questions & Future Decisions, Deferred 1), and a pilot who flies it has the app
start with Windows instead (Relies On). An entry of the app's counts as
on only when its `Disabled` and `ManualLoad` are both False, each trimmed of surrounding whitespace and
compared without regard to case. The item shows ticked while the app's entry is on in any `EXE.xml`
present. Turning it on writes the entry to the `EXE.xml` of every edition installed that lacks it or
holds it turned off or altered; turning it off removes it from every `EXE.xml` present that has it.

**Where.** Each edition keeps its `UserCfg.opt` and `EXE.xml` in one folder:

| MSFS 2024 | Folder of `UserCfg.opt` and `EXE.xml` |
|---|---|
| Microsoft Store / Xbox | `%LOCALAPPDATA%\Packages\Microsoft.Limitless_8wekyb3d8bbwe\LocalCache` |
| Steam | `%APPDATA%\Microsoft Flight Simulator 2024` |

An **edition installed** is one whose folder holds `UserCfg.opt`; turning the setting on writes only to
those. An **`EXE.xml` present** is one that exists in either folder, whether or not its edition is still
installed; the tick, turning the setting off and `--unregister` read and change those, so an entry the
app wrote is still removed after its edition is uninstalled and its folder left behind.

**The item.** Its state — the editions installed, the `EXE.xml` files present and the app's entries in
them, whether MSFS 2024 is running for this Windows account (`FlightSimulator2024.exe`) — is read when
the menu opens and again at the click, and the click acts on that fresh state. Its words, the first that
applies:

| When | The item |
|---|---|
| Unticked, and neither edition is installed | Cannot be clicked: "Start with MSFS 2024 (MSFS 2024 not found)" |
| MSFS 2024 is running | Cannot be clicked: "Start with MSFS 2024 (close MSFS to change)" |
| Unticked, and an `EXE.xml` cannot be read | "Start with MSFS 2024 (EXE.xml can't be read; see log)" |
| Unticked, and an edition the desktop shell last wrote the entry to no longer holds it | "Start with MSFS 2024 (removed by another program; click to add again)" |
| Unticked, and an `EXE.xml` holds the app's entry turned off | "Start with MSFS 2024 (turned off in EXE.xml)" |
| Otherwise | "Start with MSFS 2024" |

If MSFS 2024 is running by the time of the click, nothing is written and a message box says "Close
MSFS to change Start with MSFS 2024." MSFS reads the list only as it starts, so a change while it runs
gains nothing and only risks clashing with the sim or another add-on's installer.

**What the item's reads log.** Two things the item's reads find also go to `desktop.log`: why an
`EXE.xml` present cannot be read (it cannot be opened, does not parse, has the wrong root or an
encoding other than UTF-8 and windows-1252; one empty or holding only whitespace counts as read), and
that a file the desktop shell last wrote the entry to
no longer holds it (An entry another program removed, below). Each is written once each time that state
starts — at the first read since the desktop shell started that finds it, and again only after a read
that did not — never at every menu open, which would fill the log with copies of one line.

**The app's entry**:

```xml
  <Launch.Addon>
    <Name>MSFS Career Map</Name>
    <Disabled>False</Disabled>
    <ManualLoad>False</ManualLoad>
    <Path>C:\Users\<user>\AppData\Local\Programs\MSFS Career Map\MSFS Career Map.exe</Path>
    <CommandLine>--background</CommandLine>
  </Launch.Addon>
```

An entry is the app's when its `Name`, trimmed of surrounding whitespace, is "MSFS Career Map" without
regard to case, and its `Path`, as parsed and XML-unescaped, is the installed program, compared without
regard to case; the path is written XML-escaped. Any other entry, even one naming the same program,
belongs to someone else. The installed program's path does not change from one release to the next
([Desktop › Names and folders](../desktop-design.md#names-and-folders)); a release that cannot avoid
changing it also counts as the app's an entry whose `Name` is the app's, as above, and whose `Path` is
the earlier installed program's. The program never asks to run elevated, since MSFS does not start a
program that does.

Entries are compared as parsed, never by their bytes: an entry of the app's is **the same** as the entry
above when it holds those five elements and no others, in any order, each value trimmed of surrounding
whitespace and equal to the one above — `Path` compared as for telling the app's entry, False and True
without regard to case. Any other entry of the app's is **altered**.

**Turning it on**, for each `EXE.xml` of an edition installed:

1. With no `EXE.xml` in the folder, write a new one, put in place by step 7 like any other change, its
   re-read expecting still no file: UTF-8 without a byte-order mark, the XML declaration, and a
   `SimBase.Document` root with `Type="Launch"` and `version="1,0"` holding `Descr` "Launch",
   `Filename` "EXE.xml", `Disabled` "False", `Launch.ManualLoad` "False" and the app's entry. An
   `EXE.xml` that is empty or holds only whitespace is backed up (step 4) and then replaced the same way,
   its re-read expecting the bytes first read. The remaining steps apply to any other existing file.
2. Read the file with an XML parser. Leave it untouched, tell the pilot and log why, when it does not
   parse, its root is not `SimBase.Document` with `Type="Launch"`, its encoding is neither UTF-8 nor
   windows-1252, or the program's path cannot be written in that encoding.
3. With exactly one entry of the app's, turned on and the same as the entry above, write nothing.
4. Copy it into the `start-up list backups` folder in Electron's own folder
   ([Desktop › Names and folders](../desktop-design.md#names-and-folders)) as
   `EXE.xml.<Store|Steam>.<yyyyMMddTHHmmssZ>`, the time in UTC — a second backup of the same edition
   within one second adding `-2`, `-3`, … after the time — keeping the five newest for each edition,
   judged by the UTC time in the name and then the suffix, and deleting only older ones of the app's own.
   When the copy cannot be written, change nothing; the message box names the backup and the reason.
5. Insert the app's entry as text just before the root's closing tag, indented like the file's other
   entries and with the file's line endings, or inline when the file's entries share one line. An entry
   of the app's that is turned off or altered is instead rewritten in place as the entry above, and any
   entries of the app's beyond the first are removed as when turning it off. A self-closing root is
   rewritten as an opening and a closing tag around the entry, the only other change allowed. Every
   other byte stays as it was, the byte-order mark included or left out as found.
6. Parse the result. Unless it holds every other child of the root — elements, comments and any text
   but the whitespace between them — unchanged and in the same order, the app's entry exactly once and
   turned on, and the root unchanged but for a self-closing tag opened, write nothing and tell the
   pilot.
7. Write the result to `EXE.xml.msfs-career-map-tmp` in the same folder. Just before replacing, look at
   `EXE.xml` again and compare it with what the change began from — the bytes read at step 2, the empty
   or whitespace-only bytes of step 1, or no file: when they differ — the file changed, emptied or gone,
   or created where there was none — start the change again from its first step, with a fresh backup of
   a file then there, and after three changed reads write nothing and tell the pilot that another
   program is changing the file. Then rename the temporary file to `EXE.xml`, retrying every 250 ms for
   up to 3 s while Windows reports the file busy or access denied; if it still fails, delete the
   temporary file, leave `EXE.xml` as it was — no file, where there was none — and name the Windows
   error.

Every pass over the editions' folders — turning the setting on or off, past the check that MSFS 2024 is
not running, and `--unregister` — first deletes a temporary file of the app's that a change cut short
left in any of them, by a crash or by a Windows session end (the one quit that does not wait for a
change under way, Relies On), whether or not that folder's `EXE.xml` then needs a change, so a turn-off
or an uninstall that finds nothing to remove still leaves the sim's folder as the app found it.

**Turning it off**, for each `EXE.xml` present, follows step 2 — its check that the program's path can be
written in the file's encoding included — and steps 4 to 7 with the app's entries removed instead of
inserted: an entry whose lines hold nothing but it and whitespace is removed with those lines, and any
other only by its own bytes. Step 6 checks that every other child of the root is unchanged and in the
same order and that no entry of the app's remains. Every entry of the app's is removed, turned on or
not. Step 2 comes first: a file it refuses, by the path-encoding check as by any other, is left as it
was and reported whether or not an entry of the app's can be found in it (Decisions & Alternatives,
The path-encoding check when removing). With no file, one empty or holding only whitespace, or one step
2 accepts that holds no entry of the app's, nothing is written. Nothing else is removed, and the file is never deleted, even when no entry remains.

When a file cannot be changed, the others still are, and a message box names each file left as it was
and why; the item then shows the files as they are. The sim's folders only ever gain or lose the app's
one entry, and hold the temporary file only while it is written, or until the next pass deletes one a
change cut short left, by a crash or a Windows session end.

**An entry another program removed** — another add-on's installer rewriting `EXE.xml`, say — is never put
back by the desktop shell. Its settings ([Shell › Settings](../shell/shell-design.md#settings)) record
the files it last wrote the entry to, kept in an order that a change cut short can never turn into a
false report: turning the setting on adds each file once its write has succeeded, or at once when it
already held the entry as written, and leaves in the record only the files holding the app's entry
turned on once the change is done; turning it off takes each file out of the record before removing its
entry, and leaves the record empty; and `--unregister` takes each file out before removing its entry
(Unregistering). A record that named a file whose entry is gone would read as an entry another program
removed. When a file in the record no longer holds the
entry, the desktop shell writes that to `desktop.log` (What the item's reads log, above), and while the
item is unticked it says so (The item, above) until the pilot clicks it.

**After MSFS quits**, the app stays running in the tray.

## Starting with Windows

**Start with Windows** in the tray menu is off until the pilot turns it on. Windows keeps two per-user
keys for it: the start-up list itself (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`) and the
enabled mark that Task Manager's Startup apps sets
(`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run`). Before it changes
either key, the desktop shell exports both keys' values as one `.reg` file, `Run.<yyyyMMddTHHmmssZ>.reg`,
the time in UTC (`-2`, `-3`, … before `.reg` for a second export within one second), into the `start-up
list backups` folder in Electron's own folder, keeping the five newest, judged by the UTC time in the
name and then the suffix, and deleting only older exports of its own; when the export cannot be written, nothing changes, as for `EXE.xml` (Starting with MSFS,
step 4). When neither key would change — the app's value and its mark already as the action leaves
them — it writes nothing and takes no export. The item's state — the Run value and its StartupApproved
mark — is read when the menu opens and again at the click, and the click acts on that fresh state.

Turning it on writes, through Electron's login item, the value "MSFS Career Map" — named explicitly,
since Electron would otherwise name it after the AppUserModelID — holding the quoted installed program
with `--background`, and marks it enabled under StartupApproved, so a tick in the tray overrides an
earlier Disable in Task Manager. The item shows ticked while Windows will start the app at sign-in, so
turning it off in Task Manager shows here too. Turning it off, and uninstalling (`--unregister`), remove
the app's value from both keys and nothing else.

The app's value is the one named "MSFS Career Map", whatever it holds: the name is the app's alone
([Desktop › Names and folders](../desktop-design.md#names-and-folders)), so a value of that name counts
toward the tick, and turning the setting off or `--unregister` removes it even when it holds another
program's path.

## Test Mode

A copy in test mode ([Desktop › Test mode](../desktop-design.md#test-mode)) never reads or writes either
start list: its tray menu leaves out **Start with MSFS 2024** and **Start with Windows**, so a test run can
neither add the app's entry nor remove the installed app's. Only the installed program runs outside test
mode, so every entry the app writes names the program that writes it. A start with `--unregister` in
test mode does no start-list work either: it writes to no file but the test folder's `desktop.log` and
exits at once with 0, since a test copy, never adding an entry, can have none left behind.

## Unregistering

`--unregister` is how the uninstaller takes the app off both start lists
([Distribution › Installer and Uninstaller](../distribution/distribution-design.md#installer-and-uninstaller)).

**From `EXE.xml`**, uninstalling removes every entry of the app's from every `EXE.xml` present, by the
steps for turning Start with MSFS 2024 off (Starting with MSFS), through `--unregister` — while MSFS is
running too, since an entry left behind would point MSFS at a program that no longer exists. When
`--unregister` cannot remove the entry from a file or cannot check it for one — it cannot be opened,
does not parse, fails a check of those steps (the path-encoding check among them, whether or not an
entry of the app's is found in it), or stays busy — it leaves that file as it is, writes the file and
why to `desktop.log`, and counts it in its exit code as an `EXE.xml` that still holds the entry or
could not be checked; the uninstaller's last page then says where the entry named "MSFS Career Map"
can be deleted by hand
([Distribution › Installer and Uninstaller](../distribution/distribution-design.md#installer-and-uninstaller)).

Before it removes the entry from a file, `--unregister` takes that file out of the desktop shell's record
of the `EXE.xml` files it last wrote the entry to (An entry another program removed) — the one settings
write a `--unregister` start makes
([Shell › One Running Copy](../shell/shell-design.md#one-running-copy)) — so a reinstall never reads the
app's own clean-up, finished or cut short, as an entry another program removed.

**From Windows' start-up keys** it removes the app's value as Starting with Windows says.

`--unregister` never shows a message box: it writes each file's and value's outcome to `desktop.log` and
exits within 15 s. Its exit code says which start lists still hold the app's entry or could not be
checked for it:

| Exit code | Left behind |
|---|---|
| 0 | Nothing of the app's in either start list |
| 1 | An `EXE.xml` still holds the app's entry or could not be checked |
| 2 | Windows' start-up keys still hold the app's value or could not be checked |
| 3 | Both |

The same start also removes the app's notification registrations
([Shell › Notifications](../shell/shell-design.md#notifications)), and how it runs beside a copy already
running is in [Shell › One Running Copy](../shell/shell-design.md#one-running-copy). In test mode it
reaches neither start list and exits at once with 0 (Test Mode).

## Tests

Unit tests (`tests/desktop/start-lists/`, Vitest in Node, no Electron) cover the start lists. They reach
the process list, Windows' known folders (`%LOCALAPPDATA%`, `%APPDATA%`), both editions' folders,
Electron's own folder, the registry under `HKCU` and Electron's login item only through stand-ins the
tests inject — the editor working on temporary folders holding
the fixtures — and a test fails when it reaches a real one, a guard like the one that fails a test making
an outside request (app-shell), so `npm test` on the pilot's PC can never change the sim's real `EXE.xml`
or Windows' start-up keys, nor pass or fail with whatever runs there. They cover:

- the `EXE.xml` editor, against fixture files — one shaped like a real file with six other add-ons, with
  and without a byte-order mark, windows-1252, CRLF and LF, minified onto one line, empty or only
  whitespace, a self-closing root, no file at all, a malformed file, a wrong root, the app's entry
  already there (differently indented, with `false` in lower case, its elements reordered), there twice,
  turned off (`Disabled` or `ManualLoad` True) or altered (an element missing, added or changed), an
  entry naming the program under another name, entries added after the app's, an installed path holding
  `&` or `<`, a file changed, emptied or deleted between the read and the replace, a replace that finds
  the file busy, a temporary file left behind, one edition's file refused while the other's is changed,
  an `EXE.xml` holding the entry in a folder without `UserCfg.opt`, an entry whose `Name` differs in case
  or carries surrounding whitespace, a file whose encoding cannot hold the program's path when turning
  off, with an entry of the app's in it and with none, a new or emptied file changed or created before its rename, or whose rename fails, two backups of
  one edition within one second: turning on and off leaves every
  other byte as it was, repeats change nothing, refusals leave the file untouched, backups are named and
  pruned per edition in Electron's folder, and a backup that cannot be written stops the change;
- the Start with MSFS 2024 item: its state read as the menu opens and again at the click, the click acting on
  the fresh state, each of its words, what its reads log and how often, the record of files last written
  brought up to date, and an entry another program removed never put back;
- Start with Windows: the Run and StartupApproved values written, read and removed, a value named "MSFS
  Career Map" holding another program, nothing else in either key touched, the export named, pruned and
  taken only when a key will change, and the state read again at the click, the click acting on it;
- the backups' names in UTC and the five newest kept by the time in the name, a suffix within one
  second included; a temporary file left by a change cut short deleted by a turn-off or `--unregister` that finds
  no entry to remove; the record of files last written taken out before an entry is removed and added
  to after a write succeeds, with a change cut short at each step;
- `--unregister`: its exit codes 0 to 3, the files it takes out of the record of files last written, its
  start in test mode, and its 15 s bound.

The packaged smoke test's check that a run in test mode leaves the start lists untouched is in
[Distribution › Tests](../distribution/distribution-design.md#tests).

## Relies On

What the start lists need from other segments, recorded here as a cascade note:

**app-shell**:

- The README tells a pilot who flies MSFS 2020 to have the app start with Windows, since Start with
  MSFS 2024 starts it with MSFS 2024 alone (Starting with MSFS; app-shell's Docs This Segment Owns,
  which no EARS spec carries).

From the desktop shell, its sibling ([Shell](../shell/shell-design.md)), it builds on:

- the tray menu that offers its two items (DESK-SHELL-TRAY-015) and ignores a click on them while the
  desktop shell is quitting (DESK-SHELL-QUIT-003);
- the settings that record the `EXE.xml` files last written (DESK-SHELL-SET-001; which a `--unregister`
  start also writes, for that record alone, DESK-SHELL-CLI-012), and `desktop.log`
  (DESK-SHELL-LOG-003);
- the command line that runs `--unregister` before the single-instance lock (DESK-SHELL-CLI-009);
- a start made by the app's entry in either list (`--background`) handled whenever it comes — MSFS can
  start the app at any moment, while an update installs included: in the tray with the window closed
  (DESK-SHELL-CLI-005), doing nothing more when a copy already runs (DESK-SHELL-CLI-017), and, while an
  install is under way, started again once the install is done (DESK-SHELL-CLI-020);
- every quit but a Windows session end — Quit, `--quit` handed over by the installer, **Restart to
  update**, an update installed at a quiet moment — letting a start-list change already under way
  finish within its own bounds (at most three changed reads and 3 s of rename retries, Starting with
  MSFS, step 7) before it shuts the server down, writing that change's outcome to `desktop.log` and
  opening no message box for it, since entering the quitting state closed them all
  (DESK-SHELL-QUIT-012). A change a session end cuts short leaves at most the temporary file, which
  the next pass over the editions' folders deletes, and a record of files last written that never reads
  as an entry another program removed (DESK-START-MSFS-043, DESK-START-MSFS-052).

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| Where the desktop settings are | The tray menu | The page, through a bridge; an options window | Starting with MSFS or Windows is something only the desktop shell can do; the tray needs neither a bridge nor a second window. |
| Editing `EXE.xml` | Parse to check, insert or remove the app's entry as text, parse the result, read the file again and replace it in one step | Rewriting through an XML document model; appending text without parsing; restoring the backup when turning off | Every other byte of a file other add-ons share stays as it was. A document-model rewrite reformats their entries; unparsed text cannot tell a broken file; restoring a backup drops entries added since. Reading again just before the replace keeps another program's write from being lost. |
| Where `EXE.xml` backups go | Electron's own folder, five per edition | Beside `EXE.xml` in the sim's folder | The sim's folder then only ever gains or loses the app's one entry, as a guest's should, and nothing the app leaves there outlives an uninstall; the uninstaller's last page names the folder that holds them. |
| Which `EXE.xml` | Turning on: every MSFS 2024 edition installed, found by its `UserCfg.opt`; the tick, turning off and uninstalling: every `EXE.xml` present in either edition's folder | Asking which; the first found; any edition folder that exists; the editions installed for every change | The pilot asked for MSFS to start the app, whichever edition they fly; an edition's folder can exist without that edition installed. An entry the app wrote must still be removable once its edition is uninstalled and its folder left behind. |
| Start lists while MSFS runs | The setting waits for MSFS to close; uninstalling removes the entry anyway | Changing at any time; the uninstaller waiting for MSFS to close | MSFS reads the list only as it starts, so a change while it runs gains nothing and risks a clash. An entry left by an uninstall would point MSFS at a missing program. |
| The item's name | "Start with MSFS 2024" in every state | "Start with MSFS" | MSFS 2020 keeps an `EXE.xml` of its own that the app does not edit. A plain "Start with MSFS", shown ticked, would tell a pilot who also flies MSFS 2020 that the app starts with it; launching MSFS 2020 would start nothing, and with Start with Windows off that session would go unrecorded. |
| Start with MSFS 2024 on for one edition only | Shown ticked while any `EXE.xml` holds the entry turned on; turning it on or off changes every file that can be changed | Ticked only while every file holds it | With one file refused, a tick that needs both would offer only "turn on", and the entry already written could never be removed from the tray. |
| An entry another program removed | Never put back; the item says so until the pilot clicks it | Putting it back at each start | The start lists change only when the pilot asks. Another add-on's installer that rewrote the file may have had its reasons, and writing the entry back at every start would fight it. |
| The record of files last written | Turning on adds a file once its write has succeeded; turning off and `--unregister` take a file out before removing its entry | Bringing the record up to date once the whole change is done | A change cut short between removing an entry and updating the record — by a crash or a Windows session end — would leave the record naming a file whose entry is gone, and the item would then say another program removed it. In this order a change cut short can at worst miss a later removal by another program, never report a false one. |
| A temporary file left in the sim's folder | Deleted by every pass over the editions' folders — turning on, turning off and `--unregister` — whether or not that folder's `EXE.xml` then changes | Deleted only when a change of that file begins | A turn-off or an uninstall that finds no entry to remove begins no change, so a temporary file a change cut short left would outlive the uninstall in the sim's folder. |
| An `EXE.xml` that cannot be read at uninstall | Left as it is; `--unregister` reports an `EXE.xml` that still holds the entry or could not be checked, and the uninstaller's last page sends the pilot to remove it by hand | Removing the entry as text anyway; restoring the app's last backup | A file the app cannot parse is one it cannot prove it changed safely, and an edit risks every other add-on listed there; a stale entry only fails to start a missing program. Restoring a backup would drop entries added since. |
| The path-encoding check when removing | Made when turning off and at `--unregister` as when turning on: a file whose encoding cannot hold the program's path is left as it is and reported — in the message box, or in `--unregister`'s exit code as an `EXE.xml` that could not be checked — whether or not an entry of the app's is found in it | Checking only when adding, since removing writes no path; checking only a file found to hold an entry of the app's | Such a file cannot hold the app's entry as the app writes it, yet another program that rewrote it in that encoding may have kept the entry with its path's characters lost, where the app no longer recognises it as its own. The app cannot prove such a file holds none of its entries, so it reports the file and the pilot looks there for an entry named "MSFS Career Map". Checking only a file found to hold an entry would pass over just the file where such an entry hides. A file that holds none is reported too, at the cost of a message box, or a line on the uninstaller's last page, that leads to nothing to remove. |
| The uninstaller's start-list cleanup | The program's own `--unregister`, bounded in time | Editing XML and the registry in NSIS | One tested implementation of the editing rules serves both the setting and the uninstall. The time bound keeps a failing cleanup from holding up the uninstall. |
| `--unregister`'s exit code | 0 to 3: 1 for an `EXE.xml`, 2 for Windows' start-up keys, 3 for both, each when that list still holds the app's entry or could not be checked | A code for each combination of the Store `EXE.xml`, the Steam `EXE.xml` and the keys | The uninstaller needs only which list to send the pilot to; `desktop.log` names each file and why. A list that could not be checked may still hold the entry, so it is reported as one that does. |
| Starting with Windows | Electron's login item in the per-user Run list, named "MSFS Career Map", with `--background`, marked enabled under StartupApproved | A Startup-folder shortcut; a scheduled task | The usual place for a per-user program, shown and switchable in Task Manager's Startup apps. Writing the enabled mark makes a tick in the tray mean what it says after a Disable in Task Manager. |
| Which Run value is the app's | The value named "MSFS Career Map", whatever it holds | Only one holding the installed program, as for `EXE.xml` | A value's name is unique in its key and this name is the app's, which never changes, so no other program's value can share it; a value left by an earlier or moved install is still taken away. `EXE.xml` differs: any number of entries may share a name there. |
| Names of the start-up list backups | UTC to the second, ending in `Z` — `EXE.xml.<Store\|Steam>.<yyyyMMddTHHmmssZ>`, `Run.<yyyyMMddTHHmmssZ>.reg` — with `-2`, `-3`, … for a second one within the same second; "newest" judged by the time in the name | Local time; a counter alone; the file's own write time | After the clocks go back, or the PC's time zone moves west, a local-time name sorts the latest backup before older ones, and keeping five would delete the copy a pilot would restore. A name's time survives copying, where a file's write time may not, and it is the order the logbook's own backups follow. The `Z` tells a pilot choosing a file by hand that the time is UTC. The suffix keeps a quick off-and-on from overwriting the backup taken a moment before. |

## Open Questions & Future Decisions

### Open

1. **The Steam edition** — its `EXE.xml` folder comes from community sources only, and its process
   name is taken to be `FlightSimulator2024.exe` like the Store edition's; both to confirm on a Steam
   install.

### Deferred

1. **Starting with MSFS 2020**, which keeps its own `EXE.xml`.

## References

- Parent: [Desktop](../desktop-design.md) — the tenets, names and folders (the entries' name, Electron's
  own folder), test mode (only the installed program running outside it)
- HLD: [docs/high-level-design.md](../../../high-level-design.md) — the tenet A guest in the sim's
  house, and the decision Starting with the sim
- Siblings: [Shell](../shell/shell-design.md) (the tray menu, its settings, `desktop.log`, the command
  line, quitting), [Distribution](../distribution/distribution-design.md) (the uninstaller that runs
  `--unregister`)
- Code (planned): the start-list code in `src/desktop/`, its tests and `EXE.xml` fixtures in
  `tests/desktop/start-lists/`
- External: Electron (login items), MSFS `EXE.xml` as documented by FSUIPC and the add-on community,
  Windows' Run and StartupApproved registry keys
