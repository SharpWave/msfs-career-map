/** One event of a server-sent event stream: its name (`message` when none was given) and its data. */
export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Reads a server-sent event stream from raw text. Lines end at `\n` (a `\r` before it removed) and
 * may span chunks; a line starting `:` is a comment; a blank line dispatches the event gathered so far.
 */
// @spec DESK-SHELL-SRV-017, DESK-SHELL-SRV-027
export class SseParser {
  private partial = "";
  private name: string | null = null;
  private data: string[] = [];

  /** Returns the events this chunk completed and the comment lines it held. */
  push(chunk: string): { events: SseEvent[]; comments: number } {
    const events: SseEvent[] = [];
    let comments = 0;
    const lines = (this.partial + chunk).split("\n");
    this.partial = lines.pop() ?? "";
    for (const raw of lines) {
      const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
      if (line === "") {
        if (this.data.length > 0) events.push({ event: this.name ?? "message", data: this.data.join("\n") });
        this.name = null;
        this.data = [];
      } else if (line.startsWith(":")) {
        comments++;
      } else {
        this.field(line);
      }
    }
    return { events, comments };
  }

  private field(line: string): void {
    const colon = line.indexOf(":");
    const name = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (name === "event") this.name = value;
    else if (name === "data") this.data.push(value);
  }
}
