import http from "node:http";
import { StringDecoder } from "node:string_decoder";
import type { HttpAnswer, LocalHttp, StreamHandle, StreamHandlers } from "./ports.ts";

/**
 * GETs to the shell's own server on 127.0.0.1, with no agent (no connection kept between asks) and
 * neither `Origin` nor `Sec-Fetch-Site`, which the server lets through as a request from no page.
 */

const HOST = "127.0.0.1";

/** The real LocalHttp over node:http. `get` never rejects; `stream` calls nothing after close(). */
export function localHttp(): LocalHttp {
  return {
    get(port: number, path: string, timeoutMs: number): Promise<HttpAnswer | null> {
      return new Promise((resolve) => {
        let settled = false;
        const settle = (a: HttpAnswer | null) => {
          if (settled) return;
          settled = true;
          resolve(a);
        };
        try {
          const req = http.get({ host: HOST, port, path, agent: false, timeout: timeoutMs }, (res) => {
            const decoder = new StringDecoder("utf8");
            let body = "";
            res.on("data", (chunk: Buffer) => {
              body += decoder.write(chunk);
            });
            res.on("end", () => settle({ status: res.statusCode ?? 0, body: body + decoder.end() }));
            res.on("error", () => settle(null));
            // A connection cut before the body's end: no answer.
            res.on("close", () => {
              if (!res.complete) settle(null);
            });
          });
          req.on("timeout", () => {
            req.destroy();
            settle(null);
          });
          req.on("error", () => settle(null));
        } catch {
          settle(null);
        }
      });
    },

    stream(port: number, path: string, h: StreamHandlers): StreamHandle {
      let closed = false;
      let ended = false;
      const end = () => {
        if (closed || ended) return;
        ended = true;
        h.onEnd();
      };
      let req: http.ClientRequest | null = null;
      try {
        req = http.get({ host: HOST, port, path, agent: false, headers: { Accept: "text/event-stream" } }, (res) => {
          if (res.statusCode !== 200) {
            res.resume();
            req?.destroy();
            end();
            return;
          }
          const decoder = new StringDecoder("utf8");
          res.on("data", (chunk: Buffer) => {
            if (closed || ended) return;
            const text = decoder.write(chunk);
            if (text !== "") h.onChunk(text);
          });
          res.on("end", end);
          res.on("close", end);
          res.on("error", end);
        });
        req.on("error", end);
        req.on("close", end);
      } catch {
        queueMicrotask(end);
      }
      return {
        close() {
          if (closed) return;
          closed = true;
          req?.destroy();
        },
      };
    },
  };
}
