/**
 * The desktop shell's own errors (src/desktop/errors.ts; m2 contract §7.4): an uncaught exception
 * or unhandled rejection in the shell's process is written as one line and never rethrown, so the
 * shell keeps running and Electron, finding a listener, shows no error box (DESK-SHELL-SRV-002).
 * A plain EventEmitter stands in for `process`.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { installErrorHandlers } from "../../../src/desktop/errors.ts";

function installed(): { target: EventEmitter; lines: string[] } {
  const target = new EventEmitter();
  const lines: string[] = [];
  installErrorHandlers(target, (line) => lines.push(line));
  return { target, lines };
}

describe("the shell's own errors", () => {
  // @spec DESK-SHELL-SRV-002
  it("listens for both events on the target it is given", () => {
    const { target } = installed();
    expect(target.listenerCount("uncaughtException")).toBe(1);
    expect(target.listenerCount("unhandledRejection")).toBe(1);
  });

  // @spec DESK-SHELL-SRV-002
  it("writes an uncaught error's stack as one line and does not rethrow", () => {
    const { target, lines } = installed();
    const e = new Error("tray icon missing");
    expect(() => target.emit("uncaughtException", e)).not.toThrow();
    expect(lines).toEqual([`[shell] uncaught error: ${e.stack}`]);
  });

  // @spec DESK-SHELL-SRV-002
  it("writes an unhandled rejection the same way, and keeps writing later ones", () => {
    const { target, lines } = installed();
    const e = new TypeError("cannot read the menu");
    expect(() => target.emit("unhandledRejection", e)).not.toThrow();
    expect(() => target.emit("unhandledRejection", new Error("again"))).not.toThrow();
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(`[shell] unhandled rejection: ${e.stack}`);
    expect(lines[1].startsWith("[shell] unhandled rejection: Error: again")).toBe(true);
  });

  // @spec DESK-SHELL-SRV-002
  it("falls back to the message, then to the value as text", () => {
    const { target, lines } = installed();
    const noStack = new Error("no stack here");
    noStack.stack = undefined;
    target.emit("uncaughtException", noStack);
    target.emit("unhandledRejection", { message: "a rejected object" });
    target.emit("unhandledRejection", "a plain string");
    target.emit("unhandledRejection", 42);
    target.emit("unhandledRejection", undefined);
    target.emit("uncaughtException", null);
    expect(lines).toEqual([
      "[shell] uncaught error: no stack here",
      "[shell] unhandled rejection: a rejected object",
      "[shell] unhandled rejection: a plain string",
      "[shell] unhandled rejection: 42",
      "[shell] unhandled rejection: undefined",
      "[shell] uncaught error: null",
    ]);
  });
});
