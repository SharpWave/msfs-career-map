/**
 * The private channel between the desktop shell and the server it starts: a save, a backup and a
 * shutdown asked for, and their answers. In the installed app it is the Electron utility process's
 * `process.parentPort`; in tests, which fork the bundled entry, Node's IPC channel stands in for it
 * with the same messages. Nothing over HTTP saves or shuts down. The channel closing is not an
 * event the server acts on: it cannot see the shell end.
 */
import { inspect } from "node:util";

export interface PrivateChannel {
  send(msg: object): void;
  onMessage(fn: (msg: unknown) => void): void;
}

/** The shape of `process` this reads, so tests can pass a stand-in. */
export interface ChannelHost {
  parentPort?: { on(ev: "message", fn: (e: { data: unknown }) => void): unknown; postMessage(msg: unknown): void };
  send?: (msg: unknown) => unknown;
  channel?: unknown;
  on(ev: string, fn: (...args: any[]) => void): unknown;
}

/**
 * Electron's process.parentPort when present: messages arrive as `event.data`, and replies go out
 * with `parentPort.postMessage`. Otherwise Node's IPC channel, when `proc.send` is a function and
 * `proc.channel` is set: `proc.on("message")` and `proc.send`. Otherwise null. Neither branch
 * reports the channel closing.
 */
// @spec APP-SRV-022
export function privateChannel(proc: ChannelHost = process as unknown as ChannelHost): PrivateChannel | null {
  const port = proc.parentPort;
  if (port) {
    return {
      send: (msg) => port.postMessage(msg),
      onMessage: (fn) => {
        port.on("message", (e) => fn(e?.data));
      },
    };
  }
  if (typeof proc.send === "function" && proc.channel) {
    const send = proc.send.bind(proc);
    return {
      send: (msg) => {
        send(msg);
      },
      onMessage: (fn) => {
        proc.on("message", (msg: unknown) => fn(msg));
      },
    };
  }
  return null;
}

export interface ChannelHandlers {
  save(): void;
  shutdown(): void;
  /** Take a backup of that kind (`daily`, `quit`, `update-<version>`); its full path, or BackupFailed. */
  backup?(kind: string, onProgress: () => void): Promise<string>;
}

/** How often a backup under way says it is still going: well inside the 2 s the desktop shell allows. */
const PROGRESS_MS = 1000;

/** The backup kind a request names, or null for a request of the wrong shape. */
function backupKind(msg: Record<string, unknown>): string | null {
  if (msg.kind === "daily" || msg.kind === "quit") return msg.kind;
  if (msg.kind === "update" && typeof msg.version === "string" && /^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(msg.version)) return `update-${msg.version}`;
  return null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Answers the channel's messages: `{type: "save", id}` saves and then answers `{type: "saved", id}`
 * with the same id (no answer when the save fails, which is written out); `{type: "shutdown"}`
 * shuts down, the exit being its answer; anything else is written out and ignored.
 */
// @spec APP-SRV-019, APP-SRV-022, LIVE-SAVE-004, APP-BAK-001
export function serveChannel(ch: PrivateChannel, h: ChannelHandlers, log: (line: string) => void = (line) => console.log(line)): void {
  ch.onMessage((msg) => {
    if (isRecord(msg) && msg.type === "save" && "id" in msg) {
      try {
        h.save();
      } catch (e) {
        console.error(`[server] the save asked for on the private channel failed: ${e instanceof Error ? e.message : String(e)}`);
        return;
      }
      ch.send({ type: "saved", id: msg.id });
      return;
    }
    if (isRecord(msg) && msg.type === "shutdown") {
      h.shutdown();
      return;
    }
    // @spec APP-BAK-001
    const kind = isRecord(msg) && msg.type === "backup" && "id" in msg && h.backup ? backupKind(msg) : null;
    if (kind && isRecord(msg)) {
      const id = msg.id;
      const progress = () => ch.send({ type: "backup-progress", id });
      const timer = setInterval(progress, PROGRESS_MS);
      h.backup!(kind, () => {}).then(
        (file) => {
          clearInterval(timer);
          ch.send({ type: "backup-done", id, file });
        },
        (e: unknown) => {
          clearInterval(timer);
          const f = e as { short?: unknown; reason?: unknown };
          const short = typeof f?.short === "string" ? f.short : "the backup failed";
          const reason = typeof f?.reason === "string" ? f.reason : `${short}: ${e instanceof Error ? e.message : String(e)}`;
          console.error(`[backup] failed: ${reason}`);
          ch.send({ type: "backup-failed", id, short, reason });
        },
      );
      return;
    }
    log(`[server] ignoring a message on the private channel: ${shown(msg)}`);
  });
}

/** A message as its JSON, or as util.inspect shows it when JSON cannot hold it (a BigInt, a cycle). */
function shown(msg: unknown): string {
  try {
    return String(JSON.stringify(msg));
  } catch {
    return inspect(msg, { breakLength: Infinity });
  }
}
