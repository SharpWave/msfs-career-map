import fs from "node:fs";
import type { TestProject } from "vitest/node";
import { makeRunFolder, removeLeftovers } from "./run-folder.ts";

declare module "vitest" {
  export interface ProvidedContext {
    /** The run's folder in the system's temp directory; each Node test file gets a data folder in it. */
    runDir: string;
  }
}

// @spec APP-RUN-011, APP-RUN-015
export default function setup(project: TestProject) {
  removeLeftovers();
  const runDir = makeRunFolder();
  project.provide("runDir", runDir);
  return () => {
    try {
      fs.rmSync(runDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch {
      // A file still held open: a later run deletes the folder once it is a day old.
    }
  };
}
