import type { Clock } from "./ports.ts";

/**
 * The real clock: `now` from `performance.now()`, timers on Node's `setTimeout` (libuv runs them on
 * the monotonic clock), so a change to the system clock moves no wait. Only `wallNow` reads the
 * system clock, for times kept in settings and log stamps.
 */
// @spec DESK-SHELL-SRV-037
export function realClock(): Clock {
  return {
    now: () => performance.now(),
    wallNow: () => new Date(),
    after(ms, fn) {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    },
  };
}
