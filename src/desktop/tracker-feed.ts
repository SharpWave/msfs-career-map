import type { Cancel, Clock, LocalHttp, StreamHandle } from "./ports.ts";
import { SseParser } from "./sse.ts";
import { TIMING } from "./timing.ts";

/** The fields the tray reads (src/server/tracker.ts's TrackerStatus). */
export interface TrayTracker {
  connected: boolean;
  sim_name: string | null;
  link_holder: { text: string } | null;
  /** "idle" | "ground" | "airborne" | "landed" */
  phase: string;
  leg: { origin: string | null } | null;
  pending: { id: string }[];
  casual: object | null;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const stringOrNull = (v: unknown): string | null => (typeof v === "string" ? v : null);

/** null unless an object; then each field defaulted alone when missing or of the wrong type. */
// @spec DESK-SHELL-SRV-017
export function toTrayTracker(json: unknown): TrayTracker | null {
  if (!isObject(json)) return null;
  const holder = json.link_holder;
  const leg = json.leg;
  const pending = Array.isArray(json.pending) ? json.pending : [];
  return {
    connected: json.connected === true,
    sim_name: stringOrNull(json.sim_name),
    link_holder: isObject(holder) && typeof holder.text === "string" ? { text: holder.text } : null,
    phase: typeof json.phase === "string" ? json.phase : "idle",
    leg: isObject(leg) ? { origin: stringOrNull(leg.origin) } : null,
    pending: pending.filter((p): p is { id: string } => isObject(p) && typeof p.id === "string").map((p) => ({ id: p.id })),
    casual: isObject(json.casual) ? json.casual : null,
  };
}

/** A status answer's body as a TrayTracker; null for anything but a 200 with a status object. */
function statusOf(answer: { status: number; body: string } | null): TrayTracker | null {
  if (answer?.status !== 200) return null;
  try {
    return toTrayTracker(JSON.parse(answer.body));
  } catch {
    return null;
  }
}

const TRACKER_PATH = "/api/tracker";
const EVENTS_PATH = "/api/tracker/events";

export interface TrackerFeedOptions {
  port: number;
  clock: Clock;
  http: LocalHttp;
  serverRunning(): boolean;
  onStatus(s: TrayTracker): void;
  onActivity(): void;
  log(line: string): void;
}

/**
 * The tracker as the shell follows it: a read of `GET /api/tracker`, then the event stream, and
 * nothing else. A stream that ends, or an attempt that fails, is tried again after 2 s, doubling
 * after each failure up to 30 s, while the server's process runs.
 */
// @spec DESK-SHELL-SRV-016, DESK-SHELL-SRV-017, DESK-SHELL-SRV-027, DESK-SHELL-SRV-042
export class TrackerFeed {
  private readonly o: TrackerFeedOptions;
  /** Subscribed and not stopped. */
  private active = false;
  /** Bumped at each attempt and at stop(), so a late answer of an earlier one is dropped. */
  private attempt = 0;
  private wait: number = TIMING.streamRetryFirstMs;
  private stream: StreamHandle | null = null;
  private readBound: Cancel | null = null;
  private retry: Cancel | null = null;
  private lastStatus: TrayTracker | null = null;

  constructor(o: TrackerFeedOptions) {
    this.o = o;
  }

  /** Read GET /api/tracker, then open the stream; closes any stream open before. Resets the wait to 2 s. */
  subscribe(): void {
    this.active = true;
    this.wait = TIMING.streamRetryFirstMs;
    this.begin();
  }

  /** Close the stream, cancel a pending attempt, and attempt nothing more until subscribe(). */
  stop(): void {
    this.active = false;
    this.attempt++;
    this.clear();
  }

  /** When no stream is open and the server runs, cancel the wait and subscribe now. */
  // @spec DESK-SHELL-SRV-039
  resume(): void {
    if (!this.active || this.stream || !this.o.serverRunning()) return;
    this.subscribe();
  }

  /** The last status received; kept across ended streams. */
  last(): TrayTracker | null {
    return this.lastStatus;
  }

  /** GET /api/tracker raced with clock.after(timeoutMs); the status, or null. */
  // @spec DESK-SHELL-SRV-037
  readNow(timeoutMs: number): Promise<TrayTracker | null> {
    return new Promise((resolve) => {
      let settled = false;
      const settle = (s: TrayTracker | null) => {
        if (settled) return;
        settled = true;
        cancel();
        resolve(s);
      };
      const cancel = this.o.clock.after(timeoutMs, () => settle(null));
      this.o.http.get(this.o.port, TRACKER_PATH, timeoutMs).then(
        (a) => settle(statusOf(a)),
        () => settle(null),
      );
    });
  }

  private clear(): void {
    this.retry?.();
    this.retry = null;
    this.readBound?.();
    this.readBound = null;
    const stream = this.stream;
    this.stream = null;
    stream?.close();
  }

  /** One attempt: the read, raced with its bound, then the stream. */
  private begin(): void {
    this.clear();
    const attempt = ++this.attempt;
    const current = () => attempt === this.attempt;
    let settled = false;
    const afterRead = (answer: { status: number; body: string } | null) => {
      if (settled || !current()) return;
      settled = true;
      this.readBound?.();
      this.readBound = null;
      if (answer?.status !== 200) return this.failed();
      const status = statusOf(answer);
      if (status) this.status(status);
      this.open(attempt);
    };
    this.readBound = this.o.clock.after(TIMING.trackerReadTimeoutMs, () => afterRead(null));
    this.o.http.get(this.o.port, TRACKER_PATH, TIMING.trackerReadTimeoutMs).then(afterRead, () => afterRead(null));
  }

  private open(attempt: number): void {
    const parser = new SseParser();
    let succeeded = false;
    const current = () => attempt === this.attempt;
    this.stream = this.o.http.stream(this.o.port, EVENTS_PATH, {
      onChunk: (text) => {
        if (!current()) return;
        succeeded = true;
        this.wait = TIMING.streamRetryFirstMs;
        this.o.onActivity();
        for (const e of parser.push(text).events) {
          if (e.event !== "status") continue;
          let json: unknown;
          try {
            json = JSON.parse(e.data);
          } catch {
            continue;
          }
          const status = toTrayTracker(json);
          if (status) this.status(status);
        }
      },
      onEnd: () => {
        if (!current()) return;
        this.stream = null;
        if (succeeded) this.o.log("[tracker] the event stream ended");
        this.failed();
      },
    });
  }

  private status(s: TrayTracker): void {
    this.lastStatus = s;
    this.o.onStatus(s);
  }

  /** The stream ended or the attempt failed: the next one after the wait, while the server runs. */
  private failed(): void {
    if (!this.active || !this.o.serverRunning()) return;
    const wait = this.wait;
    this.wait = Math.min(wait * 2, TIMING.streamRetryMaxMs);
    this.retry = this.o.clock.after(wait, () => {
      this.retry = null;
      this.begin();
    });
  }
}
