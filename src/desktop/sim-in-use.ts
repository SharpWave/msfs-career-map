import type { Cancel, Clock, WindowsFacts } from "./ports.ts";
import { TIMING } from "./timing.ts";
import type { TrayTracker } from "./tracker-feed.ts";

/** MSFS running, or a server process running whose last tracker status has its sim link connected or a link holder. */
// @spec DESK-SHELL-AWAY-001
export function simInUse(o: { serverRunning: boolean; tracker: TrayTracker | null; msfsRunning: boolean }): boolean {
  if (o.msfsRunning) return true;
  if (!o.serverRunning || !o.tracker) return false;
  return o.tracker.connected || o.tracker.link_holder !== null;
}

/** Whether MSFS runs for this Windows account: a look now, then one every 10 s on the monotonic clock. */
// @spec DESK-SHELL-AWAY-001, DESK-SHELL-SRV-037
export class MsfsWatch {
  private readonly clock: Clock;
  private readonly facts: Pick<WindowsFacts, "msfsRunning">;
  private last = false;
  private looking = false;
  private timer: Cancel | null = null;
  private readonly changed: () => void;

  /** `changed` is called after a look whose answer differs from the one before. */
  constructor(clock: Clock, facts: Pick<WindowsFacts, "msfsRunning">, changed: () => void = () => {}) {
    this.clock = clock;
    this.facts = facts;
    this.changed = changed;
  }

  /** A look now, then one every 10 s (a look still outstanding when the next falls due skips it). */
  start(): void {
    if (this.timer) return;
    this.tick();
  }

  stop(): void {
    this.timer?.();
    this.timer = null;
  }

  /** The last look's answer; false before any. */
  running(): boolean {
    return this.last;
  }

  /** A look now, its answer also kept for running(). */
  async checkNow(): Promise<boolean> {
    const running = await this.facts.msfsRunning().catch(() => false);
    const before = this.last;
    this.last = running;
    if (running !== before) this.changed();
    return running;
  }

  private tick(): void {
    this.timer = this.clock.after(TIMING.msfsLookEveryMs, () => this.tick());
    if (this.looking) return;
    this.looking = true;
    void this.checkNow().finally(() => {
      this.looking = false;
    });
  }
}
