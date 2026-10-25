/**
 * A clock the desktop tests move by hand (m2 contract §2.2, §18.2). Time moves only through
 * `await clock.advance(ms)`, which lets promise callbacks run before and after each timer it fires,
 * so a flow that awaits a port between waits settles as it would on the real clock. `setWall`
 * moves the system clock alone (a clock change moves no wait, DESK-SHELL-SRV-037).
 */
import type { Cancel, Clock } from "../../../src/desktop/ports.ts";

interface Timer {
  due: number;
  seq: number;
  fn: () => void;
}

export const DEFAULT_NOW = 1_000_000;
export const DEFAULT_WALL = "2026-10-25T12:00:00.000Z";

export class FakeClock implements Clock {
  private monotonic: number;
  private wall: number;
  private timers: Timer[] = [];
  private seq = 0;
  private advancing = false;

  /** Defaults: now 1_000_000, wall 2026-10-25T12:00:00.000Z. */
  constructor(o: { now?: number; wall?: Date | string } = {}) {
    this.monotonic = o.now ?? DEFAULT_NOW;
    this.wall = new Date(o.wall ?? DEFAULT_WALL).getTime();
    if (Number.isNaN(this.wall)) throw new Error(`FakeClock: not a time: ${String(o.wall)}`);
  }

  now(): number {
    return this.monotonic;
  }

  wallNow(): Date {
    return new Date(this.wall);
  }

  after(ms: number, fn: () => void): Cancel {
    const wait = Number.isFinite(ms) && ms > 0 ? ms : 0;
    const timer: Timer = { due: this.monotonic + wait, seq: this.seq++, fn };
    this.timers.push(timer);
    return () => {
      const i = this.timers.indexOf(timer);
      if (i >= 0) this.timers.splice(i, 1);
    };
  }

  /**
   * The only way to move time. Moves both clocks by ms: await flush(); then, while some timer is
   * due at or before the target, take the earliest (equal times in scheduling order), set now()
   * (and the wall clock, by the same difference) to its time, fire it, await flush(); timers
   * scheduled meanwhile fire too when due; finally set now() to the target and await flush().
   * advance(0) fires what is due now.
   */
  async advance(ms: number): Promise<void> {
    if (!(Number.isFinite(ms) && ms >= 0)) throw new Error(`FakeClock.advance: not a duration: ${ms}`);
    if (this.advancing) throw new Error("FakeClock.advance called while an advance is under way");
    this.advancing = true;
    try {
      const target = this.monotonic + ms;
      await flush();
      for (;;) {
        const next = this.nextDue(target);
        if (!next) break;
        this.timers.splice(this.timers.indexOf(next), 1);
        this.moveTo(next.due);
        next.fn();
        await flush();
      }
      this.moveTo(target);
      await flush();
    } finally {
      this.advancing = false;
    }
  }

  /** The system clock alone; monotonic time and timers untouched. */
  setWall(t: Date | string): void {
    const wall = new Date(t).getTime();
    if (Number.isNaN(wall)) throw new Error(`FakeClock.setWall: not a time: ${String(t)}`);
    this.wall = wall;
  }

  /** Timers not yet fired or cancelled. */
  pending(): number {
    return this.timers.length;
  }

  private nextDue(target: number): Timer | undefined {
    let best: Timer | undefined;
    for (const t of this.timers) {
      if (t.due > target) continue;
      if (!best || t.due < best.due || (t.due === best.due && t.seq < best.seq)) best = t;
    }
    return best;
  }

  private moveTo(t: number): void {
    this.wall += t - this.monotonic;
    this.monotonic = t;
  }
}

/** Lets pending promise callbacks run: ten setImmediate turns (real ones: FakeClock never touches setImmediate). */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}
