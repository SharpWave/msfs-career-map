/**
 * Holding the end of the Windows session while an install over the installed copy runs
 * (build/installer-steps.nsh `${CareerMapHoldSessionEnd}`, `${CareerMapReleaseSessionEnd}`; m3 contract
 * §4.2): a hidden top-level window of the installer's own process carrying a shutdown block reason
 * (`ShutdownBlockReasonCreate`), destroyed on release. What Windows' shutdown screen then shows is
 * seen only by hand; here the test program looks at its own windows with `ShutdownBlockReasonQuery`.
 */
import { describe, expect, it } from "vitest";
import { useStandIns } from "./support/harness.ts";
import { buildProgram, run, value } from "./support/nsis.ts";

const standIns = useStandIns();

const REASON = "Installing an update to MSFS Career Map";

describe("CareerMapHoldSessionEnd and CareerMapReleaseSessionEnd", () => {
  // @spec DESK-DIST-INST-027
  it("hold the session end with a hidden window of the process's own giving the reason, and release it", async () => {
    const s = standIns();
    const exe = await buildProgram(
      s,
      "session-end",
      `  \${Out} "BEFORE"
  !insertmacro TestBlockReasons
  \${CareerMapHoldSessionEnd} "${REASON}"
  \${Out} "HELD"
  !insertmacro TestBlockReasons
  System::Call "user32::FindWindowExW(p 0, p 0, p 0, p 0) p .r1"
  StrCpy $2 0
  StrCpy $3 0
  \${DoUntil} $1 = 0
    System::Call "user32::GetWindowThreadProcessId(p r1, *i .r4) i"
    System::Call "kernel32::GetCurrentProcessId() i .r5"
    \${If} $4 = $5
      System::Call "user32::ShutdownBlockReasonQuery(p r1, w .r6, *i \${NSIS_MAX_STRLEN}) i .r7"
      \${If} $7 <> 0
        StrCpy $2 $1
        System::Call "user32::IsWindowVisible(p r1) i .r3"
      \${EndIf}
    \${EndIf}
    System::Call "user32::FindWindowExW(p 0, p r1, p 0, p 0) p .r1"
  \${Loop}
  \${Out} "visible=$3"
  \${CareerMapReleaseSessionEnd}
  \${Out} "RELEASED"
  !insertmacro TestBlockReasons
  System::Call "user32::IsWindow(p r2) i .r8"
  \${Out} "window-left=$8"`,
    );
    const { out } = await run(exe, s);
    const section = (from: string, to?: string) => out.slice(out.indexOf(from) + 1, to ? out.indexOf(to) : undefined);

    expect(value(section("BEFORE", "HELD"), "reasons")).toBe("0");
    const held = section("HELD", "RELEASED");
    expect(value(held, "reasons")).toBe("1");
    expect(value(held, "reason")).toBe(REASON);
    expect(value(held, "visible"), "the window is hidden").toBe("0");
    const released = section("RELEASED");
    expect(value(released, "reasons")).toBe("0");
    expect(value(released, "window-left"), "the window is destroyed").toBe("0");
  });
});
