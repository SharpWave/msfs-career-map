/**
 * The airport list files: their download times (APT-DATA-018) and bounded downloads under temporary
 * names (APT-DATA-019), with the server's User-Agent (APP-API-005).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  AIRPORTS_URL,
  DOWNLOAD_IDLE_MS,
  DOWNLOAD_TOTAL_MS,
  DownloadFailed,
  downloadList,
  readDownloadTime,
  writeDownloadTime,
} from "../../src/server/airport-data.ts";
import { USER_AGENT } from "../../src/server/version.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { emptyFolder, fixtureText, listResponse, stalledResponse, streamResponse, tricklingResponse, userAgentOf } from "../support/airport-lists.ts";

const NOW = new Date("2026-10-25T12:00:00Z");

/** A list file with a last-modified time of its own. */
function listAt(mtime: Date): string {
  const file = path.join(emptyFolder(), "airports.csv");
  fs.writeFileSync(file, "x\n");
  fs.utimesSync(file, mtime, mtime);
  return file;
}

describe("download times (APT-DATA-018)", () => {
  const MTIME = new Date("2026-03-01T08:00:00Z");

  // @spec APT-DATA-018
  it("reads the time in <list>.downloaded, with seconds or with fractions, whitespace around it ignored", () => {
    const file = listAt(MTIME);
    for (const [text, iso] of [
      ["2026-10-23T14:05:00Z", "2026-10-23T14:05:00.000Z"],
      ["2026-10-23T14:05:00.123Z", "2026-10-23T14:05:00.123Z"],
      ["  2026-10-23T14:05:07Z\r\n", "2026-10-23T14:05:07.000Z"],
    ]) {
      fs.writeFileSync(`${file}.downloaded`, text);
      expect(readDownloadTime(file, NOW).toISOString(), JSON.stringify(text)).toBe(iso);
    }
  });

  // @spec APT-DATA-018
  it("takes the list's own last-modified time when there is no such file, when it holds anything else, or a time later than now", () => {
    const file = listAt(MTIME);
    expect(readDownloadTime(file, NOW).getTime()).toBe(MTIME.getTime());
    for (const text of ["", "yesterday", "2026-10-23", "2026-10-23T14:05Z", "2026-10-23T14:05:00", "2026-10-23T14:05:00+00:00", "2026-13-45T99:99:99Z", "2026-10-25T12:00:01Z"]) {
      fs.writeFileSync(`${file}.downloaded`, text);
      expect(readDownloadTime(file, NOW).getTime(), JSON.stringify(text)).toBe(MTIME.getTime());
    }
    // Now itself is not later than now.
    fs.writeFileSync(`${file}.downloaded`, "2026-10-25T12:00:00Z");
    expect(readDownloadTime(file, NOW).getTime()).toBe(NOW.getTime());
  });

  // @spec APT-DATA-018
  it("writes the time as ISO 8601 UTC ending in Z, beside the list, leaving no temporary file", () => {
    const file = listAt(MTIME);
    writeDownloadTime(file, new Date("2026-10-23T14:05:00.250Z"));
    expect(fs.readFileSync(`${file}.downloaded`, "utf8").trim()).toBe("2026-10-23T14:05:00.250Z");
    expect(readDownloadTime(file, NOW).toISOString()).toBe("2026-10-23T14:05:00.250Z");
    expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(["airports.csv", "airports.csv.downloaded"]);
  });
});

describe("downloads (APT-DATA-019)", () => {
  const dest = () => path.join(emptyFolder(), "airports.csv.partial");

  // @spec APT-DATA-019
  it("gives up after 60 s with no data or 10 minutes in all, by default", () => {
    expect(DOWNLOAD_IDLE_MS).toBe(60_000);
    expect(DOWNLOAD_TOTAL_MS).toBe(600_000);
  });

  // @spec APT-DATA-019, APP-API-005
  it("streams the list into the name it is given, sending the server's User-Agent", async () => {
    let agent: string | null = null;
    answerFetch(AIRPORTS_URL, (_u, init) => {
      agent = userAgentOf(init);
      return listResponse(fixtureText("airports"), init);
    });
    const file = dest();
    await downloadList(AIRPORTS_URL, file);
    expect(fs.readFileSync(file, "utf8")).toBe(fixtureText("airports"));
    expect(agent).toBe(USER_AGENT);
  });

  // @spec APT-DATA-019
  it("fails naming the HTTP status, and leaves no file", async () => {
    answerFetch(AIRPORTS_URL, () => new Response("nope", { status: 503, statusText: "Service Unavailable" }));
    const file = dest();
    const err = await downloadList(AIRPORTS_URL, file).catch((e) => e);
    expect(err).toBeInstanceOf(DownloadFailed);
    expect(err.message).toBe("download of airports.csv failed: HTTP 503 Service Unavailable");
    expect(fs.existsSync(file)).toBe(false);
  });

  // @spec APT-DATA-019
  it("fails a download that receives no data for the idle time, and leaves no file", async () => {
    answerFetch(AIRPORTS_URL, (_u, init) => stalledResponse(init));
    const file = dest();
    const started = Date.now();
    const err = await downloadList(AIRPORTS_URL, file, { idleMs: 300, totalMs: 60_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(DownloadFailed);
    expect(err.message).toBe("download of airports.csv failed: no data for 0.3 s");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(fs.existsSync(file)).toBe(false);
  });

  // @spec APT-DATA-019
  it("fails a download that keeps trickling past the overall time, and leaves no file", async () => {
    answerFetch(AIRPORTS_URL, (_u, init) => tricklingResponse(init, 50));
    const file = dest();
    const started = Date.now();
    const err = await downloadList(AIRPORTS_URL, file, { idleMs: 1000, totalMs: 600 }).catch((e) => e);
    expect(err).toBeInstanceOf(DownloadFailed);
    expect(err.message).toBe("download of airports.csv failed: not finished within 0.01 minutes");
    expect(Date.now() - started).toBeLessThan(3000);
    expect(fs.existsSync(file)).toBe(false);
  });

  // @spec APT-DATA-019
  it("fails on a connection that breaks part-way, with the error's message, and leaves no file", async () => {
    answerFetch(AIRPORTS_URL, (_u, init) =>
      streamResponse(init, (c) => {
        c.enqueue(new TextEncoder().encode("partial"));
        setTimeout(() => c.error(new Error("socket hang up")), 20);
      }),
    );
    const file = dest();
    const err = await downloadList(AIRPORTS_URL, file).catch((e) => e);
    expect(err).toBeInstanceOf(DownloadFailed);
    expect(err.message).toBe("download of airports.csv failed: socket hang up");
    expect(fs.existsSync(file)).toBe(false);
  });

  // @spec APT-DATA-019, APT-DATA-025
  it("stops when its signal aborts, throwing the abort and not a failure, and leaves no file", async () => {
    answerFetch(AIRPORTS_URL, (_u, init) => stalledResponse(init));
    const file = dest();
    const ac = new AbortController();
    const p = downloadList(AIRPORTS_URL, file, { signal: ac.signal }).catch((e) => e);
    await new Promise((r) => setTimeout(r, 50));
    ac.abort();
    const err = await p;
    expect(err).not.toBeInstanceOf(DownloadFailed);
    expect(err.name).toBe("AbortError");
    expect(fs.existsSync(file)).toBe(false);
  });
});
