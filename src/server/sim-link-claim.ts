import net from "node:net";

/**
 * The PC-wide sim-link claim: a Windows named pipe that one server on the PC listens on while its
 * link to the sim on this PC is connected. Windows lets one process listen on a pipe name and frees
 * it when that process ends, a crash included. The holder answers each check with one JSON line
 * naming who it is and its data folder, then ends the connection.
 */

export const SIM_LINK_PIPE = "\\\\.\\pipe\\msfs-career-map-sim-link";

const APP = "msfs-career-map";
/** A holder that has not answered by then counts as one that does not say who it is. */
const CHECK_MS = 1000;

/** Who holds the claim, as the holder says; both null when it does not say. */
export interface ClaimHolder {
  holder: "installed" | "source" | null;
  data_folder: string | null;
}

const UNNAMED: ClaimHolder = { holder: null, data_folder: null };

/** A holder's answer: named when it is ours, else a holder that does not say who it is. */
function readAnswer(text: string): ClaimHolder {
  let v: unknown;
  try {
    v = JSON.parse(text.split("\n")[0]);
  } catch {
    return UNNAMED;
  }
  if (typeof v !== "object" || v === null || (v as { app?: unknown }).app !== APP) return UNNAMED;
  const { holder, data_folder } = v as { holder?: unknown; data_folder?: unknown };
  return {
    holder: holder === "installed" || holder === "source" ? holder : null,
    data_folder: typeof data_folder === "string" ? data_folder : null,
  };
}

/**
 * Check the claim: null when no one holds it (no pipe by that name), else its holder. Anything but
 * an answer within CHECK_MS — an error other than the pipe missing, a connection ended or still
 * waiting with no answer — counts as held by a holder that does not say who it is.
 */
// @spec LIVE-LINK-014
export function checkClaim(pipe: string, timeoutMs = CHECK_MS): Promise<ClaimHolder | null> {
  return new Promise((resolve) => {
    let text = "";
    let done = false;
    const sock = net.connect(pipe);
    const finish = (v: ClaimHolder | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      sock.destroy();
      resolve(v);
    };
    const timer = setTimeout(() => finish(UNNAMED), timeoutMs);
    sock.setEncoding("utf8");
    sock.on("data", (d: string) => {
      text += d;
      if (text.includes("\n")) finish(readAnswer(text));
    });
    sock.on("end", () => finish(readAnswer(text)));
    sock.on("close", () => finish(readAnswer(text)));
    sock.on("error", (e: NodeJS.ErrnoException) => finish(e.code === "ENOENT" ? null : UNNAMED));
  });
}

export interface HeldClaim {
  /** Stop listening, freeing the name at once. */
  release(): void;
}

/**
 * Take the claim by listening on the pipe, answering each check with `who`. Null when it cannot be
 * taken: another process listens on the name (EADDRINUSE), or the listen failed otherwise.
 */
// @spec LIVE-LINK-010
export function takeClaim(pipe: string, who: { holder: "installed" | "source"; data_folder: string }): Promise<HeldClaim | null> {
  const line = JSON.stringify({ app: APP, holder: who.holder, data_folder: who.data_folder }) + "\n";
  return new Promise((resolve) => {
    const open = new Set<net.Socket>();
    const server = net.createServer((sock) => {
      open.add(sock);
      sock.on("close", () => open.delete(sock));
      sock.on("error", () => {});
      sock.end(line);
    });
    server.once("error", () => resolve(null));
    server.listen(pipe, () => {
      server.removeAllListeners("error");
      server.on("error", (e) => console.error("[sim] the sim-link claim's pipe failed:", e));
      let released = false;
      resolve({
        release() {
          if (released) return;
          released = true;
          for (const s of open) s.destroy();
          server.close();
        },
      });
    });
  });
}
