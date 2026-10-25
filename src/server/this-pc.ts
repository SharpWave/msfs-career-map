import os from "node:os";

/**
 * Whether a host name or address names this PC, without asking DNS: loopback, this PC's own name
 * (bare or with a domain after it), or an address one of its network interfaces lists. Used for the
 * tracker status's `sim_host`, which is null for a sim on this PC.
 */

/** An IPv4 address in 127.0.0.0/8. */
function isLoopbackV4(h: string): boolean {
  const m = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  return m != null && m.slice(1).every((o) => Number(o) <= 255);
}

/** An address without its IPv6 zone (`fe80::1%7`), lower-cased. */
const bareAddress = (a: string) => (a.includes(":") ? a.split("%")[0] : a).toLowerCase();

// @spec LIVE-API-013
export function isThisPc(host: string): boolean {
  let h = host.trim().toLowerCase();
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1);
  if (h === "localhost" || h === "::1" || isLoopbackV4(h)) return true;

  const name = os.hostname().toLowerCase();
  if (name && (h === name || h.startsWith(`${name}.`))) return true;

  const addr = bareAddress(h);
  return Object.values(os.networkInterfaces()).some((list) => (list ?? []).some((a) => bareAddress(a.address) === addr));
}
