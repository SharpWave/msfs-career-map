/** Runs before each component test file. Component tests open no database and start no server. */
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { installFetchGuard, resetAnswers, takeRefused } from "./fetch-guard.ts";

delete process.env.CAREER_DB;

// @spec APP-RUN-014
installFetchGuard();
afterEach(() => {
  cleanup();
  resetAnswers();
  const refused = takeRefused();
  if (refused.length > 0) {
    throw new Error(`request(s) refused: ${refused.join(", ")} — answer them with answerFetch()`);
  }
});
