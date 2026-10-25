/**
 * The entry of a copy run from source (`npm run dev`, `npm start`): the server in its source form,
 * with no private channel and with the stop signals. Everything else is in server.ts.
 */
import { runServer } from "./server.ts";

// @spec APP-SRV-007, APP-SRV-018
await runServer("source", process.argv.slice(2), process.env);
