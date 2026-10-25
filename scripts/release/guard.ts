/**
 * The installer round trip's guard: it seeds and installs over the real data folder and backups folder,
 * so it runs only on the release workflow's clean GitHub-hosted runner, asked for by that workflow.
 */

export const ROUND_TRIP_REFUSED =
  "The installer round trip runs only in the release workflow on a GitHub-hosted runner: it seeds and installs over the real data folder, %LOCALAPPDATA%\\MSFS Career Map, and the real backups folder, so a run here could overwrite the logbook. Nothing was touched.";

// @spec DESK-DIST-TRIP-001, DESK-DIST-TRIP-007
export function roundTripAllowed(env: NodeJS.ProcessEnv): boolean {
  return (
    env.GITHUB_ACTIONS === "true" &&
    env.RUNNER_ENVIRONMENT === "github-hosted" &&
    (env.GITHUB_WORKFLOW_REF ?? "").includes("/.github/workflows/release.yml@") &&
    env.CAREER_MAP_ROUND_TRIP === "release-workflow"
  );
}
