/**
 * The entry of the server bundled for the desktop app (and its test mode): the server in its
 * bundled form, every input from its arguments, answering the desktop shell's private channel and
 * no stop signal. Everything else is in server.ts.
 */
import { runServer } from "./server.ts";

// @spec APP-SRV-006, APP-SRV-022
await runServer("bundled", process.argv.slice(2), process.env);
