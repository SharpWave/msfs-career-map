/**
 * The browser tests' SimBrief alias, which the browser-test server answers with a fixed plan
 * (tests/fixtures/simbrief-e2e-ofp.json), and the fetcher address it answers.
 */
export const E2E_SIMBRIEF_ALIAS = "e2e-pilot";

/** SimBrief's fetcher for that alias, as src/server/ofp.ts asks for it. */
export const E2E_SIMBRIEF_FETCHER = `https://www.simbrief.com/api/xml.fetcher.php?username=${E2E_SIMBRIEF_ALIAS}&json=v2`;
