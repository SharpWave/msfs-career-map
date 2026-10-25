/**
 * Registers `uncaughtException` and `unhandledRejection` on target; each writes one line and never
 * rethrows, so the shell keeps running and Electron, finding a listener, shows no error box.
 */
// @spec DESK-SHELL-SRV-002
export function installErrorHandlers(target: { on(event: string, fn: (e: unknown) => void): unknown }, write: (line: string) => void): void {
  const handler = (prefix: string) => (e: unknown) => {
    try {
      write(`[shell] ${prefix}: ${describe(e)}`);
    } catch {
      // Nowhere left to write it.
    }
  };
  target.on("uncaughtException", handler("uncaught error"));
  target.on("unhandledRejection", handler("unhandled rejection"));
}

/** The error's stack, else its message, else the value as text. */
function describe(e: unknown): string {
  if (typeof e === "object" && e !== null) {
    const { stack, message } = e as { stack?: unknown; message?: unknown };
    if (typeof stack === "string" && stack !== "") return stack;
    if (typeof message === "string") return message;
  }
  try {
    return String(e);
  } catch {
    return Object.prototype.toString.call(e);
  }
}
