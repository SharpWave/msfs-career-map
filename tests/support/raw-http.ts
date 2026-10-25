/**
 * Requests the way a test needs them sent, not the way `fetch` sends them: `fetch` replaces any
 * `Host` header with the URL's own, and cannot leave `Host` out at all. Both go over `node:http` or
 * a plain socket, so the fetch guard (fetch-guard.ts) neither sees nor needs to allow them.
 */
import http from "node:http";
import net from "node:net";

const TIMEOUT_MS = 5000;

export interface RawAnswer {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  json(): any;
}

/** The host and port of a base such as "http://127.0.0.1:52011" or "http://[::1]:52011". */
function target(base: string): { host: string; port: number } {
  const url = new URL(base);
  return { host: url.hostname.replace(/^\[(.*)\]$/, "$1"), port: Number(url.port || 80) };
}

/**
 * One request with exactly these headers (Host included), over node:http; never through fetch,
 * which overrides Host. A `Host` left out of `headers` is Node's own, the base's host and port.
 * Node adds only its framing headers (`Content-Length` for a body, `Connection`).
 */
export function rawRequest(
  base: string,
  o: { method?: string; path: string; headers?: Record<string, string>; body?: string },
): Promise<RawAnswer> {
  const { host, port } = target(base);
  return new Promise<RawAnswer>((resolve, reject) => {
    const req = http.request(
      { host, port, method: o.method ?? "GET", path: o.path, headers: o.headers ?? {}, agent: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("error", reject);
        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body, json: () => JSON.parse(body) });
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`rawRequest: no answer from ${base}${o.path} within 5 s`)));
    req.end(o.body);
  });
}

/**
 * A request written by hand on a socket, for one without any Host header. `text` is written as it
 * is: end it with a `Connection: close` header line and a blank line, e.g.
 * "GET /api/status HTTP/1.1\r\nConnection: close\r\n\r\n". Resolves once the status line, the
 * headers and the body have arrived (`Content-Length` bytes when given, else up to the socket's
 * end), then destroys the socket; rejects after 5 s. Header names are lower-cased; a repeated
 * header's values are joined with ", ".
 */
export function rawSocketRequest(
  base: string,
  text: string,
): Promise<{ statusLine: string; headers: Record<string, string>; body: string }> {
  const { host, port } = target(base);
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buf = Buffer.alloc(0);
    let head: { statusLine: string; headers: Record<string, string>; bodyStart: number } | null = null;
    let done = false;

    const finish = (err: Error | null, body?: string) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve({ statusLine: head!.statusLine, headers: head!.headers, body: body! });
    };
    const timer = setTimeout(
      () => finish(new Error(`rawSocketRequest: no full answer from ${base} within 5 s`)),
      TIMEOUT_MS,
    );

    const tryFinish = (ended: boolean) => {
      if (!head) {
        const end = buf.indexOf("\r\n\r\n");
        if (end < 0) {
          if (ended) finish(new Error(`rawSocketRequest: the connection ended before the headers: ${JSON.stringify(buf.toString("latin1"))}`));
          return;
        }
        const lines = buf.subarray(0, end).toString("latin1").split("\r\n");
        const headers: Record<string, string> = {};
        for (const line of lines.slice(1)) {
          const i = line.indexOf(":");
          if (i < 0) continue;
          const name = line.slice(0, i).trim().toLowerCase();
          const value = line.slice(i + 1).trim();
          headers[name] = name in headers ? `${headers[name]}, ${value}` : value;
        }
        head = { statusLine: lines[0], headers, bodyStart: end + 4 };
      }
      const bodyBytes = buf.subarray(head.bodyStart);
      const length = head.headers["content-length"];
      if (length !== undefined) {
        const n = Number(length);
        if (bodyBytes.length >= n) finish(null, bodyBytes.subarray(0, n).toString("utf8"));
        else if (ended) finish(new Error(`rawSocketRequest: the connection ended after ${bodyBytes.length} of ${n} body bytes`));
      } else if (ended) {
        finish(null, bodyBytes.toString("utf8"));
      }
    };

    socket.on("connect", () => socket.write(text));
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      tryFinish(false);
    });
    socket.on("end", () => tryFinish(true));
    socket.on("close", () => tryFinish(true));
    socket.on("error", (e) => finish(e));
  });
}
