/**
 * Reads a server's tracker event stream (`GET /api/tracker/events`) one event at a time, for Node
 * tests running the app on a test server (startTestServer).
 */

export interface StreamEvent {
  event: string;
  data: unknown;
}

export interface EventStream {
  /** The next event, whatever its name; fails after 2 s without one. */
  next(): Promise<StreamEvent>;
  /** The data of the next event called `name`, skipping others. */
  until(name: string): Promise<unknown>;
  close(): void;
}

export async function openEvents(base: string): Promise<EventStream> {
  const ac = new AbortController();
  const res = await fetch(`${base}/api/tracker/events`, { signal: ac.signal });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const queue: StreamEvent[] = [];
  const next = async (): Promise<StreamEvent> => {
    while (queue.length === 0) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("no event within 2 s")), 2000);
      });
      try {
        const r = await Promise.race([reader.read(), timeout]);
        if (r.done) throw new Error("event stream ended");
        buf += decoder.decode(r.value, { stream: true });
      } finally {
        clearTimeout(timer);
      }
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const event = /^event: (.*)$/m.exec(block)?.[1];
        const data = /^data: (.*)$/m.exec(block)?.[1];
        if (event && data !== undefined) queue.push({ event, data: JSON.parse(data) });
      }
    }
    return queue.shift()!;
  };
  const until = async (name: string) => {
    for (;;) {
      const e = await next();
      if (e.event === name) return e.data;
    }
  };
  return { next, until, close: () => ac.abort() };
}
