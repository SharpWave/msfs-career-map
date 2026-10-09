import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "../../src/client/components/ErrorBoundary.tsx";

let broken = true;
function Flaky() {
  if (broken) throw new Error("bad record");
  return <p>live card content</p>;
}

// React reports a caught render error on the console and as a window error event; the test checks
// the page instead.
const swallow = (e: ErrorEvent) => e.preventDefault();

describe("contained failures", () => {
  beforeEach(() => {
    broken = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    window.addEventListener("error", swallow);
  });
  afterEach(() => {
    window.removeEventListener("error", swallow);
    vi.restoreAllMocks();
  });

  // @spec APP-UI-005
  it("shows '<part> failed: message' with Retry in place of a part that fails, and keeps the rest of the page", () => {
    render(
      <div>
        <ErrorBoundary label="Live card">
          <Flaky />
        </ErrorBoundary>
        <p>rest of the page</p>
      </div>,
    );
    expect(screen.getByText(/Live card failed: bad record/)).toBeTruthy();
    expect(screen.getByText("rest of the page")).toBeTruthy();

    broken = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("live card content")).toBeTruthy();
    expect(screen.queryByText(/failed:/)).toBeNull();
  });
});
