import type { RequestHandler } from "express";

const HOSTS = new Set(["127.0.0.1", "localhost"]);
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SAME_SITE = new Set(["same-origin", "none"]);

/** The host name of a Host header, lower-cased and without its port; "" when there is none. */
const hostName = (host: string | undefined) => (host ?? "").trim().toLowerCase().replace(/:\d*$/, "");

/**
 * The checks every request meets first, in every server, ahead of the JSON body, the icons and the
 * page: a Host other than 127.0.0.1 or localhost (another site's page reaching this PC through a
 * name that resolves to it) is refused, and so is a change another site's page asks for. A request
 * carrying neither Sec-Fetch-Site nor Origin (curl, sim-fake, the tests, the desktop shell) passes.
 */
// @spec APP-API-011, APP-API-012
export const requestChecks: RequestHandler = (req, res, next) => {
  if (!HOSTS.has(hostName(req.headers.host))) {
    res.status(403).json({ error: "refused: this server answers only 127.0.0.1 and localhost" });
    return;
  }
  if (!SAFE_METHODS.has(req.method)) {
    const site = req.headers["sec-fetch-site"];
    const origin = req.headers.origin;
    const port = req.socket.localPort;
    const foreign =
      site !== undefined
        ? !SAME_SITE.has(String(site))
        : origin !== undefined && origin !== `http://127.0.0.1:${port}` && origin !== `http://localhost:${port}`;
    if (foreign) {
      res.status(403).json({ error: "refused: a change asked for by another site" });
      return;
    }
  }
  next();
};
