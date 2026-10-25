/**
 * The private channel between the desktop shell and the server it starts: a save and a shutdown
 * asked for, and the save's answer. In the installed app it is the Electron utility process's
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
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Answers the channel's messages: `{type: "save", id}` saves and then answers `{type: "saved", id}`
 * with the same id (no answer when the save fails, which is written out); `{type: "shutdown"}`
 * shuts down, the exit being its answer; anything else is written out and ignored.
 */
// @spec APP-SRV-019, APP-SRV-022, LIVE-SAVE-004
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
