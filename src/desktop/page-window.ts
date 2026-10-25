import type { Cancel, Clock } from "./ports.ts";
import { SCREEN_TEXT, screenUrl } from "./screens.ts";
import { pageUrl } from "./server-inputs.ts";
import { TIMING } from "./timing.ts";

/**
 * What the open window shows: the start screen until the server's start-up work is done, then the
 * page; the failure screen while the shell has given up; the quitting screen for a window opened
 * while quitting; and, after a second renderer loss within 5 minutes, the stopped screen for good.
 * A view is loaded only when it changes, or on `reload()`. A hop or pending leg a notification points at
 * changes only the fragment of a page already shown, and is otherwise held for the page's next load.
 */

/** What the window follows of the shell; `serverDone` is the Supervisor's state being `running`. */
export interface ShellView {
  quitting: boolean;
  serverDone: boolean;
  givenUp: string | null;
}

export type WindowView = "start" | "failure" | "quitting" | "stopped" | "page";

const STOPPED_LINE = `[window] ${SCREEN_TEXT.stopped}`;

export interface PageWindowOptions {
  port: number;
  clock: Clock;
  load(url: string): void;
  /** Changes only the fragment of the page the window shows. */
  setFragment(fragment: string): void;
  log(line: string): void;
  /** A fragment held from the start: the click that opened the window. */
  fragment?: string | null;
}

// @spec DESK-SHELL-WIN-001, DESK-SHELL-WIN-002, DESK-SHELL-WIN-003, DESK-SHELL-WIN-004, DESK-SHELL-WIN-020, DESK-SHELL-WIN-021, DESK-SHELL-WIN-030, DESK-SHELL-WIN-032
export class PageWindow {
  private readonly o: PageWindowOptions;
  private v: ShellView;
  private current: WindowView = "start";
  /** The reason the failure screen shows. */
  private reason: string | null = null;
  private retry: Cancel | null = null;
  private lastLoss: number | null = null;
  /** The fragment (`hop=12`) the page's next load carries; null when none is held. */
  private held: string | null = null;

  /** The window just opened (always fresh); loads its first screen or the page. */
  constructor(o: PageWindowOptions, v: ShellView) {
    this.o = o;
    this.v = { ...v };
    this.held = o.fragment ?? null;
    this.asOnOpening(true);
  }

  view(): WindowView {
    return this.current;
  }

  /** A notification click's hop or pending leg: the fragment changed alone on the page shown, else held, the latest winning. */
  // @spec DESK-SHELL-NOTE-012, DESK-SHELL-WIN-001, DESK-SHELL-CLI-021
  pointAt(fragment: string): void {
    if (this.current === "page") {
      this.o.setFragment(fragment);
      return;
    }
    this.held = fragment;
  }

  shellChanged(v: ShellView): void {
    this.v = { ...v };
    if (this.current === "stopped") return;
    if (v.quitting) {
      if (this.current === "start") this.show("quitting");
      return;
    }
    if (this.current === "quitting") return this.asOnOpening(false);
    if (v.givenUp !== null) return this.show("failure", v.givenUp);
    if (v.serverDone && (this.current === "start" || this.current === "failure")) this.show("page");
  }

  /** The page loaded again, after a requested restart (SRV-043). */
  // @spec DESK-SHELL-SRV-043
  reload(): void {
    if (this.current !== "page" && this.current !== "start") return;
    if (!this.v.serverDone || this.v.quitting) return;
    this.show("page", null, true);
  }

  /** A main-frame load of the own origin failed. */
  pageFailed(): void {
    if (this.current === "stopped") return;
    if (this.v.quitting) return this.show("quitting");
    if (this.v.givenUp !== null) return this.show("failure", this.v.givenUp);
    this.show("start");
    if (!this.v.serverDone) return;
    this.retry = this.o.clock.after(TIMING.pageRetryMs, () => {
      this.retry = null;
      if (this.current === "start" && this.v.serverDone && !this.v.quitting && this.v.givenUp === null) this.show("page");
    });
  }

  /** The window's renderer went away. */
  rendererGone(): void {
    if (this.current === "stopped") return;
    const now = this.o.clock.now();
    if (this.lastLoss !== null && now - this.lastLoss <= TIMING.rendererLossWindowMs) {
      this.show("stopped");
      this.o.log(STOPPED_LINE);
      return;
    }
    this.lastLoss = now;
    this.pageFailed();
  }

  private asOnOpening(force: boolean): void {
    if (this.v.quitting) this.show("quitting", null, force);
    else if (this.v.givenUp !== null) this.show("failure", this.v.givenUp, force);
    else this.show(this.v.serverDone ? "page" : "start", null, force);
  }

  /** Shows a view, loading it only when it changes (or when forced); any pending retry is dropped. */
  private show(view: WindowView, reason: string | null = null, force = false): void {
    this.retry?.();
    this.retry = null;
    if (!force && view === this.current && (view !== "failure" || reason === this.reason)) return;
    this.current = view;
    this.reason = view === "failure" ? reason : null;
    this.o.load(this.urlOf(view));
  }

  private urlOf(view: WindowView): string {
    switch (view) {
      case "page": {
        const held = this.held;
        this.held = null;
        return held === null ? pageUrl(this.o.port) : `${pageUrl(this.o.port)}#${held}`;
      }
      case "failure":
        return screenUrl({ kind: "failure", reason: this.reason ?? "" });
      default:
        return screenUrl({ kind: view });
    }
  }
}
