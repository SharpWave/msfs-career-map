---
parent: desktop
prefix: DESK-SHELL
---

# Desktop Shell

## Context and Design Philosophy

The desktop shell is Electron's main process ([Desktop › Context](../desktop-design.md#context)). This
design is what it does while the app runs: it starts the server and keeps it running, decides when the
logbook is backed up, shows the page in the window, keeps the tray icon, keeps one copy running and acts
on its command line, hears Windows sign-out, shows notifications, and finds and installs updates.
Starting it with MSFS or Windows belongs to [Start lists](../start-lists/start-lists-design.md), and
building, installing and releasing it to [Distribution](../distribution/distribution-design.md).

The desktop design's tenets decide most of it ([Desktop › Tenets](../desktop-design.md#tenets)): never
lose a flight, and stay out of the pilot's way — never bringing the window forward or asking anything
the pilot did not prompt, and holding updates and keeping notifications silent while
[the sim is in use](../desktop-design.md#the-sim-is-in-use).

## Processes

The processes and who talks to whom are the desktop design's
([Desktop › Processes](../desktop-design.md#processes)); this is the desktop shell's side.

**The desktop shell's own errors.** The desktop shell handles uncaught exceptions and unhandled
rejections in its process itself: the error goes to `desktop.log`, Electron's error box never shows, and
the desktop shell keeps running. If its process crashes outright, the app and its server end and the
tracker's last checkpoint holds the leg; nothing starts the app again until the pilot, MSFS or Windows
sign-in next starts it.

### Starting the server

The copy holding the single-instance lock (One Running Copy) starts the server once Electron is ready:
outside test mode as soon as its look for a copy run from source has ended — at most 500 ms (First Run)
— so the first server is already offered the folder that look found; in test mode at once. At that start
and every later one it passes the server these inputs as start-up arguments:

- the data folder, the program folder (the built page and the seed airport lists), the port, the backups
  folder, the sim (the sim link or the fake feed) and whether airport downloads are on (airports'
  monthly refresh of the airport lists and any download at start, APT-DATA-020), as app-shell's
  start-up arguments (APP-SRV-006), with the values
  [Desktop › Test mode](../desktop-design.md#test-mode) gives an installed copy — downloads on — and a
  copy in test mode — downloads off, so the lists its folder was seeded with are never replaced;
  an installed copy's backups argument names Windows' Documents known folder and the path
  `MSFS Career Map\Backups` under it, rather than a path, and the server looks Documents up at each
  backup (app-shell, APP-BAK-006), so a Documents folder that OneDrive or the pilot moves while the app runs is
  followed; in test mode the backups argument is a literal path;
- the logbook to offer: the data folder of a copy run from source, found or remembered (First Run);
  none in test mode;
- a **fresh run**: at each server start of a run until one server of that run has done its start-up
  work (Ready), an argument telling the tracker to start with casual mode off whatever its checkpoint
  holds (app-shell's `--fresh-run`, APP-SRV-011; live-tracking, LIVE-CASUAL-015). Later starts in the run — after a crash, a requested restart, an update that
  went no further — leave it out, so casual mode survives them. Casual mode thus ends with every run of
  the app however the last run ended, including a Windows session end, which can cut short the
  shutdown that would otherwise switch it off, and a crash of the desktop shell, which ends the server
  with no shutdown at all (Shutting the server down).

The address is always 127.0.0.1. The version is built into the server bundle
([Distribution › Packaging](../distribution/distribution-design.md#packaging)), so it is not an input. At
every start the desktop shell writes to `desktop.log` the data folder and the backups folder as
Documents resolves at that moment. The desktop shell looks Documents up as the server does at each
backup, from the user's `Personal` value under `User Shell Folders` in the registry, never from
Electron's own Documents path, which keeps its first answer for the run; so the folder it names — here
and in the tray's **Open backups folder** (The Tray) — is always the one the server backs up into.

The installed app's data folder (`%LOCALAPPDATA%\MSFS Career Map`), Electron's own folder
(`%APPDATA%\MSFS Career Map`) and port 3380 never change from one release to the next
([Desktop › Names and folders](../desktop-design.md#names-and-folders)): the logbook, the single-instance
lock, the settings and the page's remembered choices, kept per origin, are found by them.

**Environment.** The server inherits Windows' environment — the path, the user's folders, the temp
folder — less the variables that set the server's behaviour when run from source (`PORT`, `CAREER_DB`,
`TRACKER`, `TRACKER_FAKE`, `SIMCONNECT_HOST`, `SIMCONNECT_PORT`; app-shell, APP-SRV-007; live-tracking,
LIVE-LINK-002, LIVE-LINK-013) and Node's and Electron's runtime switches (`NODE_OPTIONS`,
`ELECTRON_RUN_AS_NODE`). The bundled server reads none of them for its inputs (APP-SRV-006,
LIVE-LINK-012); leaving them out as well means the installed server links to the sim because its
start-up arguments say so (`--sim=link`), never because of anything left in the environment.

**Working folder**: the data folder, so a `SimConnect.cfg` the sim link would read is one placed there
on purpose, never one lying in whatever folder the app was started from.

### Ready

The server is **ready** when `http://127.0.0.1:<port>/api/status` answers naming this app and the
process id of the utility process this desktop shell started (app-shell, APP-API-004). The desktop shell asks every
250 ms from the start until the server's start-up work is done (below). Only the wait for the first ready
answer is bounded, by 60 s (Keeping the server running); from readiness on, a slow or missed answer to
these asks is no failure, and only the checks for a server that stops answering judge whether it still
works. Any other answer during the wait for readiness — another server of this app among them, whatever
its version — means the port is held (A held port, below) and never counts as readiness.

A ready server may still be opening the logbook, backing it up, upgrading it or bringing one in, work
that grows with the logbook. `/api/status` names the step it is on and says outright when the work is
done; until then the server serves the page's own files but answers 503 on every API route other than
`/api/status` (app-shell, APP-SRV-009). The desktop shell counts the work done only when the status says so, never
from a status that names no step. Meanwhile the tray's status line names the step — "Starting…
(opening the logbook)", "Starting… (backing up the logbook)", "Starting… (upgrading the logbook)" or
"Starting… (bringing in the logbook)" — and the window keeps the start screen. Once the server's
**start-up work is done**, the window loads the page and the desktop shell subscribes to the event
stream.

### Talking to the server

The desktop shell reads `GET /api/tracker` and subscribes to the tracker's event stream
`/api/tracker/events` once the server's start-up work is done, and again after every restart and
**Try again**. Whenever its subscription ends while its server's process runs and it is not quitting —
the server closed its streams, a socket was reset — it subscribes again, reading `GET /api/tracker`
first: 2 s after the stream ended, then, while attempts keep failing, after twice the last wait, up to
30 s; a resume that finds the stream ended subscribes again at once (Sleep and the clock). Until a
subscription succeeds the tray keeps the last status received. The private channel
([Desktop › Processes](../desktop-design.md#processes)) carries three requests, each answer repeating
the request's id (app-shell's messages, APP-SRV-022):

| Request | Sent | The server answers |
|---|---|---|
| Back up (`backup`), naming its kind: daily, before an update (with the version about to install), or at the installer's or uninstaller's `--quit` | As Backups says | `backup-progress` at least every 2 s while it copies; then `backup-done`, naming the backup file, or `backup-failed`, with a short reason naming no folder and a full one (APP-BAK-001, APP-BAK-008) |
| Save the tracker's state (`save`) | When Windows asks whether the session may end, and as the PC suspends | `saved`, once the state is written (APP-SRV-019) |
| Shut down (`shutdown`) | On quitting (Quitting) | Its process exits (APP-SRV-016) |

### Shutting the server down

Before quitting, updating, or at Windows sign-out, the desktop shell asks the server to shut down and
waits up to 10 s for its process to exit, twice the 5 s the server allows itself (app-shell, APP-SRV-016). The
request goes to any server process that exists, ready or not, and the server honours it at any point of
its start. The order in which the server shuts down is app-shell's and live-tracking's (APP-SRV-016,
LIVE-LINK-011, LIVE-SAVE-005); what the desktop shell relies on is that stopping the sim link never
reaches the tracker as a disconnect, so the state saved at shutdown is the tracker's state from before
the link stopped and the leg comes back as it was at the next start (Relies On). Shut down is sent only
when the app is set to quit — Quit, `--quit`, an update about to install, a session end — never to
restart a server, so the server switches casual mode off as it shuts down (LIVE-CASUAL-013). A server
that crashes or is ended leaves casual mode on for the next one (live-tracking, LIVE-CASUAL-011), and a
server shut down for an update that then goes no further starts again with casual mode off (Quitting).
A session end that ends the processes first can cut this order short, and a desktop shell that crashes
or is ended takes its server with it with no shutdown at all: Electron ends the utility process — on
Electron 45, within a second of a main process ended outright by `taskkill /F` or `process.kill` — and
the server cannot see the desktop shell end (app-shell). What that leaves is safe: the logbook's
write-ahead log keeps every committed write; the tracker's checkpoint, a few seconds old at most and
written at once at every change of leg (LIVE-SAVE-001), holds the leg; the next run's first server
start, telling the tracker to start with casual mode off (Starting the server; LIVE-CASUAL-015), ends
casual mode; and the data folder's lock left behind is stale and taken over (APP-DATA-008). A server
still running after 10 s is ended; the tracker's last checkpoint, a few seconds old at most, then holds
the leg.

### Quitting

Quit (once confirmed), `--quit`, **Restart to update**, an update installing by itself at a quiet
moment (Updates) and a session end each put the desktop shell into one **quitting** state. It lasts
until the app exits, except that an update that goes no further leaves it (below). Entering it closes
any message box of its own still open, each as if cancelled — Quit's confirmation among them — and
cancels any update check or download under way. A confirm dialog of the page's is left as the pilot
left it: it closes with the window when the app exits, and stays when an update goes no further. While
quitting:

- every tray item but **Open MSFS Career Map** and **Show log** is ignored, **Restart to update** and
  **Try again** among them. A later Quit or `--quit` is ignored too, except during an update —
  **Restart to update** or a quiet-moment install — when it is held. If the update goes no further, what
  is held is acted on once the app has left the quitting state: a held `--quit` is acted on and a held
  Quit dropped, since `--quit` already quits; a Quit held alone asks afresh about a leg in the air. If
  the update goes ahead, what is held is dropped, a held Quit then leaving the app stopped after a
  quiet-moment install rather than started again in the tray (Updates);
- no server is started again: a scheduled restart is cancelled, a server that exits is left ended, and
  the checks for a server that stops answering and the daily-backup check stop;
- a start-list change already under way
  ([Start lists › Starting with MSFS](../start-lists/start-lists-design.md#starting-with-msfs)) finishes,
  within its own bounds — at most three changed reads and 3 s of rename retries — before the server is
  shut down, so no change is cut short in the sim's folder or in the settings' record; its outcome goes
  to `desktop.log`, and no message box opens for it, since entering the quitting state closed them all;
- a session end abandons any backup still running, waits for no start-list change, sends Shut down at
  once and installs nothing, whichever quit was under way;
- a start handed over — with no switch, `--background` or `--updated`, a notification click counting as
  a start with no switch — is kept during a Quit until the desktop shell's last look for such starts,
  just before it exits or hands over to the installer: the app then installs nothing and, once it has
  exited, starts again with the command line, of those handed over, that shows the most (no switch, then
  `--updated`, then `--background`). During a **Restart to update** it is held: acted on if the restart
  goes no further, and otherwise dropped, since the installer starts the app again. During a
  quiet-moment install any but `--background` calls the install off, and a `--background` is dropped
  (Updates). During `--quit` or a session end it is written to `desktop.log` and dropped. When it is
  about to hand over to the installer, the desktop shell writes the install-under-way mark just before
  that last look (Updates), so a start made after it finds the install under way (One Running Copy),
  leaves its command line in the mark rather than handing it over, and is started by the installer once
  the install is done;
- a window opened meanwhile shows "Quitting MSFS Career Map…" rather than the start screen (The Window).

**Leaving the quitting state.** A **Restart to update** or a quiet-moment install that goes no further —
its backup failed or ran out of time, the sim came into use, the moment stopped being quiet, or the
installer could not be started (Updates) — leaves the quitting state, and the desktop shell takes up
where it was: the tray shows its status line again; the update timers, the daily-backup check and the
checks for a server that stops answering run again; every tray item and `--quit` are acted on again,
after what was held (a held `--quit` is acted on and a held Quit dropped, since `--quit` already quits;
a Quit held alone asks afresh about a leg in the air); and a window showing "Quitting MSFS Career Map…" goes on as on opening. A
server the desktop shell had given up on stays given up on, with **Try again** offered. Any other server
that is not running — one that exited by itself meanwhile, one whose scheduled restart entering the
quitting state cancelled, or one shut down for an install that went no further — is started again with
a fresh count of failures at start.

How each quit runs is in The Tray (Quit), One Running Copy (`--quit`), Updates (**Restart to update**
and the quiet-moment install) and Windows Sign-out and Shutdown.

### Backups

The desktop shell decides when the logbook is backed up and where; the server takes each backup into
the backups folder it was given, names it and prunes that folder (app-shell, APP-BAK-001, APP-BAK-004,
APP-BAK-007). The desktop shell asks for
a backup:

- **daily**: when its settings record no daily backup, or more than 24 hours have passed since the
  time of the last one they record, checked once the server's start-up work is done and every hour
  after; a recorded time later than the present counts as due;
- before an update installs, the request naming the version about to install (Updates);
- when the installer or uninstaller closes the app (`--quit`), the request marked as such.

Each request names its kind — daily, before an update, or at `--quit` — so the server can name, prune
and, for the backup before an update, place the backup as its kind asks (APP-BAK-004, APP-BAK-007,
APP-BAK-009; Relies On).

**A daily backup that fails** is written to `desktop.log` and counted in the settings among the daily
backups failed in a row, a count that a daily backup done clears, together with the record that their
notification has shown. After the first failure in a row it
is asked for again at the next hourly check; after any later one, not until 24 hours after that
attempt, so a cause that lasts — Windows' Controlled folder access refusing an unsigned program, a full
drive — is not met every hour, mid-flight included. From the third failure in a row the tray menu shows
"Backups failing: <short reason>" (The Tray), and one notification says so (Notifications).

**How long a backup may take.** Each backup the desktop shell asks for is bounded by 60 s without
progress — 60 s from the request, or from the server's last progress report — whatever the server is
doing, so a large logbook on a slow disk is not cut short while it is still being copied. A server
still starting, ready or not, takes it once its start-up work is done, inside the same bound
(app-shell, APP-BAK-005). A server waiting out a restart delay, or given up on, counts as no server: no backup is
asked for. A backup that fails, or reports no progress for 60 s, counts as failed; what follows is the
caller's (Updates, `--quit`), and the server deletes any unfinished file (app-shell, APP-BAK-003).

The server prunes only backups of the logbook it holds, by the logbook's id in each backup's name: it
keeps that logbook's seven newest daily backups and three newest others, and never prunes the pilot's
own **Back up now** copies or the newest backup taken before an upgrade (app-shell, APP-BAK-007). **Back up now** on
the page asks the server directly (APP-BAK-002), and the server backs the logbook up before any schema
upgrade (app-shell, APP-BAK-010).

### Keeping the server running

Once its start-up work is done, no feature of the server exits on purpose but one: to finish bringing in
a logbook, it exits with a code of its own that asks to be started again (app-shell, APP-SRV-015,
APP-IMP-003). Before that it exits by itself only when it cannot start: its port in use or refused, a
data folder or database it cannot use, a logbook it could not back up before upgrading it (app-shell,
APP-SRV-013, APP-SRV-014). Every other exit the desktop
shell did not ask for is a failure, at start or later.

**A requested restart.** A server that exits asking to be started again is started again at once, the
count of failures at start cleared and nothing counted against it — unless the desktop shell is
quitting, when it is left ended like any other. Once the new server's start-up work is done, an open
window loads the page again as on opening, since the logbook behind it has changed, and a daily backup
the exiting server had not finished is asked of the new one, inside a fresh bound; the one cut short
counts neither as failed nor among the daily backups failed in a row.

A **failure at start** is the server's process exiting within 60 s of being started or before its
start-up work is done, however long that work took, or not becoming ready within 60 s (it is then
ended). After a failure at start the desktop shell starts the server again — 1 s after the first in a
row, 5 s after the second — and after the third in a row it gives up. A server that exits later — past
its first 60 s, with its start-up work done — is started again after 1 s with the count cleared, however
often that happens: each new server restores the tracker's checkpoint, so tracking resumes within
seconds. A server that cannot start — a database it cannot open, a data folder it cannot write, a
logbook it could not back up before upgrading it — therefore stops with a reason instead of looping,
while a crash mid-session never ends tracking. A server still answering `/api/status` is never ended for
taking long over its start-up work.

**A server that stops answering.** From readiness on, start-up work included, the desktop shell asks
`/api/status` every 30 s, allowing 10 s for each answer. Three unanswered checks in a row — with nothing
received on the event stream in that time, once it is subscribed, the stream's keep-alive comments
counting since the desktop shell reads the raw stream — are a failure with the reason "The
server stopped responding": the server is ended and started again, the failure counted by the rules
above, so a hang during start-up work is a failure at start. The count of unanswered checks starts again
from zero after the PC resumes from sleep.

**A held port.** The server exits with one code when its port is in use and another when Windows refuses
it the port (app-shell, APP-SRV-013). When the server exits because its port is in use, or another server answers
during the readiness wait, the desktop shell ends its own server if that is still running, and asks the
port's `/api/status` who holds it. In the reasons below, `<port>` is the port the server was given.

| The port's holder | What the desktop shell does |
|---|---|
| This app's server on the same data folder, any version — one left behind by a desktop shell that ended suddenly | Waits up to 20 s for it to end. If it has not, and the process id it reported runs the desktop shell's own program file (as the server's utility process does), ends that process; a process id running anything else makes the holder another program (next rows). The attempt counts as a failure at start whether or not the leftover was ended, and the next start follows the usual delay after that wait, so a leftover that cannot be ended stops the retries after the third with "An earlier MSFS Career Map server is still running: quit MSFS Career Map, end any MSFS Career Map still listed in Task Manager, and start it again" |
| This app's server on another data folder | Gives up at once: "Port <port> is in use by MSFS Career Map in another Windows account, a test copy or a copy run from source" |
| Another program answering over HTTP | Gives up at once: "Port <port> is in use by another program" |
| Nothing that answers over HTTP | A failure at start like any other, retried; giving up reads "Port <port> is in use by another program" |

When Windows refuses the port, the desktop shell gives up at once with "Windows reserves port <port> (an
excluded port range); restarting Windows may free it", and writes Windows' excluded port ranges to
`desktop.log`.

While the server restarts, the tray's status line reads "Starting…". An open window keeps the page,
which opens its event stream again whenever it ends, reaching the new server at the same address, and
reloads what it shows on reconnecting (live-tracking, LIVE-API-005).

**The reason** for giving up is the first that applies: the desktop shell's own reason for the last
failure — a held or refused port, a leftover server, "The server stopped responding"; else the last error
line the server wrote (Logs); else "The server did not start within 60 s", as when each of the three failures
was a server that never became ready and wrote no error line.

When the desktop shell gives up:

- the tray icon shows the stopped state, with the status line "Not tracking: reason";
- a notification reads "MSFS Career Map stopped tracking" with that reason (Notifications);
- an open window shows the failure screen in place of the page (The Window);
- **Try again** in the tray starts the server with a fresh count; once its start-up work is done, an
  open window shows the page again.

Nothing in this brings the window forward.

### Sleep and the clock

The desktop shell measures every wait and interval of its own on a monotonic clock, so a change to the
system clock moves none of them: the readiness wait and its 250 ms asks, the 60 s that make an exit a
failure at start, the restart delays, the checks for a server that stops answering and the 10 s allowed
for each answer, the 20 s wait for a leftover server, the 10 s shutdown wait, the backup bound, the
hourly daily-backup check, the waits before subscribing to the event stream again, the 2 s allowed for
Quit's read of the tracker, the 10 s look at the process list (Staying Out of the Way), the update check
1 minute after start and every 4 hours, the 5 minutes a quiet moment must last and the hour it waits
after a failed backup before an update (Updates), the 500 ms look for a copy run from source, and the 5
minutes that count renderer losses. Only the 24 hours that
span runs — before a daily backup is due, and before a failing one is asked for again — are reckoned
from times kept in its settings (Backups).

As the PC suspends, the desktop shell asks the server to save the tracker's state. On resume it starts
any readiness wait and the count of unanswered checks again from zero, subscribes to the event stream
again at once if it ended, and runs the update check if one fell due. How the tracker treats the time
asleep is live-tracking's.

### Logs

The desktop shell writes two logs in the `logs` folder of Electron's own folder
(`%APPDATA%\MSFS Career Map\logs`), each line stamped with its time — an ISO UTC time, then a space,
then the line:

| Log | Holds |
|---|---|
| `server.log` | Everything the server writes to its output and error streams, captured through a pipe; each line from the error stream begins `[stderr] ` |
| `desktop.log` | The desktop shell's own events: the folders it resolved, server starts, exits, restarts and their reasons, readiness, held ports, failed backups, update steps, starts made while an install was under way, start-list changes and refusals, links sent to the browser, refused addresses, its own uncaught errors, lines it could not write |

The desktop shell keeps a running count of each log's size and, whenever a log passes 5 MB, renames it
`<name>.old.log`, replacing the previous one. It always reads the server's output and error streams to
the end, splitting them at line breaks: a partial line waits for the next chunk or for the process to
exit, and a line longer than 16 KB, counted in UTF-8 bytes, is cut at the last whole character within
that and ends with "…". Writing a log is best-effort: a line
that cannot be written — a full disk, a locked folder — is dropped and counted, and one line reports the
count once writing works again. Only the running copy writes `server.log` (One Running Copy). **Show
log** in the tray opens the folder.

The server's **last error line**, the reason the desktop shell gives when it gives up on a server and
has no reason of its own (Keeping the server running), is the last line of its error stream that is not blank, does
not start with whitespace — a stack line, a line of an error's fields — and is not one of Node's framing
lines: a lone bracket or brace, or the "Node.js vN" trailer Node writes after an uncaught error. So the
reason is the error's own message line, not the stack or the trailer beneath it.

### Settings

The desktop shell keeps its settings in one file in Electron's own folder:

| Setting | Used by |
|---|---|
| The time of the last daily backup | Backups |
| The daily backups failed in a row: their count, the time of the last attempt, the last failure's short reason — so the tray's "Backups failing" line has its reason in a later run too — and whether their notification has shown | Backups, The Tray, Notifications |
| The window's last place and size, and whether it was maximized | The Window |
| Whether the one-time notice has shown | The Tray |
| The versions whose update-ready notification has shown | Notifications |
| The version last handed to the installer, until the next start | Updates |
| The last data folder found for a copy run from source | First Run |
| The `EXE.xml` files it last wrote the app's entry to | [Start lists › Starting with MSFS](../start-lists/start-lists-design.md#starting-with-msfs); `--unregister` takes out each file it removes the entry from, just before removing it (One Running Copy) |

Settings are written to a temporary file and renamed into place. A settings file that cannot be read is
renamed with `.bad` added, written to `desktop.log` and replaced by defaults. Writing the settings and
the window's place is best-effort and never ends the desktop shell. Whether the app starts with MSFS or
with Windows is always read from the start lists themselves, never from the settings.

## The Window

**Opening.** The window opens on the start screen — "Starting MSFS Career Map…", packaged with the
desktop shell and needing no network — and loads the page from `http://127.0.0.1:<port>/` once the
server's start-up work is done (Ready). While the desktop shell has given up on the server, the window
shows the failure screen instead: "MSFS Career Map could not start its server", the reason, and "Choose
Try again or Show log in the tray icon's menu." While the desktop shell is quitting, a window that opens
shows "Quitting MSFS Career Map…", also packaged with the desktop shell, and loads no page, since no
start-up work is coming; a window already showing the page when quitting begins keeps it as it is.

**One address.** The window and every frame in it show only the page's own origin:

| The page asks for | What happens |
|---|---|
| A link or navigation to an address on its own origin (`127.0.0.1:<port>`) | Loads in the window |
| A link or navigation, in the window or a frame, to any other http or https address — a guard, since the page's own outside links all ask for a new window | Not loaded; the address opens in the pilot's default browser |
| A new window (`target="_blank"`, `window.open`) for another http or https address — SimBrief dispatch (PLAN-LIST-008) and PDF, a link inside a SimBrief plan (SB-CARD-009), Wikipedia, SkyVector, aviationweather.gov, an airport's own site (APT-POP-004, APT-POP-007), the map's attribution (MAP-VIEW-008) | No window opens in the app; the address opens in the default browser |
| A new window for an address on its own origin | Refused and logged; the page has no such link |
| Any other kind of address — a file dropped on the window, `file:`, `javascript:`, any other scheme | Refused and logged |

An address bound for the default browser is parsed first: only an http or https address with a host is
handed on, and only in its re-serialised form.

**What the page keeps.** The page's own requests are not filtered: map tiles from Esri and
OpenStreetMap, Wikimedia photos and aircraft icons from any http or https address (fleet, FLEET-REC-018)
load as they do in a browser tab. The window sends Chromium's referrer, which OpenStreetMap's tile servers require of a browser, and
Chromium's user agent with Electron's token replaced by the app's own,
`MSFSCareerMap/<version> (+https://github.com/SharpWave/msfs-career-map)` — the form the server's own
requests carry (app-shell, APP-API-005), naming the project, never a person, as the contact. The
page's confirm dialogs show as Windows message boxes and are never answered for the pilot — they guard
discarding a leg, switching to casual mode mid-leg, and deleting a hop, an aircraft or a SimBrief plan.
A right-click in a text field offers Cut, Copy, Paste and Select all, and on selected
text Copy; the usual editing keys work; F5 and Ctrl+R reload the page, which comes back with what the
server holds.

**Its settings**, stated outright rather than left to Electron's defaults: Node integration off, context
isolation on, Chromium's sandbox on, web security on, no preload script, `<webview>` attaches refused,
and insecure content refused.

Hardware acceleration stays on, as in a browser tab.

**What the window leaves out**: a menu bar; DevTools in a packaged build; spell-check underlines, which
would mark every airport code; permission prompts — any permission the page asks for (location,
camera, notifications) is refused, and the page asks for none; and any bridge between the page and the
desktop shell.

**When the page fails.** When a main-frame load of the page's own origin fails — no answer, or an
answer whose status is not 2xx, which Chromium does not report as a failed load: F5 while the server
restarts, a server that ends between readiness and the load — or the window's renderer goes away, the
window shows the start screen and loads the page again as on opening, the failure screen while the
desktop shell has given up, or the quitting screen, with no reload, while it is quitting. After two
renderer losses within 5 minutes it shows "The page stopped.
Close this window and open it again from the tray." and writes that to `desktop.log`. None of this brings
the window forward, and a loaded page whose event stream is only reconnecting is left alone.

**Size and place.** All sizes here are in Windows' scaled units. The window's smallest content size —
the area the page is drawn in, without the frame — is 800 × 600, the smallest the page is laid out for,
or less in either direction where the work area of the window's display leaves less room for it
(app-shell, APP-UI-041); it is worked out again when the window moves to another display or the display's scale
changes. The first time, the window opens at 1280 × 800, or the primary display's work area when that is
smaller, centred on the primary display. After that it opens at the place and size it was last closed
at — saved from its normal, not maximized, bounds — when its title bar, taken as the top 30 of those
bounds, lies inside one connected display's work area over its full height and at least 100 of its
width, with its size clamped to that work area; otherwise as the first time. A window last maximized
opens maximized on the display holding its saved place, or on the primary display. It never opens
minimized. Its title is the page's title, its icon the
app's, and its background the page's dark background, so it never flashes white while the page loads.

**Closing.** Closing the window — its close button, Alt+F4, the taskbar — closes only the window: the
page and its memory are discarded, and the server, the tracker and the tray icon keep running. Opening
it again loads the page fresh, and it comes back with what the server holds. Minimizing sends
the window to the taskbar as usual.

## The Tray

The running copy's tray icon is there from the moment it starts until it quits; a start that hands its
command line over, or starts with `--quit` or `--unregister`, shows none (One Running Copy).

**Status line.** Past the desktop shell's own states — quitting, starting, given up — the status line and
the icon's dot follow the last tracker status received, the sim link as the tracker reports it; the wider
"sim in use" ([Desktop › The sim is in use](../desktop-design.md#the-sim-is-in-use)) governs neither. The
first that applies:

| State | Status line |
|---|---|
| The app is quitting, for an update too | "Quitting…" |
| The server is starting or restarting | "Starting…", or with the step a ready server reports: "Starting… (opening the logbook)", "Starting… (backing up the logbook)", "Starting… (upgrading the logbook)", "Starting… (bringing in the logbook)" |
| The desktop shell has given up on the server | "Not tracking: reason" |
| Another copy holds the sim link | live-tracking's words for it (`link_holder`'s `text`, LIVE-API-013) |
| A leg is airborne or landed | The live card's word for the phase (LIVE-CARD-001) and the leg's origin, "Airborne from KBOS"; the word alone when the origin is unknown |
| Casual mode is on | "Casual mode: nothing is logged" |
| This copy's sim link is connected, the sim's menus included | "Connected to <the sim's name>" |
| Otherwise | "Sim not running" |

While legs wait, a second line reads "1 leg waiting to be logged" or "N legs waiting to be logged". The
icon's tooltip is "MSFS Career Map — " and the status line, cut to the 127 characters Windows keeps of a
tray tooltip, its last one "…", when longer — a long give-up reason, say; the menu's status line stays
whole.

**Icon.** The app's mark, with a small dot, the first that applies: red while the server is given up
on; none while the app is quitting or the server is starting or restarting; then, from the last tracker
status received and as on the live card (LIVE-CARD-001), blue while a leg is airborne or landed, violet in casual mode, amber
while legs wait, green while this copy's sim link is connected; no dot otherwise, another copy holding
the sim link included.

**Clicking.** A left-click opens the window. A right-click opens the menu:

1. **Open MSFS Career Map** — the default item.
2. The status line, the waiting-legs line and, from the third daily backup failed in a row, "Backups
   failing: <short reason>" (Backups), none of which can be clicked.
3. **Start with MSFS 2024** and **Start with Windows**, as
   [Start lists › Starting with MSFS](../start-lists/start-lists-design.md#starting-with-msfs) and
   [Starting with Windows](../start-lists/start-lists-design.md#starting-with-windows) describe them.
4. The version line, which cannot be clicked: "Version X" before the run's first update check, or
   "Version X — Y could not be installed" when this start found an installer that failed; then
   "Version X — up to date", "— checking for updates", "— Y found; downloads when the sim is not in
   use", "— downloading Y", "— download of Y failed", "— Y ready", "— Y waiting: backup failed (<short
   reason>)", "— Y could not be installed" or "— update check failed", as Updates says.
5. **Restart to update**, only while an update is ready. It cannot be clicked while the server is
   starting or restarting, nor while the sim is in use, when it reads "Restart to update (after the
   sim closes)". Beneath it, while the last backup taken for that update failed, **Restart to update
   without a backup**, which can be clicked when **Restart to update** can (Updates).
6. **Check for updates**.
7. **Open data folder**, **Open backups folder** (only once the folder exists, Documents looked up
   when the menu opens and again when clicked, from the registry as the server looks it up at each
   backup; Starting the server) and **Show log**.
8. **Try again**, only while the desktop shell has given up on the server.
9. **Quit**.

In test mode ([Desktop › Test mode](../desktop-design.md#test-mode)) the version line shows no update
state and the update items — **Restart to update**, **Restart to update without a backup** and **Check
for updates** — are left out; the start-list items are left
out as [Start lists › Test Mode](../start-lists/start-lists-design.md#test-mode) says.

**Quit**, in order:

1. The desktop shell reads `GET /api/tracker`, allowing 2 s, so a stream that ended unnoticed cannot
   leave it asking from a stale status. When that answer — or, with none, the last tracker status
   received in this run — has a leg airborne, a message box asks "A leg is in the air. Quit anyway?
   Nothing is recorded until MSFS Career Map starts again." with **Quit** and **Cancel**, Cancel being
   the default; Cancel changes nothing.
2. The desktop shell enters the quitting state (Quitting).
3. With an update ready, the backup before it (Updates).
4. The server shuts down (Shutting the server down).
5. The desktop shell exits, installing a ready update on the way out as Updates says, and the app does
   not start again unless a start was handed over meanwhile (Quitting) or made during the install, which
   the installer starts once it is done (One Running Copy).

**The one-time notice.** The first time the pilot closes the window (Closing, in The Window), as the
settings in Electron's own folder record it — once on this Windows account for the installed app, once
per folder in test mode — while the desktop shell is neither quitting nor given up on the server, a
notification reads "Still tracking in the tray" — "MSFS Career Map keeps running and logs your flights.
Quit it from the tray icon's menu, under ^ on the taskbar (Settings > Personalization > Taskbar > Other
system tray icons keeps it in view)." Windows 11 puts a newly installed program's tray icon among the
hidden icons, and no program can bring its own icon out, so the notice says where to find it. A close
that does not qualify — the window closing as the app exits, or while the server is given up on and
nothing is being logged — neither shows the notice nor records it. Once shown, it never shows again for
that folder.

## One Running Copy

One copy runs per Windows account, held by Electron's single-instance lock, which lives in Electron's own
folder — so a test-mode copy, with a folder of its own, is a separate copy. Before asking for the lock,
the desktop shell sets the data folder and Electron's own folder as literal paths — from `--test-data` in
test mode — never derived from the app's name
([Desktop › Names and folders](../desktop-design.md#names-and-folders)). A second start hands its command
line to the running copy and exits, except with `--unregister` (below).

| Command line | Started by | With no copy running | With a copy running |
|---|---|---|---|
| (none) | The Start menu, a shortcut, the installer's Launch | Starts with the window open | The running copy opens its window and brings it forward |
| `--background` | MSFS, through `EXE.xml`; Windows sign-in; the installer, relaunching the app after an update installed at a quiet moment | Starts in the tray, the window closed | Nothing happens |
| `--updated` | The installer, relaunching the app after **Restart to update** | Starts with the window open, unless MSFS — `FlightSimulator2024.exe` or `FlightSimulator.exe` — is running for this Windows account, when it starts in the tray | As with no switch, unless MSFS is running, when nothing happens |
| The switch Electron's notification activation adds | A notification clicked after the app has exited, or after its notification object is gone (Notifications) | Starts with the window open, the clicked hop or pending leg held for the first load of the page | The running copy acts on the click, its hop or pending leg carried with it (Notifications) |
| `--quit` | The installer and uninstaller | Exits at once, starting nothing | The running copy takes a backup (bounded as Backups says), shuts the server down and exits, asking nothing and never installing a ready update; it exits whether or not the backup succeeded, since the installer goes ahead either way and the new version backs the logbook up before upgrading it (app-shell) |
| `--unregister` | The uninstaller | Removes the app's entries from the start lists ([Start lists › Unregistering](../start-lists/start-lists-design.md#unregistering)) and its notification registrations (Notifications), and exits, starting nothing else | The same, done by the starting process itself without handing over |
| `--test-data=<folder>` | The packaged smoke test; desktop development | Starts in test mode ([Desktop › Test mode](../desktop-design.md#test-mode)) | Hands over to the test-mode copy using that folder |

`--test-data=<folder>` only chooses test mode and its folders, and so which copy is the running one.
Alone it acts as a start with no switch: that folder's copy starts with the window open or, already
running, opens its window and brings it forward. Beside another switch, that switch acts as the table
says, for that folder's copy; `--unregister` beside it reaches nothing past test mode's folders
(Notifications, [Start lists › Test Mode](../start-lists/start-lists-design.md#test-mode)).

A start that hands its command line over writes nothing: no log, settings, shortcut, tray icon or
window. A start with `--unregister` does its work before asking for the single-instance lock. A start
with `--quit` asks for the lock only to hand its command line over, and exits at once when it gets the
lock instead. Neither of these two ever does what the copy holding the lock does, even with no copy
running: each does only its own job, shows no tray icon or window, starts no server, runs none of the
start-up chores below, and writes to none of the desktop shell's settings or logs but `desktop.log`. The
one exception is `--unregister`'s, outside test mode: it also takes out of the record in the settings of
the `EXE.xml` files the desktop shell last wrote the app's entry to each file it removes the entry from,
just before removing it, so a later install never reads its own clean-up, finished or cut short, as the
entry removed by another program, and changes nothing else in the settings. What `--unregister` writes to `desktop.log`, how long it may take and how
it exits are in [Start lists › Unregistering](../start-lists/start-lists-design.md#unregistering).

The start-up chores run only in the copy that holds the lock: writing the notification registrations and
the ToastActivatorCLSID on the Start-menu shortcut (Notifications), looking for a copy run from source
(First Run) and the update timers, none of which a copy in test mode does
([Desktop › Test mode](../desktop-design.md#test-mode)), and the daily-backup check. A command line
handed over before that copy's tray icon exists, or before its window does when its own start opens one,
is acted on once they do.

The app acts on no other switch. Chromium and Electron still read their own switches on a fresh start,
and the inspect switches stay on (Fuses, in
[Distribution › Packaging](../distribution/distribution-design.md#packaging)). The start-list entries the
app writes carry only `--background`, and its shortcuts carry no switch.

**A start during an install.** Once the desktop shell has handed over to the installer — at the end of a
Quit, a **Restart to update** or a quiet-moment install — the app is gone for as long as the silent
install takes, and MSFS, Windows sign-in, a notification click or the pilot may start it meanwhile; an
installer the pilot runs by hand closes the app the same way. An old copy started then would be sent
`--quit` by the installer and left stopped, and a new one would read the install still running as an
installer that failed (Updates). So a start outside test mode — with no switch, `--background`,
`--updated` or a notification click — that finds an install under way takes no single-instance lock: it
writes that to `desktop.log`, leaves its command line in the install-under-way mark and exits at once,
and the installer starts the app with the command line that shows the most once the install is done;
should the mark have been taken up meanwhile, the start goes on as usual instead. What counts as an
install under way, and how a start leaves its command line in the mark without losing another's, are
distribution's
([Distribution › Installer and Uninstaller](../distribution/distribution-design.md#installer-and-uninstaller));
the desktop shell writes the mark just before it hands over (Updates), and the installer at the start
of an install the pilot runs. A start with `--quit` or `--unregister` does its own job as usual.

**Only the installed program runs outside test mode.** The desktop shell runs outside test mode only when
its own program path, fully resolved and compared without regard to case, is `MSFS Career Map.exe` in
`%LOCALAPPDATA%\Programs\MSFS Career Map`. Any other build — unpackaged (`npm run desktop`), or packaged
and run from anywhere else, as the smoke test's unpacked build is — started without `--test-data` writes
on the console it was started from that it runs only in test mode and exits, showing no message box,
setting neither folder, taking no single-instance lock and opening no logbook
([Distribution › Development](../distribution/distribution-design.md#development)). An installed copy and
a copy outside test mode are therefore one and the same.

## Staying Out of the Way

The desktop shell judges "the sim is in use", as the desktop design defines it
([Desktop › The sim is in use](../desktop-design.md#the-sim-is-in-use)), from the last tracker status
received — this copy's sim link connected, the sim's menus included, or another copy connected to the
sim — and from the process list, which it looks at every 10 s and again at each step that depends on it:
MSFS 2024 (`FlightSimulator2024.exe`) or MSFS 2020 (`FlightSimulator.exe`) running for this Windows
account counts whatever state the server is in, so a sim still loading before its link connects, or one
flown while the server restarts or is given up on, holds the rules below. Start with MSFS 2024 looks for
MSFS 2024 alone ([Start lists](../start-lists/start-lists-design.md#starting-with-msfs)); this check is
the desktop shell's own.

The rules:

- The window opens, is restored or is brought forward only on the pilot's own action: **Open** or a
  left-click in the tray, a start from the Start menu or a shortcut, the installer's **Launch**,
  **Restart to update** (unless MSFS has started meanwhile, `--updated`), or a notification clicked.
  Nothing else does it — not a start by MSFS or Windows, not a server restart or failure, not an
  update — whether the sim is in use or not.
- A message box appears only in answer to the pilot's own click: Quit with a leg in the air, a start list
  that cannot be changed ([Start lists](../start-lists/start-lists-design.md)), or one of the page's own
  confirm dialogs, after a click in the page.
- Notifications never take focus, and are silent while the sim is in use.
- While the sim is in use no update download starts, **Restart to update** cannot be clicked, no update
  installs by itself, and the update-ready notification waits (Updates).
- A failed server is restarted at once, whatever the sim is doing: a flight goes unrecorded while the
  server is down, and "Never lose a flight" ranks first. The restart takes no focus.

## Windows Sign-out and Shutdown

Windows tells a program that the session is ending only through the program's windows, and the main
window is usually closed. The session watcher — a hidden window created at start, never shown — is the
only window that listens, so the desktop shell acts on each event once.

When Windows asks whether the session may end — sign-out, restart, shutdown; the watcher's
`query-session-end` — the desktop shell asks the server, over the private channel, to save the tracker's
state now, and lets the session end go ahead. It changes nothing else, so a session end that is called
off leaves tracking as it was.

When the session ends (the watcher's `session-end`), the desktop shell enters the quitting state from
inside that handler — Electron otherwise exits at once when Windows ends the session — which closes any
message box and cancels any scheduled restart or update step (Quitting). It then sends the server Shut
down and exits once the server's process has ended, or after 10 s. A ready update is not installed then,
since a session end leaves no time to finish; it waits for the next Quit, **Restart to update** or quiet
moment (Updates). If Windows ends the processes first, the state saved at the query, or the tracker's last
checkpoint, holds the leg; casual mode, which that state may still hold on, is switched off by the next
run's first server start (Starting the server).

## First Run

When the data folder does not exist — the first start on this Windows account, or after the pilot
deleted it — the server creates it, brings in the seed airport lists from the program folder and
reports its progress, which the page shows (app-shell, APP-DATA-001, APP-API-010, APP-UI-031; airports,
APT-DATA-017). When the backups folder holds backups of other
logbooks that have hops — a data folder deleted, a new PC whose Documents folder came along, a Backups
folder that OneDrive keeps in step between two PCs — the page also offers, as the logbook to bring in,
the newest backup of each of those logbooks, told apart by the logbook id in their names, each named and
dated with its hop count and newest hop; the offer is worked out whenever the page asks, so the new
logbook's own first backups never take a place in it (app-shell, APP-IMP-001, APP-UI-039). A reinstall
finds the folder the uninstaller kept and opens that logbook. The desktop shell's part:

- The installer's **Launch** starts the app with the window open, so the pilot sees that progress.
- At every start of an installed copy holding the single-instance lock, before it first starts the
  server (Starting the server), the desktop shell looks for a copy run from source: a server
  answering `http://127.0.0.1:3080/api/status` — the port such a copy uses by default — within 500 ms,
  naming this app, its data folder and its sim. A copy on the fake feed is not a detection: it is a test
  run, usually against a copy of the logbook, while a copy not on the fake feed runs on the pilot's own
  logbook — its sim `link` or `off` in `/api/status` (APP-API-004), off unless started with
  `--sim=link` (APP-SRV-007) — and is a detection. The folder is accepted only when it is an absolute path on a drive letter
  Windows reports as a fixed drive (no network, removable, `\\` or device path), exists, and holds
  `career.db`. An answer without the app's name, folder and sim, from an older copy, is not a detection;
  the folder the pilot can type covers that copy. A copy in test mode never looks, and passes no logbook
  to offer.
- The desktop shell remembers the last folder it accepted in its settings and passes it to the server as
  the logbook to offer at every start, whether that copy still runs or not. At each start the remembered
  folder is checked again by the same rules, and dropped from the settings when it fails them.
- One 500 ms bound covers the whole look: the answer from port 3080 and every check of a folder, found
  or remembered, run at once, and the server is started when all have ended or 500 ms has passed. A found
  folder still being checked at 500 ms is neither offered nor remembered at that start (the next start
  finds it again); a remembered folder still being checked has not failed the rules, so it is kept and
  offered, as it was accepted when it was remembered.
- The offer, the copy and their rules — made only while the installed logbook has no hops, copied with
  SQLite's own backup, refused while the copy run from source still runs on that folder, with a folder
  the pilot can type instead — are app-shell's (APP-IMP-001 to APP-IMP-004, APP-UI-038 to APP-UI-040;
  Relies On). The desktop shell only passes the folder (`--offer`, APP-SRV-006).

## Notifications

| Event | Shown | Title | Text | A click opens |
|---|---|---|---|---|
| A new pending leg (`pending` on the event stream, LIVE-API-014) | While the window is not the foreground window | Leg waiting to be logged | The sim aircraft and the tracker's reason, as the tracker words it | The window, on that pending leg |
| A logged hop (`hop`) | While the window is not the foreground window | Hop logged | The tracker's message (LIVE-HOP-006), such as "Logged KBOS → KPVD, 45 min, 180 fpm butter" | The window, on that hop |
| An update ready | Once per version, as the settings record it, and only once the sim is not in use | Update ready | "Version Y installs when you quit MSFS Career Map or choose Restart to update in the tray, or by itself once MSFS and the MSFS Career Map window are closed." | The window |
| The pilot's first close of the window | Once per Electron folder, as its settings record it, as The Tray says | Still tracking in the tray | As in The Tray | The window |
| The desktop shell gave up on the server | At once | MSFS Career Map stopped tracking | The reason, and "Choose Try again or Show log in the tray icon's menu." | The window, on the failure screen |
| The third daily backup failed in a row | Once for that run of failures, as the settings record it, and only once the sim is not in use | Backups are failing | "MSFS Career Map could not back up the logbook to <backups folder>: <short reason>.", the server's short reason, which names no folder (APP-BAK-008) | The window |

The desktop shell writes only the titles and fixed sentences: airport codes, times, ratings and
reasons are the tracker's or the server's own words, so a notification and the page always agree. In
test mode
([Desktop › Test mode](../desktop-design.md#test-mode)),
notifications are written to `desktop.log` instead of being shown.

**Pending legs across restarts.** For the length of a run, the desktop shell remembers the ids of the
pending legs it has seen. Legs already waiting when it first subscribes bring no notification. On every
later subscription — after a server restart or **Try again**, or after a stream that ended (Talking to the
server) — it notifies for any pending leg it had not seen; a pending leg's id is never reused
(live-tracking, LIVE-HOP-003). A hop logged while it was not subscribed brings none: an open page reloads its map and
lists whenever its event stream reconnects (live-tracking, LIVE-API-005), so it shows the hop. When a pending leg leaves the
tracker's list — logged or discarded — the desktop shell removes its notification from the notification
centre if it is still there.

**Do Not Disturb.** No notification is marked urgent or tries to get past Do Not Disturb or Focus:
Windows decides when one shows, MSFS running full screen included, and missed ones wait in the
notification centre. The tray's red dot is no reliable fallback for a notification held back, since
Windows 11 keeps a newly installed program's tray icon among the hidden icons until the pilot brings it
out; the README says how to add the app to Windows' priority notifications and how to keep its tray icon
in view (app-shell's Docs This Segment Owns), and the one-time notice says where the icon is (The Tray).

**Opening a leg or hop.** A click opens the window, or brings it forward, and points the page at the
hop or pending leg through the fragment of its address — `#hop=<id>` or `#pending=<id>` — which the page
acts on when it loads and whenever the fragment changes, then clears, so a second click acts again
(app-shell, APP-UI-032 to APP-UI-035). A window already showing the page changes only the fragment, so nothing on the page reloads
or is lost. A window still on the start screen — the server's start-up work not yet done, as after a
start by a click — holds the hop or pending leg and makes it the fragment of its first load of the page,
so a click never loads the page into a server still starting. While the desktop shell is quitting, a
click is taken as a start with no switch handed over (Quitting), its hop or pending leg left out —
except during a quiet-moment install, which the click calls off while the app keeps running, so the
window then opens on that hop or pending leg (Updates).

**How clicks reach the app.** Windows routes a click on a notification through the app's Start-menu
shortcut, which must carry both the app's AppUserModelID — the appId, which the installer writes — and a
fixed ToastActivatorCLSID, the ID Windows uses to start the app for a notification click. At every start
of an installed copy holding the lock, the desktop shell sets both for itself, and writes the CLSID onto
the Start-menu shortcut when that shortcut exists without it. It never creates the shortcut: one the
pilot deleted stays deleted, as an install over an installed copy (an update, a repair or an older
installer) leaves the shortcuts as the pilot left them
([Distribution › Installer and Uninstaller](../distribution/distribution-design.md#installer-and-uninstaller)).
A copy in test mode does neither
([Desktop › Test mode](../desktop-design.md#test-mode)). A click that arrives after the notification's
own object is gone — from the notification centre, or after the app has restarted — is handled through
Electron's notification activation, and starts the app first when it is not running: the COM
registration starts the program with the switch Electron's notification activation adds, which the
command line takes as a click (One Running Copy). Which switch Electron 45 adds is still to be seen
(Open Questions).

**What notifications leave in the registry**: under `HKCU\Software\Classes`, the ToastActivatorCLSID's
COM registration, pointing at the program with the switch Electron's notification activation adds,
and any key Electron writes for the AppUserModelID. An
installed copy writes them again at each start; a copy in test mode never writes them, so a test build
cannot point the installed app's registration at itself. On a real uninstall, `--unregister` removes
exactly those keys and clears the app's notifications from the notification centre; an install over an
installed copy (an update, a repair or an older installer) skips this. Which keys Electron 45 writes is
still to be seen (Open Questions).

## Updates

The desktop shell updates the installed app with electron-updater from the project's public GitHub
Releases (`SharpWave/msfs-career-map`), with no token or key. It takes only published releases that
are not prereleases and are newer than the running version, and never goes back to an older one.

- **Checking**: 1 minute after start, then every 4 hours, and on **Check for updates**. Only an
  installed copy checks — never one in test mode, whose tray offers no update (The Tray). Until the
  run's first check starts, the version line reads "Version X" alone, or "— Y could not be installed"
  when this start found an installer that failed (When the installer fails below). No check starts
  while an update downloads or is ready: one that falls due then, and **Check for updates** chosen
  then, are skipped, the line still reading "— downloading Y", "— Y ready" or "— Y waiting: backup
  failed (<short reason>)", which already says what the app will act on; a newer release is found by
  the installed version's own first check. Each check replaces the update part of the line with "—
  checking for updates" and then with what it finds, whatever the line read before — a failed download
  or an installer that could not be started among them — while the full reason behind any state it
  replaces stays in `desktop.log`. An update downloaded in an earlier run reads "— Y ready"; one found
  reads as Downloading says: "— Y found; …" while it waits for the sim, "— downloading Y" once its
  download runs.
- **Downloading**: in the background, starting only while the sim is not in use; MSFS streams scenery
  while it flies, and the installer is expected to be over a hundred megabytes. An update found while
  the sim is in use starts downloading once it no longer is, the version line reading "— Y found;
  downloads when the sim is not in use" meanwhile, except while a check runs; a download already
  running when the sim comes into use finishes, the line reading "— downloading Y". A download that
  fails or is interrupted is discarded and written to `desktop.log`, the version line reads "— download
  of Y failed", and the next check tries again, still only with the sim not in use.
- **Ready**: an update is ready from the moment its download is done, or a check finds it already
  downloaded, until it installs, its installer cannot be started, or the run ends; electron-updater
  holds that one installer, and nothing downloads a newer one meanwhile. The version line reads "— Y
  ready", **Restart to update** appears, and the update-ready notification shows once the sim is not in
  use — once per version, as the settings record it, since electron-updater reports an update already
  downloaded again at each later run's check.
- **Installing.** electron-updater's own install on quit (`autoInstallOnAppQuit`) is off for the whole
  run: the desktop shell installs only by calling `quitAndInstall` itself, after the backup below, in
  one of three ways:
  - at the end of **Quit**: silently, and the app does not start again unless a start was handed over
    meanwhile (Quitting) or made during the install (One Running Copy);
  - on **Restart to update**, while it can be clicked (The Tray): the server shuts down, the update
    installs silently, and the installer starts the app again with `--updated`, its window open unless
    MSFS has started meanwhile (One Running Copy). After the backup, and again just before shutting the
    server down, it checks the sim: if the sim has come into use, the restart is dropped and leaves the
    quitting state (Quitting), the update stays ready, and the item reads "Restart to update (after the
    sim closes)";
  - **at a quiet moment**, by itself: as soon as, for 5 minutes unbroken, an update has been ready, the sim not
    in use — so no MSFS process runs for this Windows account — the window closed, no message box open,
    the server's start-up work done and its event stream subscribed, the last tracker status received
    showing no leg in progress (LIVE-SAVE-003) and casual mode off, no backup or start-list change
    running, and no backup before an update failed within the last hour (Backup first). Daily backups
    that fail do not hold it: the backup before an update falls back into the data folder when the
    backups folder refuses the app, so a pilot who never chooses Quit is still updated. The desktop shell
    then enters the quitting state, takes the backup, shuts the server down and installs silently, and
    the installer starts the app again with `--background`, so it comes back in the tray with its window
    closed. After the backup, again just before it shuts the server down, and again just before it hands
    over to the installer, it checks those conditions again; and the pilot opening the window, a start
    handed over other than `--background`, or a notification clicked calls the install off at once, the
    app then acting on it as it would at any other time — a click opening the window on its hop or
    pending leg. A `--background` handed over meanwhile is dropped: the installer starts the app with it anyway, or, the
    install going no further, the app is still running. An install called off goes no further and leaves
    the quitting state (Quitting), the update staying ready.

  The 5 minutes keep the app from vanishing under a pilot who closes MSFS to start it again or opens the
  window just after; casual mode must be off because a restart loses the path flown, which lives only in
  the server's memory. Just before its last look for starts handed over, the desktop shell writes the
  install-under-way mark in electron-updater's download folder, in the form distribution gives it,
  naming its own process and the start it asks the installer to make afterwards — `--updated` after
  **Restart to update**, `--background` after a quiet-moment install unless the pilot chose Quit during
  it, none after a Quit
  ([Distribution › Installer and Uninstaller](../distribution/distribution-design.md#installer-and-uninstaller)).
  A Quit held after the mark is written during a quiet-moment install adds to it a requested start of
  none, which takes the place of `--background`. A start made from then on meets the install under way
  (One Running Copy) and leaves its command line in the mark. When the install then goes no further — a
  start found at that last look, the install called off, the installer not started — the desktop shell
  takes the mark up as distribution says, renaming it aside before reading and deleting it, and takes
  each command line left in it as a start handed over at that moment. `--quit`, a session end, a crash and every other exit install
  nothing; an update downloaded but not installed is found again by the next run's check.
- **Backup first.** Before any of these, the desktop shell asks the server for a backup before an
  update, naming the version about to install, into the backups folder, bounded as Backups says; when
  the backups folder cannot be written, the server takes this backup into the data folder instead, named
  by that version (app-shell, APP-BAK-009), so a Documents folder that refuses the app never
  holds updates back for good. If the backup fails or runs out of time, the update is not installed:
  Quit goes ahead without it, **Restart to update** and a quiet-moment install go no further and leave
  the quitting state, the version line reads "— Y waiting: backup failed (<short reason>)" with the full
  reason in `desktop.log`, and the next Quit or **Restart to update** tries again, as does the next quiet
  moment an hour or more after the failure, so a cause that lasts is not met every 5 minutes. Meanwhile
  **Restart to update without a backup** (The Tray)
  lets the pilot install anyway: it runs as **Restart to update** does, without the backup. With no
  server to ask — one waiting out a restart delay, or given up on — no backup is taken and the update
  installs. Either way the new version backs the logbook up before upgrading it (app-shell, APP-BAK-010).
- **When the installer fails.** Before handing over to the installer, the desktop shell records the
  version it is installing in its settings. If the installer cannot be started, **Restart to update** or
  a quiet-moment install leaves the quitting state and starts the server again with a fresh count, not
  as a failure — unless the desktop shell had given up on it, when it stays given up on (Quitting) — and
  Quit exits without installing; either way the download is discarded, the record is cleared, the
  install-under-way mark is taken up as above and the version line reads "— Y could not be installed".
  Otherwise the first start after the handover that
  holds the single-instance lock — never one that hands its command line over, one that finds the
  install still under way (One Running Copy), nor one with `--quit` or `--unregister`, the installer's
  own `--quit` among them — compares its own version with the record and clears it: still below it — an
  installer that failed after the app had exited — it writes that to `desktop.log` and shows the same
  line from the start, until the run's first check replaces it (Checking). The next check finds Y again,
  and the next Quit tries again. Running the release's installer by hand repairs the install and leaves
  the data folder alone, as the README says (app-shell).
- **Casual mode** ends whenever the app quits for an update, as at every quit: the server switches it
  off at Shut down (Shutting the server down), and an update that then goes no further starts the server
  again with casual mode off.

## Tests

**Unit tests** (`tests/desktop/shell/`, Vitest in Node, no Electron) cover the desktop shell's own logic.
They reach the process list, the MSFS edition folders, Windows' known folders, the registry under
`HKCU`, shortcuts, Electron's own folder, `netsh` and any local port only through stand-ins the tests
inject, and a test fails when it reaches a real one — a guard like the one that fails a test making an
outside request (app-shell, APP-RUN-014) — so `npm test` on the pilot's PC can neither change the installed app's
registrations, its shortcut or the sim's `EXE.xml`, nor pass or fail with whatever runs there. They
cover:

- the address rules: what loads in the window, what goes to the default browser and in what form, what
  is refused, a new window on the page's own origin among them;
- the window's settings, read from the options it is created with;
- the window's place: a saved place used only when its title bar (the top 30 of its bounds) lies on one
  display over its full height and at least 100 of its width, its size clamped, a window last
  maximized, the smallest content size on a small work area;
- the window's screens: the start screen, the failure screen, the quitting screen for a window opened
  while quitting, and a main-frame answer of the page's own origin whose status is not 2xx taken as a
  failed load;
- keeping the server running: failures at start, start-up work past 60 s, the waits, giving up after
  the third, a server that exits after its first 60 s always started again, a server that exits asking
  to be started again restarted at once with no failure counted and a daily backup it cut short asked
  again of the new server, not counted as failed, readiness only from the desktop
  shell's own server, start-up work done only when the status says so, each kind of held port with its
  reason naming the port given, a leftover ended only when its process runs the desktop shell's own
  program, a server that stops answering during and after its start-up work, the event stream's
  keep-alive counting as a message, Shut down sent to a server not yet ready, the give-up reason taken
  in its order with "The server did not start within 60 s" when no other applies;
- the event stream: subscribing again whenever it ends while the server runs, after waits from 2 s
  doubling to 30 s, and the tray keeping the last status meanwhile;
- the quitting state: tray items and later quits ignored, a Quit or `--quit` during an update held and
  then acted on or dropped (a held `--quit` acted on and a held Quit dropped beside it), no server
  restarted, a start-list change under way finished before the server shuts down except at a session
  end, its outcome logged with no message box, a session end during another quit, starts handed over
  during Quit kept up to the last look and the one that shows the most started, a start held during
  **Restart to update** and dropped during `--quit` and a session end, each way an update that goes no
  further leaves the state, and then a server given up on staying so while any other not running starts
  again with a fresh count;
- the waits across a suspend and resume, and across a change to the system clock;
- the command line: what each switch does with and without a copy running, `--test-data` alone and
  beside each other switch, `--updated` with MSFS 2024 or MSFS 2020 running, a start by a notification
  click with and without a copy running, a start that finds an install under way (its line appended,
  never creating the mark, and its second look finding the mark taken up meanwhile), a start that hands
  over writing nothing, `--unregister` and `--quit` writing only `desktop.log` but for the `EXE.xml`
  files `--unregister` clears from the settings' record, a command line handed over before the tray icon
  or the window exists, `--quit` never installing a ready update;
- the logs: rotation by running size, lines split across chunks, a partial line at exit, a line over
  16 KB, lines dropped and counted;
- the settings: written through a temporary file, an unreadable file set aside;
- the backups: each Back up request naming its kind, the backup before an update with the version about
  to install; the daily backup due with no recorded time or a recorded time in the future, a failing
  daily backup asked for again after an hour and then after 24 hours, the tray line and the one
  notification from the third failure in a row, both cleared by a daily backup done, and the bound of 60 s without progress with the server
  ready, in its start-up work, waiting out a restart delay or given up on;
- "the sim is in use"
  ([Desktop › The sim is in use](../desktop-design.md#the-sim-is-in-use)) in each of its three cases, an
  MSFS 2024 or MSFS 2020 process counting whatever state the server is in;
- the tray's status line and dot from tracker statuses, another copy holding the sim link among them,
  no dot while quitting or starting, and Quit's question asked from a fresh read of the tracker, or from
  the last status received when that read gets no answer;
- the one-time notice shown and recorded only for the pilot's own close, never while quitting or with
  the server given up on;
- notification text from tracker events, none for legs waiting at the first subscription, one for a
  pending leg first seen on any later subscription, a notification removed when its leg leaves the
  list, the update-ready notification once per version, and a click's hop or pending leg held for the
  first load of the page;
- the update rules: when it downloads, an update found while the sim is in use, a failed or
  interrupted download, when **Restart to update** and **Restart to update without a backup** can be
  clicked, when the notification shows, a failed backup holding the install, the sim coming into use
  during **Restart to update**, the quiet moment — each of its conditions, its 5 minutes, the hour it
  waits after a failed backup before an update while failed daily backups hold nothing, the checks again
  after the backup, before the server shuts down and before the handover, what calls it off and a
  `--background` dropped, a click that calls it off opening its hop or pending leg — the
  install-under-way mark written before the last look, naming the start asked for, a requested start of
  none added for a Quit held after it is written, and taken up, renamed aside first, when the install
  goes no further,
  no exit but Quit, **Restart to update** and a quiet-moment install installing, an installer that
  cannot be started, the recorded version checked and cleared at the next start holding the lock, and
  the version line before the first check (with and without a failed install found at start), while an
  update found waits for the sim, and as each check replaces it, with no check started while a download
  runs or an update is ready and a check that ends with a download running reading "— downloading Y";
- the look for a copy run from source: a copy on the fake feed no detection, a copy with its sim off a
  detection, and the remembered folder checked again at each start;
- the server's inputs for each mode — the folders, the backups argument naming the Documents known folder
  or a literal path, the port, the sim, airport downloads on or off — the fresh-run argument on a run's
  server starts until one has done its start-up work, a failed first start retried with it, and on none
  after, and its environment, and no notification registration in test mode.

The packaged smoke test runs this behaviour end to end in the packaged app
([Distribution › Tests](../distribution/distribution-design.md#tests)).

## Relies On

What the desktop shell needs from other segments, recorded here as cascade notes; each segment's own
design and specs say how.

What the desktop parts share from other segments is in
[Desktop › Relies On](../desktop-design.md#relies-on).

**app-shell** (the foundation):

- The server takes its inputs explicitly — data folder, program folder, port, backups folder, sim,
  whether airport downloads are on, logbook to offer, and the fresh-run argument it hands to the tracker
  (live-tracking) — and no default in its code reaches the installed app's folders (APP-SRV-006,
  APP-SRV-008, APP-SRV-011); run from source it keeps the repository's `data/`, with backups beside it
  (APP-SRV-007).
- Its backups argument either names Windows' Documents known folder and a path under it — as an
  installed copy's does, `MSFS Career Map\Backups` — or is a literal path, as in test mode. Given the
  known folder, it looks Documents up at each backup — **Back up now** and the backup before an upgrade
  included — so a Documents folder moved while it runs is followed; the lookup is an input it was given,
  not a default of its own. It creates only `MSFS Career Map\Backups`, under a Documents folder that
  exists, and fails the backup with a reason rather than create Documents (APP-BAK-006).
- It listens only on 127.0.0.1 (APP-SRV-005) and answers only requests whose `Host` names 127.0.0.1 or
  localhost (APP-API-011). It refuses a request that changes something when it carries a
  `Sec-Fetch-Site` other than `same-origin` or `none`, or, without that header, an `Origin` other than
  its own (`Origin: null` included); a request carrying neither — the desktop shell's own probes among
  them — is allowed (APP-API-012).
- `/api/status` is answered in every mode, from the moment the server listens and without touching the
  database. It names the app, and gives its version, its process id, its data folder, its sim (the sim
  link, the fake feed or off), its start-up step — opening, backing up, upgrading or bringing in the
  logbook — and outright when that work is done, with airport preparation's progress; counts are left
  empty until the logbook is open (APP-API-004, APP-API-008, APP-API-010).
- The opening, backup, upgrade and swap of its start-up work run off the event loop, so `/api/status`
  keeps answering while they run (APP-SRV-010). Until the work is done it serves the page's own files
  but answers 503, with `Retry-After`, on every API route other than `/api/status` (APP-SRV-009), and the
  page takes a 503 from its first loads as the server starting and tries again by itself (APP-UI-030).
- It listens before starting the sim link and preparing airport data (APP-SRV-001), reports that
  preparation's progress in `/api/status` (APP-API-010), and the page shows it (APP-UI-031).
- When its port is in use it exits with one code, and when Windows refuses it the port with another,
  each after a plain error line (APP-SRV-013).
- An error while handling one request is written out and the server keeps running; only an error outside
  its handlers ends it, written out first (APP-API-001, APP-SRV-020). Once its start-up work is done, no
  feature of the server exits on purpose but the one that finishes bringing in a logbook, which exits
  with a code of its own asking to be started again (APP-SRV-015, APP-IMP-003); before that it exits by
  itself only when it cannot start — its port in use or refused, a data folder or database it cannot
  use, a logbook it could not back up before upgrading it (APP-SRV-013, APP-SRV-014).
- It shuts down on the private channel's request within 5 s, at any point of its start, leaving margin
  inside the desktop shell's 10 s wait, in an order that keeps the leg: it stops taking samples and stops
  the sim link (live-tracking, LIVE-LINK-011), then switches casual mode off (LIVE-CASUAL-013), then
  writes the tracker's final checkpoint (LIVE-SAVE-005), then closes its event streams and stops
  answering, then checkpoints and closes the database (APP-SRV-016). When the desktop shell crashes or
  is ended, the server ends with it and runs no shutdown; the tracker's checkpoint, the next run's
  fresh-run argument and the stale lock's takeover cover that (LIVE-SAVE-001, APP-SRV-011,
  APP-DATA-008).
- It has the tracker save its state on the private channel's request, changing nothing else
  (APP-SRV-019, LIVE-SAVE-004).
- The private channel carries only three requests, each an object with a `type` — `backup`, `save` and
  `shutdown` — and every answer repeats the id of the request it answers; any other message is logged
  and ignored (APP-SRV-022).
- It takes a backup into the backups folder on the private channel's request, which names its kind —
  daily, before an update (with the version about to install), or at the installer's or uninstaller's
  `--quit` (APP-BAK-001) — and on the page's **Back up now**, marked as the pilot's own (APP-BAK-002);
  takes one requested during its start-up work once that work is done (APP-BAK-005); reports its
  progress on the private channel at least every 2 s while it copies (`backup-progress`); answers a
  request with `backup-done`, naming the file, or `backup-failed`, with a short reason naming no folder
  and a full one, a write that Windows refused — Controlled folder access among the causes — told apart
  (APP-BAK-001, APP-BAK-008); and writes each backup under a temporary name, renamed only when complete,
  and deletes one abandoned or failed (APP-BAK-003).
- Every backup's name carries the id of the logbook it holds — an id no two live logbooks share
  (APP-DATA-006) — and a UTC time stamp ending in `Z`, by which "newest" is reckoned (APP-BAK-004). It
  prunes only backups of the logbook it holds, keeping that logbook's seven newest daily backups and
  three newest others, and never prunes its **Back up now** copies or its newest backup taken before an
  upgrade (APP-BAK-007).
- When the backups folder cannot be written, a Back up requested before an update and naming version V
  goes into the data folder as `career.before-update-V.db`, and the backup before an upgrade to version
  V as `career.before-V.db`, one of each kept (APP-BAK-009). When an upgrade's backup fails both ways,
  the server leaves the logbook unchanged and exits with "Could not back up the logbook before upgrading
  it: <full reason>" (APP-BAK-010), which the desktop shell shows once it gives up, with Show log and Try
  again.
- It brings in a logbook from the folder offered or typed, with SQLite's own backup, never over a
  logbook that has hops, refusing while a copy still runs on that folder (APP-IMP-002, APP-DATA-007);
  the page makes the offer and asks the pilot to close that copy first (APP-UI-038, APP-UI-039). It
  finishes the import through a restart: with the copy and the merged tracker state ready beside the
  logbook, it exits with the code that asks to be started again (APP-IMP-003), and the next server puts
  the copy in place before it opens the logbook, reporting "bringing in the logbook" as its start-up
  step (APP-IMP-004; A requested restart).
- When the backups folder holds backups of other logbooks that have hops, the page also offers, as the
  logbook to bring in under the same rules, the newest backup of each of those logbooks, told apart by
  the logbook id in their names, each named and dated with its hop count and newest hop, worked out
  whenever the page asks (APP-IMP-001, APP-UI-039).
- Every request the server makes carries `MSFSCareerMap/<version> (+https://github.com/SharpWave/msfs-career-map)`
  as its User-Agent, the form the window's own requests use (APP-API-005; The Window).
- The page opens the hop or pending leg named in its address's fragment, on load and when it changes,
  then clears the fragment with `history.replaceState` (APP-UI-032 to APP-UI-034). For an id it cannot
  find, it leaves everything as it is and shows a toast: "That leg has already been logged or
  discarded" or "That hop no longer exists" (APP-UI-035).
- The page may be shown below 800 × 600 in either direction, on a display whose scaled work area leaves
  the window less room than that (APP-UI-041; The Window).
- The README says how to keep the tray icon in view — Windows 11 keeps a new program's icon under ^ on
  the taskbar — beside its step for Windows' priority notifications, and how to let the app write to
  Documents under Controlled folder access (app-shell's Docs This Segment Owns, which no EARS spec
  carries).

**live-tracking**:

- The status says whether this server's sim link is connected (menus included), the leg's phase and
  origin, casual mode and the pending legs (LIVE-API-001), and whether another copy on the PC holds the
  sim link, in words the tray can show (`link_holder`, LIVE-API-013).
- Only a server whose real link to the sim on this PC is connected holds the PC-wide claim on the sim
  link: it takes the claim when SimConnect opens and releases it when the link closes or its process
  ends (LIVE-LINK-010). A fake feed, a server with its sim off and `sim-probe` never take, hold or report
  it (LIVE-LINK-015, LIVE-TOOL-004). The installed app links by default (`--sim=link`, LIVE-LINK-012); a
  copy run from source links only when started with `--sim=link` (`npm run dev:sim`, LIVE-LINK-013),
  and only while no other server holds the claim (LIVE-LINK-001, LIVE-LINK-014).
- The `hop` event carries the hop's id, which no other hop in that logbook is ever given (logbook,
  LOG-REC-014), and the tracker's message (LIVE-HOP-006); the `pending` event carries the leg's id, sim
  aircraft and reason (LIVE-API-014).
- A pending leg's id is unique for the life of the logbook and never reused, a logbook brought in or
  restored from an older backup included — a random UUID, never a counter that a restore would rewind —
  and kept with the leg in `tracker_state` (LIVE-HOP-003), so a notification's link, even one left in
  the notification centre across a restore, names that leg or nothing.
- When the server shuts down, the sim link stops without any disconnect reaching the tracker, and the
  state saved at shutdown is the tracker's state from before the link stopped (LIVE-LINK-011,
  LIVE-SAVE-005). Saving the state on request changes nothing else (LIVE-SAVE-004).
- Logging a hop and the checkpoint that clears its leg or pending leg are written in one SQLite
  transaction, so a server ended at any instant leaves the flight either in the checkpoint or in the
  logbook, never in both (LIVE-SAVE-006).
- An error while handling one sample or sim event is written out and the tracker keeps running
  (LIVE-LINK-016). A checkpoint that cannot be read is set aside, the tracker starts empty, and that is
  written out (LIVE-SAVE-007).
- When a logbook is brought in, the tracker keeps the installed copy's leg in progress and pending legs,
  and adds the source's pending legs and the source's leg in progress, as a pending leg (LIVE-SAVE-008,
  LIVE-SAVE-010, LIVE-SAVE-011).
- Casual mode survives a server restart the desktop shell makes — the switch is kept with the tracker's
  checkpoint (LIVE-SAVE-001, LIVE-CASUAL-011), the path flown is lost — and ends when the server shuts
  down on the private channel's Shut down, which the desktop shell sends only when the app is set to
  quit (LIVE-CASUAL-013; APP-SRV-016), and when MSFS quits cleanly (SimConnect's quit event, not a crash
  or a lost connection; LIVE-CASUAL-014); the server switches it off before the tracker's final save, so
  the next start finds it off (LIVE-SAVE-005). After a desktop shell that crashed or was ended, casual
  mode stays saved on until the next run's first server start switches it off (LIVE-CASUAL-015).
- Given the fresh-run argument (Starting the server; app-shell's `--fresh-run`, APP-SRV-011), the
  tracker starts with casual mode off whatever its checkpoint holds, and writes the switch off into its
  checkpoint before the server's start-up work is done, so a later server start in the same run, made
  without the argument, finds it off too (LIVE-CASUAL-015).
- The page opens its event stream again 3 s after it ends, and on every reconnect after the first
  reloads the map and lists as LIVE-CARD-009 does, without the `hop` event's other effects (LIVE-API-005;
  the planner's result, PLAN-RUN-006), so a hop logged while it was away is shown.
- `SIMCONNECT_HOST`, `SIMCONNECT_PORT` and `TRACKER_FAKE` are settings of a copy run from source
  (LIVE-LINK-002, LIVE-LINK-013); the bundled server reads none of them, tracking in the mode its `--sim`
  argument gives (LIVE-LINK-012), and the installed app never receives them (Starting the server).

**airports**:

- The airport popup shows an airport's `home_link` as a link when it is an http or https address, adds
  `https://` to a value without a scheme that looks like a host name, and shows nothing for anything
  else (APT-POP-007); a link without a scheme would resolve to the page's own origin, where the window
  refuses a new window (The Window).

**simbrief**:

- The SimBrief card makes an address taken from a plan — its PDF, or a link inside its OFP text — a
  link only when it resolves, against the page's own address, to an http or https address on another
  origin, opening it as a new window (SB-CARD-009), so no link from a plan asks the window for a new
  window on its own origin, which the window refuses (The Window).

## Decisions & Alternatives

| Decision | Chosen | Alternatives Considered | Rationale |
|----------|--------|------------------------|-----------|
| The server's inputs | Explicit start-up arguments, with the source-run variables removed from its environment | Inheriting the environment (`CAREER_DB`, `PORT`, `TRACKER_FAKE`) as a source run does | A setting left in the pilot's or developer's environment can never point the installed app at another logbook, port or the fake feed; one place says what the installed server runs on. |
| When backups are taken | Daily, before an update and when the installer or uninstaller closes the app, asked for by the desktop shell and each bounded by 60 s without progress; before a schema upgrade and on **Back up now**, by the server; pruned by the server, per logbook | Only before updates and upgrades; a daily timer in the server; a fixed 60 s from the request | The HLD gives the desktop shell the when and where. A daily copy bounds what a damaged or deleted logbook can lose to a day. Kept out of the server, the daily copy is made only by the desktop app, so a copy run from source, and the server under the Vitest and browser tests, never pile them up. Bounding by progress rather than by a fixed time never cuts short a large logbook still being copied on a slow disk, yet still ends a backup that has stalled. |
| A failing daily backup | Asked for again at the next hourly check, then once a day; from the third failure in a row, a line in the tray menu and one notification | Retrying every hour for good; saying nothing until the pilot looks in the log | A cause that lasts — Controlled folder access refusing an unsigned program, a full drive — fails every try, and Windows may announce each refusal, mid-flight included. A pilot told that backups exist would otherwise go on trusting copies that are not being made. |
| Where the backups folder is looked up | The server looks Documents up through Windows' known folders at each backup; the desktop shell, for `desktop.log` and the tray, reads the same registry value the server reads | Once per server start; by the desktop shell, passed with each Back up request; Electron's own Documents path for the desktop shell | OneDrive's folder backup can move Documents while the app runs for days; a folder fixed at start would leave backups outside OneDrive and out of the pilot's sight. Looked up by the server, its own backups — **Back up now**, before an upgrade — follow a move too. Electron's path keeps its first answer for the run, so after a move the tray would open, and `desktop.log` name, a folder the server no longer backs up into. |
| Readiness | `/api/status` answering with this app's name and the process id of the server the desktop shell started | A "ready" message on the private channel; a fixed wait; the app's name and version | It proves the page will load from the address the window uses. The process id tells the desktop shell's own server from another program on the port, and from another server of this app — of any version, left behind, or run by another account or a test copy — which name and version cannot. |
| How long a start may take | 60 s for the first `/api/status` answer; no bound on the start-up work that follows while the server keeps answering | One bound for the whole start | Backing up and upgrading the logbook grow with it. Ending a server in the middle of an upgrade risks the logbook and would fail the same way at every retry, while a server that still answers is plainly working. |
| Start-up work done | Only when `/api/status` says so outright | When the status no longer names a step | Only an outright "done" says the logbook is open. A status that names no step — from a server that does not keep to the `/api/status` contract — read as done would load the page into 503s and ask for the daily backup before the logbook is open; waiting for the word costs nothing. |
| Restart bound | Three failures in a row at start — within 60 s, or before the start-up work is done — waiting 1 s, then 5 s; a server that exits after that is restarted after 1 s with a fresh count | Restarting forever with growing waits; never restarting; counting every exit until the server has run ten minutes | The HLD gives up only on a server that keeps failing as it starts. One that cannot start stops with a reason instead of looping behind an empty window; one that crashes after running is always restarted, since each restart restores the checkpoint and Never lose a flight ranks first. |
| A server that stops answering | Ended and restarted after three unanswered checks 30 s apart with nothing on the event stream in that time, its keep-alive included | Left running; ended after one unanswered check | A hung server records nothing, so it is treated as a crash. Three checks with a silent event stream keep a server busy with one long piece of work from being ended; the keep-alive is what a quiet but healthy stream sends. |
| The event-stream subscription | Subscribed again whenever it ends while the server runs, 2 s later and then after waits doubling up to 30 s | Subscribing again only after a restart, **Try again** or a resume | A stream can end while the server keeps running — the server closing its streams, a socket reset — and a tray left on its last status would show a flight long over, miss pending legs and their notifications, and ask Quit's question wrongly. |
| A requested restart | A server that exits with the code asking to be started again is started at once, no failure counted, and an open window reloads the page once its start-up work is done | Counting it as a crash; a message on the private channel | Bringing in a logbook finishes through a restart (app-shell); counted as a crash, it would be delayed and could lead to giving up. An exit code needs nothing more on the channel, and the page reloads because the logbook behind it has changed. |
| A leftover server of this app on the port | On the same data folder, ended after 20 s by the process id it reports, once that process is seen to run the desktop shell's own program; on another data folder, left alone and reported | Waiting out the retries and asking the pilot to end it in Task Manager; never ending another process; ending whatever process id the answer names | A server on the same data folder can only be this app's own, left behind by a desktop shell that ended suddenly, and two servers cannot share the logbook; ending it is what the pilot would do by hand. Any program on the port can send any process id, so the id is ended only when it runs the app's own program. One on another data folder belongs to another account, a test copy or a copy run from source. |
| A crashed desktop shell | Left ended until the next start by the pilot, MSFS or Windows sign-in; its server ends with it and the checkpoint holds the leg | A watchdog process; Windows restarting it | The desktop shell does no database or sim work and handles its own errors, so it rarely ends. A watchdog is another process to install, update, end at each update and keep from looping, and the checkpoint already keeps the leg. |
| Outside links | The default browser for http and https; anything else refused | Windows inside the app | The pilot's SimBrief and Navigraph sessions live in their browser; a window inside the app has no address bar or Back; plain links keep the page unchanged in a browser tab. |
| The window's settings | Stated outright in the code that creates it | Electron's defaults | Defaults can change with an Electron major; stated, the window cannot gain powers through an upgrade, and a unit test can read them. |
| Closing the window | Discard the window and its page; the server and tray keep running | Hide the window and keep its page | Discarding frees the page's memory and stops its map redrawing beside the sim; everything the page shows comes back from the server. A half-typed form is lost, as when a browser tab is closed. |
| The page's confirm dialogs while quitting | Left open: they close with the window when the app exits, and stay when an update goes no further | Closing them with the desktop shell's own boxes; loading the quitting screen over the page, which ends them; routing the page's `confirm()` through the desktop shell | Chromium shows them for the renderer, and the main process has no call that closes one. Loading another screen over the page would end a dialog but reload the page, losing a half-typed form, when an update goes no further; routing `confirm()` through the desktop shell adds a preload and a channel to a window kept without them. A quiet moment never meets one, since it waits for the window to be closed, and a Quit or **Restart to update** chosen in the tray goes ahead regardless. |
| One quitting state | The first quit decides; later ones are ignored, except that a Quit or `--quit` during an update is held until the update goes ahead or no further; a session end overrides; a start handed over during Quit restarts the app; a start-list change under way finishes first, but at a session end; an update that goes no further leaves the state | Each quit request run on its own; a Quit or `--quit` during an update ignored; **Restart to update** entering the state only once its backup and sim checks pass | Two quits running at once would back up, shut down and install twice. A session end leaves no time to finish another quit, and a start the pilot made during Quit is a request to keep the app running. Entering the state at the click keeps a Quit or `--quit` made during the update's backup from starting a second backup beside it; holding it, rather than ignoring it, keeps it from being lost when the update then stops, which would leave the app running and a hand-run installer ending it 90 s later with no backup. A start-list change cut short could leave a temporary file in the sim's folder, or a record that reads the app's own entry as removed by another program. Leaving the state when the update goes no further keeps the app fully running. |
| Hearing Windows sign-out | A hidden window alive for the whole run; the tracker's state saved at `query-session-end`; quitting started inside its `session-end` handler | Relying on the main window; shutting the server down at `query-session-end` | Electron delivers Windows' session-end only to windows, and the main window is usually closed. The quit must start inside the `session-end` handler, or Electron exits without waiting for the server. A session end can still be called off after the query — another program holds it up and the pilot cancels — so shutting down then could leave the app running with no server; saving the state then changes nothing and keeps the leg safe if Windows ends the processes before the quit finishes. |
| Casual mode across runs | A fresh-run argument on each server start of a run until one has done its start-up work, telling the tracker to start with casual mode off; the server's switch-off at Shut down kept as well | Relying on the shutdown order alone; starting every server with casual mode off | Casual mode ends when the pilot quits the app, sign-out included, so a new session never starts with logging off. A Windows session end can end the processes before the shutdown finishes, and a desktop shell that crashes takes its server with it, so the order alone can leave the checkpoint holding casual mode on and the next morning's career flight unlogged. Starting every server with it off would end casual mode at a crash restart mid-flight and log a flight the pilot chose not to log. The argument holds until a start-up is done, so a first start that fails and is retried still starts with it off. |
| Single running copy | Electron's single-instance lock, a second start handing over its command line | A lock of the app's own; letting copies run and relying on the sim-link rule | Two copies on one logbook would contend for its database and port. Electron's lock comes with the hand-over that the Start menu, MSFS and the installer need. |
| Starts by MSFS and Windows | `--background`: the tray only, and nothing when a copy is running | One start behaviour for every start | MSFS and Windows start the app while the pilot is busy with something else; only the pilot's own start shows the window. |
| What `--unregister` writes | `desktop.log`, and the record of `EXE.xml` files last written, each file it removes the entry from taken out just before the removal | `desktop.log` only, the record left as it was; taking each file out after the removal | A reinstall reads that record; left as it was, the tray would show the entry the uninstall itself removed as "removed by another program". Taken out before the removal, a clean-up cut short never leaves the record naming a file whose entry is gone; a file whose removal then fails still holds the entry turned on, which the tray shows as ticked. |
| The give-up reason with nothing else to go on | "The server did not start within 60 s" | "The server stopped responding" | A server that never became ready and wrote no error line did not stop responding; it never answered. The desktop shell's own reason, then the server's last error line, come first because each says more. |
| When notifications show | Pending leg and logged hop only while the window is not in front; all silent while the sim is in use; the update notice only with the sim not in use, once per version; failing backups once, from the third failure in a row; none marked urgent | Always; with sound; urgent ones past Do Not Disturb; also for the sim connecting and disconnecting; the update notice at each check that finds the update downloaded | The page shows its own toast to a pilot looking at it, a sound interrupts a flight, an update is never urgent, Windows' Focus is the pilot's choice, and the tray already shows the connection. electron-updater reports a downloaded update again at each later check, so only a record per version keeps the notice to one. |
| Notification text | The tracker's own message or reason inside a fixed title | Composed by the desktop shell from the hop's data | A notification and the live card say the same thing, and the desktop shell needs nothing from the logbook or airports. |
| Opening a leg or hop from a notification | The page's address fragment, cleared once acted on; held by a window still on the start screen for its first load of the page | A message through a bridge; reloading with a query; loading the page at once | It works the same in a browser tab, and changing only the fragment loses nothing on a page already open. A page loaded before the server's start-up work is done would meet a server still starting, so a click that starts the app waits for it. |
| Notification clicks | The Start-menu shortcut carrying the AppUserModelID and a fixed ToastActivatorCLSID | The AppUserModelID alone | Windows routes clicks from the notification centre, or after a restart, only through a shortcut carrying both; Electron otherwise makes up a new CLSID at each start. |
| A Start-menu shortcut without the CLSID | The CLSID written onto the shortcut when it exists without it; a missing shortcut never created | Creating the shortcut again at each start when it is missing | The shortcuts are the installer's and the pilot's: an install over an installed copy (an update, a repair or an older installer) leaves them as the pilot left them, and a shortcut the pilot deleted coming back at every start would be the app getting in the pilot's way. |
| Update source | electron-updater from public GitHub Releases | update.electronjs.org; a version check linking to the release page | It updates the NSIS install in place with no token, key or server of the project's own. update.electronjs.org serves only Squirrel and MSIX builds. |
| When updates download and install | Downloads start only with the sim not in use; installs on Quit, on **Restart to update** with the sim not in use, and by itself at a quiet moment — for 5 minutes the sim not in use, the window closed, no leg in progress and casual mode off — after a backup, coming back in the tray; never at sign-out | Downloading at once; asking before downloading; installing only when the pilot chooses; installing at a start not made by MSFS | MSFS streams scenery while it flies. An app that lives in the tray and is shut down with Windows would never reach Quit and would fall off a supported Electron; a quiet moment interrupts nothing, and the app comes back as it was. Installing at a start would hold up the start the pilot or Windows asked for. Sign-out leaves no time to finish. |
| How an update installs | The desktop shell calls `quitAndInstall` itself; electron-updater's install on quit off | electron-updater installing on any quit, its default | Only Quit, **Restart to update** and a quiet-moment install follow a backup with the sim checked; an exit at sign-out, through `--quit` or by a crash must never start an installer. |
| A start during an install | It takes no lock, leaves its command line in the install-under-way mark, which the desktop shell writes just before its last look for starts handed over, and exits; the installer starts the app with the one that shows the most once the install is done | Holding Quit's install while the sim is in use; a separate process left waiting for the installer to end | MSFS through `EXE.xml`, Windows sign-in or the pilot can start the app at any moment, and the start would otherwise find the program half replaced, or an old copy that the installer quits and leaves stopped. Quit is a moment the app stops anyway, and holding its install while the sim runs would only make installs rarer. The installer runs to the end regardless, so it can start the app itself, with no other process left behind. |
| Which update is ready | One downloaded update at a time: no check runs while it is ready | Downloading a newer release over a ready one | electron-updater keeps a single installer, so a newer download would leave nothing installable while it ran, and a Quit or **Restart to update** then would install nothing or fail. The installed version's own first check finds anything newer. |
| A failed backup before an update | The update waits, a quiet moment trying again an hour or more after the failure; **Restart to update without a backup** lets the pilot install anyway; daily backups that fail hold no update | Installing anyway by itself; no way to install until a backup succeeds; holding quiet moments while the last daily backup failed | Never lose a flight: a backup comes first by default. A cause that lasts would otherwise hold every update for good, leaving the app on an unsupported Electron; installing anyway is safe enough when the pilot chooses it, since the new version backs the logbook up before upgrading it. Where no server runs to take a backup, that backup before the upgrade is the safeguard. Under Controlled folder access every daily backup into Documents fails while the backup before an update, falling back into the data folder, succeeds; held on daily backups, the quiet moment would never come for a pilot who never chooses Quit. The hour keeps a quiet moment from meeting a lasting cause every 5 minutes. |
| The version line | Each check replaces the update state with "— checking for updates" and then with what it finds, a failure the line showed included; before the first check, "Version X" alone, or "— Y could not be installed" when this start found an installer that failed; no check started while a download runs or an update is ready | A failure kept on the line until it is resolved; checks started during a download or while an update is ready | The line says what is true now, and `desktop.log` keeps the full reason behind every state it replaces. Before the first check nothing is known about updates but an install this start found failed, which tells a pilot who chose to install why version X is still the one running. A check during a download or while an update is ready could only report what the line already shows. |
| Prerelease channel | None; prereleases are never offered | A tray switch for prereleases | One pilot needs no channel; the maintainer installs a prerelease by hand. |
| GPU | Hardware acceleration on | Off, to leave the GPU to the sim | The page's glass and map are tuned for a browser sharing the GPU with the sim; drawing them in software would move the work onto the CPU the sim also needs. |
| Logs | The desktop shell writes the server's output and its own events to two files in Electron's folder | The server writing its own log into the data folder | Everything the server prints is kept, a crash's last words included, with no logger in the server; the data folder holds only what the server keeps there. |
| Closing the window, as a setting | None: closing always leaves the app in the tray | A setting to quit on close, as Volanta offers | Closing the window must never stop tracking (HLD success metric); Quit in the tray is the way out. |
| The one-time notice | Shown at the pilot's own first close while the app is tracking, saying where the tray icon is | At any first close of the window; naming the tray without saying where the icon is | The window also closes as the app exits, when "keeps running" would be false, and a close while the server is given up on logs nothing. Windows 11 keeps a newly installed program's tray icon among the hidden icons, so a notice that only names the tray leaves the pilot looking for it. |
| Quit confirmation | Only while a leg is in the air, as a fresh read of the tracker shows | Always; never; also while a leg has landed; from the last status received alone | Quitting in the air leaves the rest of the flight unrecorded. A landed leg is restored at the next start and closes where the aircraft stopped. The last status received may be stale if the event stream ended unnoticed, so it decides only when the fresh read gets no answer. |
| Finding a logbook run from source | The desktop shell asks a copy on port 3080 for its data folder at each start, accepts only a copy not on the fake feed and a local folder holding `career.db`, remembers the last one found, and passes it to the server as the logbook to offer | Searching the disk; a fixed path; the server looking for the copy itself; reading the folder from the source-run desktop shortcut; also passing over a copy with its sim off | A running copy knows its own data folder exactly; searching the pilot's disk is slow and a guess. Remembering the folder keeps the offer once that copy is closed; the source-run shortcut is replaced by the installer's of the same name. Whatever answers on 3080 can name any folder, so only one that looks like a logbook on a local drive is passed on. The HLD gives the desktop shell the choice of where a logbook is brought in from, and only the installed app looks: a server run from source would find itself on 3080. A copy on the fake feed is a test run, usually against a copy of the logbook; offered, it would bring in fake hops and close the offer for good. A copy not on the fake feed runs on the pilot's own logbook — most copies run from source report their sim off, since they link to the sim only when started with their option to — so it is offered. |
| Notifications in test mode | Written to the log | Shown | The smoke test can read them, a test run does not fill the developer's notification centre, and an unpackaged run has no Start-menu shortcut to route clicks through. |

## Open Questions & Future Decisions

### Open

1. **Notifications** — Electron 45 takes every click through `Notification.handleActivation`, a start
   by one included, carrying the toast's launch string, and writes the ToastActivatorCLSID's
   `LocalServer32` registration under `HKCU\Software\Classes\CLSID` itself. Still to be seen on the
   installed app: clicks from the notification centre and ones that start the app, which switch such a
   start carries (the command line ignores it either way, so it starts as a start with no switch), any
   AppUserModelId key Electron writes, whether Electron makes a Start-menu shortcut of its own, and a
   closed toast leaving the notification centre (Notifications, One Running Copy).
2. **Session end on the hidden window**, and how long Windows waits for the clean shutdown, have not yet
   been seen on Electron 45. Should Windows end the processes first, no server is left behind: a main
   process ended outright, by `taskkill /F` or `process.kill`, takes its server's utility process with
   it within a second.
3. **The tray icon on Windows 11** — that a newly installed program's icon goes among the hidden icons,
   and the Settings path the one-time notice quotes for keeping it in view, are still to be checked on
   the Windows 11 builds the app supports (The Tray).

### Deferred

1. **A prerelease channel.**

## References

- Parent: [Desktop](../desktop-design.md) — the process model, when the sim is in use, names and folders,
  the platform and test mode
- HLD: [docs/high-level-design.md](../../../high-level-design.md) — Tenets, System Design, and the
  decisions Closing the window, Which copy logs flights, When updates install and Flying outside the
  career
- Siblings: [Start lists](../start-lists/start-lists-design.md) (the tray's start-list items,
  `--unregister`), [Distribution](../distribution/distribution-design.md) (the bundles, the installer's
  `--quit`, how an install under way is marked and the app started again after it, the packaged smoke
  test)
- Related designs: [app-shell](../../app-shell/app-shell-design.md) (server, data folder, backups,
  logbook import, page), [live-tracking](../../live-tracking/live-tracking-design.md) (status, event
  stream, sim link), [airports](../../airports/airports-design.md) (the airport popup's links),
  [simbrief](../../simbrief/simbrief-design.md) (links taken from a plan)
- Code: `src/desktop/` (the desktop shell), `tests/desktop/shell/`
- External: Electron (utility processes, the single-instance lock, notifications, session and power
  events), electron-updater (GitHub provider), OpenStreetMap's tile usage policy
