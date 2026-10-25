/**
 * Reading the tracker's event stream as raw text (src/desktop/sse.ts; m2 contract §9.1): the desktop
 * shell learns what the tracker does only from `/api/tracker` and `/api/tracker/events`
 * (DESK-SHELL-SRV-017), and counts the stream's keep-alive comments as something received
 * (DESK-SHELL-SRV-027). Lines end at `\n` with a `\r` before it removed and may span chunks;
 * `event:` names, `data:` lines join with `\n`, one space after the colon is dropped, and a blank
 * line dispatches.
 */
import { describe, expect, it } from "vitest";
import { SseParser, type SseEvent } from "../../../src/desktop/sse.ts";

/** Feeds the chunks in order and gathers everything they completed. */
function feed(chunks: string[]): { events: SseEvent[]; comments: number } {
  const parser = new SseParser();
  const events: SseEvent[] = [];
  let comments = 0;
  for (const c of chunks) {
    const r = parser.push(c);
    events.push(...r.events);
    comments += r.comments;
  }
  return { events, comments };
}

const STATUS = JSON.stringify({ connected: true, sim_name: "MSFS 2024", phase: "ground" });
const STREAM =
  `event: status\ndata: ${STATUS}\n\n` +
  `: ping\n\n` +
  `event: hop\ndata: {"id":7}\n\n` +
  `event: status\r\ndata: {"connected":false}\r\n\r\n`;
const EXPECTED: SseEvent[] = [
  { event: "status", data: STATUS },
  { event: "hop", data: '{"id":7}' },
  { event: "status", data: '{"connected":false}' },
];

describe("the event stream's text", () => {
  // @spec DESK-SHELL-SRV-017
  it("gives a named event with its data once a blank line ends it", () => {
    const parser = new SseParser();
    expect(parser.push(`event: status\ndata: ${STATUS}\n`)).toEqual({ events: [], comments: 0 });
    expect(parser.push("\n")).toEqual({ events: [{ event: "status", data: STATUS }], comments: 0 });
  });

  // @spec DESK-SHELL-SRV-017
  it("gives the same events and comments however the stream is split into chunks", () => {
    expect(feed([STREAM])).toEqual({ events: EXPECTED, comments: 1 });
    for (let i = 0; i <= STREAM.length; i++) {
      expect(feed([STREAM.slice(0, i), STREAM.slice(i)])).toEqual({ events: EXPECTED, comments: 1 });
    }
    expect(feed([...STREAM])).toEqual({ events: EXPECTED, comments: 1 });
  });

  // @spec DESK-SHELL-SRV-017
  it("removes the \\r of CRLF line ends, also when the \\r and \\n arrive in different chunks", () => {
    expect(feed(["event: status\r\ndata: x\r\n\r\n"]).events).toEqual([{ event: "status", data: "x" }]);
    expect(feed(["event: status\r", "\ndata: x\r", "\n\r", "\n"]).events).toEqual([{ event: "status", data: "x" }]);
  });

  // @spec DESK-SHELL-SRV-027
  it("counts comment lines, the keep-alive ping among them, in the push that completes them", () => {
    const parser = new SseParser();
    expect(parser.push(": pi")).toEqual({ events: [], comments: 0 });
    expect(parser.push("ng\n")).toEqual({ events: [], comments: 1 });
    expect(parser.push("\n")).toEqual({ events: [], comments: 0 });
    expect(parser.push(": one\n: two\n\nevent: status\ndata: 1\n\n")).toEqual({
      events: [{ event: "status", data: "1" }],
      comments: 2,
    });
  });

  // @spec DESK-SHELL-SRV-017
  it("joins several data lines with \\n", () => {
    expect(feed(["event: status\ndata: first\ndata: second\ndata: third\n\n"]).events).toEqual([
      { event: "status", data: "first\nsecond\nthird" },
    ]);
  });

  // @spec DESK-SHELL-SRV-017
  it("names an event without an event: line message, and starts each event's name afresh", () => {
    expect(feed(["data: 1\n\n"]).events).toEqual([{ event: "message", data: "1" }]);
    expect(feed(["event: hop\ndata: 1\n\ndata: 2\n\n"]).events).toEqual([
      { event: "hop", data: "1" },
      { event: "message", data: "2" },
    ]);
  });

  // @spec DESK-SHELL-SRV-017
  it("drops exactly one space after the colon", () => {
    expect(feed(["event:status\ndata:x\n\n"]).events).toEqual([{ event: "status", data: "x" }]);
    expect(feed(["event: status\ndata:  x\n\n"]).events).toEqual([{ event: "status", data: " x" }]);
  });

  // @spec DESK-SHELL-SRV-017
  it("dispatches nothing for an event with no data, or for blank lines alone", () => {
    expect(feed(["event: status\n\n"]).events).toEqual([]);
    expect(feed(["\n\n\n"]).events).toEqual([]);
  });

  // @spec DESK-SHELL-SRV-017
  it("holds an unfinished event until its blank line arrives", () => {
    const parser = new SseParser();
    expect(parser.push("event: status\nda").events).toEqual([]);
    expect(parser.push("ta: {}\n").events).toEqual([]);
    expect(parser.push("\nevent: hop").events).toEqual([{ event: "status", data: "{}" }]);
  });
});
