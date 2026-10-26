/**
 * The aircraft form and the performance table (src/client/components/AircraftForm.tsx): the type hint
 * naming a type from SimBrief's list or the table and offering **Fill from table** and **Sources** for a
 * type the table holds (FLEET-SIM-004, FLEET-TYPE-012); filling — researched numbers replacing the
 * fields, class figures only filling blank ones, pressurised only ticked, only a built-in icon changed,
 * nothing else touched and nothing saved (FLEET-TYPE-013, 014); an entry that arrives late or not at all
 * (FLEET-TYPE-015); the note saying what was filled (FLEET-TYPE-016); and the Sources panel
 * (FLEET-TYPE-017).
 *
 * Each test loads the form afresh (`vi.resetModules`), since the page fetches SimBrief's list and the
 * table's list once per page load and keeps them; the server is answered through the fetch guard.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Aircraft } from "../../src/client/types.ts";
import { answerFetch } from "../support/fetch-guard.ts";
import { aircraft } from "../support/page-data.ts";

type Reply = Response | Promise<Response>;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const SIMBRIEF_LIST = {
  types: [
    { id: "B738", name: "737-800" },
    { id: "C172", name: "Cessna 172" },
    { id: "C208", name: "Cessna 208 Caravan" },
    { id: "QQ01", name: "Only in SimBrief's list" },
  ],
  source: "simbrief",
  fetched_at: "2026-10-25T12:00:00.000Z",
};

const TABLE_LIST = {
  snapshot: "2026-10-25",
  types: [
    { type: "B738", name: "737-800", variant: "737-800 with winglets, CFM56-7B26" },
    { type: "C208", name: "Cessna 208 Caravan", variant: "208B Grand Caravan EX, PT6A-140" },
    { type: "XB70", name: "Table-only type", variant: "XB-70A" },
  ],
};

const B738 = {
  type: "B738",
  name: "737-800",
  variant: "737-800 with winglets, CFM56-7B26",
  preset: "Airliner",
  icon: "airliner",
  researched: "2026-10-26",
  checked: "2026-10-27",
  sources: [
    { id: "acap", title: "737 Airplane Characteristics for Airport Planning", publisher: "Boeing", page: "§3.3.1, §3.4.1", url: "https://www.boeing.com/acaps/737.pdf" },
    { id: "tcds", title: "Type Certificate Data Sheet A16WE", publisher: "FAA", page: "Model 737-800", url: "https://drs.faa.gov/A16WE.pdf" },
    { id: "fctm", title: "737 Flight Crew Training Manual", publisher: "Boeing", page: "Crosswind guidelines", url: "https://www.boeing.com/fctm/737.pdf" },
  ],
  pressurised: { value: true, kind: "published", sources: ["tcds"] },
  values: {
    cruise_kts: { value: 455, kind: "derived", sources: ["acap"], calculation: "M0.785 at FL350, ISA: 452.5 kt, to the nearest 5 kt" },
    min_runway_ft: { value: 7600, kind: "derived", sources: ["acap"], calculation: "takeoff at 72,689 kg: 7,520 ft, up to the next 100 ft" },
    ceiling_ft: { value: 41000, kind: "published", sources: ["tcds"] },
    max_xwind_kts: { value: 33, kind: "published", sources: ["fctm"] },
    cruise_alt_ft: { value: 35000, kind: "published", sources: ["acap"], note: "typical initial cruise" },
    climb_fpm: { value: 2000, kind: "preset" },
    climb_kts: { value: 275, kind: "preset" },
    descent_fpm: { value: 2000, kind: "preset" },
  },
};

const C208 = {
  type: "C208",
  name: "Cessna 208 Caravan",
  variant: "208B Grand Caravan EX, PT6A-140",
  preset: "Turboprop",
  icon: "high-wing",
  researched: "2026-10-26",
  checked: "2026-10-27",
  sources: [{ id: "spec", title: "Grand Caravan EX specification", publisher: "Textron Aviation", page: "Performance", url: "https://cessna.txtav.com/grand-caravan-ex" }],
  pressurised: { value: false, kind: "published", sources: ["spec"] },
  values: {
    cruise_kts: { value: 195, kind: "published", sources: ["spec"] },
    min_runway_ft: { value: 2500, kind: "published", sources: ["spec"] },
    ceiling_ft: { value: 25000, kind: "published", sources: ["spec"] },
    max_xwind_kts: null,
    cruise_alt_ft: { value: 12000, kind: "preset" },
    climb_fpm: { value: 1500, kind: "preset" },
    climb_kts: { value: 115, kind: "preset" },
    descent_fpm: { value: 1500, kind: "preset" },
  },
};

const ENTRIES: Record<string, unknown> = { B738, C208 };

/** Answers SimBrief's list, the table's list and its entries; `table` and `entry` replace the defaults. */
function answerServer(o: { table?: () => Reply; entry?: (type: string) => Reply } = {}): void {
  answerFetch("/api/simbrief/aircraft", () => json(SIMBRIEF_LIST));
  answerFetch("/api/aircraft-types", o.table ?? (() => json(TABLE_LIST)));
  answerFetch(/\/api\/aircraft-types\/[^/]+$/, (url) => {
    const type = decodeURIComponent(url.pathname.split("/").pop()!);
    if (o.entry) return o.entry(type);
    return ENTRIES[type] ? json(ENTRIES[type]) : json({ error: "not in the performance table" }, 404);
  });
}

/** The bodies the form posts or puts to /api/aircraft, answered as saved with id 9. */
function answerSaves(): unknown[] {
  const bodies: unknown[] = [];
  answerFetch(/\/api\/aircraft(\/\d+)?$/, (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    bodies.push(body);
    return json(aircraft({ ...body, id: 9 }));
  });
  return bodies;
}

async function renderForm(o: { initial?: Aircraft } = {}) {
  vi.resetModules();
  const { AircraftForm } = await import("../../src/client/components/AircraftForm.tsx");
  const onSaved = vi.fn(async () => {});
  render(<AircraftForm initial={o.initial} usedColors={[]} onSaved={onSaved} onCancel={() => {}} />);
  // SimBrief's list in place of the form's own common types (QQ01 is only in SimBrief's).
  await waitFor(() => expect(document.querySelector("#simbrief-types option[value='QQ01']")).not.toBeNull());
  return { onSaved };
}

const field = (label: RegExp | string) => screen.getByLabelText(label) as HTMLInputElement;
const typeField = () => field(/SimBrief aircraft type/);
const hintText = () => typeField().closest("label")!.querySelector(".hint")!.textContent;
const fillButton = () => screen.queryByRole("button", { name: "Fill from table" });
const sourcesButton = () => screen.queryByRole("button", { name: "Sources" });

const NUMBERS = {
  cruise: /^Cruise speed, kts/,
  runway: /^Min runway, ft/,
  ceiling: /^Service ceiling, ft/,
  xwind: /^Max crosswind, kt/,
  alt: "Typical cruise altitude, ft",
  climb: "Climb rate, fpm",
  climbKts: "Climb speed, kts",
  descent: "Descent rate, fpm",
  overhead: "Taxi + approach, min",
} as const;
type NumberKey = keyof typeof NUMBERS;
const value = (k: NumberKey) => field(NUMBERS[k]).value;
const type = (k: NumberKey, v: string) => fireEvent.change(field(NUMBERS[k]), { target: { value: v } });
const values = () => Object.fromEntries((Object.keys(NUMBERS) as NumberKey[]).map((k) => [k, value(k)]));

const oxygen = () => field(/Pressurised \/ has oxygen/);
const iconOn = (label: string) => screen.getByTitle(label).classList.contains("on");

async function chooseType(t: string): Promise<void> {
  fireEvent.change(typeField(), { target: { value: t } });
}

/** Types `t` and waits for **Fill from table**. */
async function chooseTableType(t: string): Promise<void> {
  await chooseType(t);
  await screen.findByRole("button", { name: "Fill from table" });
}

async function fill(): Promise<void> {
  fireEvent.click(fillButton()!);
  await screen.findByText(/^Filled \d+ values? from /);
}

afterEach(() => vi.restoreAllMocks());

describe("the type hint", () => {
  // @spec FLEET-SIM-004, FLEET-TYPE-012
  it("names a type from SimBrief's list, else from the table, offering Fill from table and Sources only for a type the table holds", async () => {
    answerServer();
    await renderForm();
    await chooseTableType("B738");
    expect(hintText()).toContain("737-800");
    expect(sourcesButton()).not.toBeNull();

    await chooseType("C172");
    await waitFor(() => expect(hintText()).toContain("Cessna 172"));
    expect(fillButton()).toBeNull();
    expect(sourcesButton()).toBeNull();

    await chooseTableType("XB70");
    expect(hintText()).toContain("Table-only type");
    expect(hintText()).not.toContain("Not in SimBrief's list");

    await chooseType("ZZZZ");
    await waitFor(() => expect(hintText()).toContain("Not in SimBrief's list (it may still accept it)"));
    expect(fillButton()).toBeNull();
    expect(sourcesButton()).toBeNull();
  });

  // @spec FLEET-TYPE-012
  it("matches the type upper-cased and trimmed", async () => {
    answerServer();
    await renderForm();
    await chooseTableType(" b738");
    expect(hintText()).toContain("737-800");
  });

  // @spec FLEET-TYPE-012
  it("offers neither while the table's list is loading", async () => {
    answerServer({ table: () => new Promise<Response>(() => {}) });
    await renderForm();
    await chooseType("B738");
    await waitFor(() => expect(hintText()).toContain("737-800"));
    expect(fillButton()).toBeNull();
    expect(sourcesButton()).toBeNull();
  });

  // @spec FLEET-TYPE-012, FLEET-SIM-004
  it("offers neither when the table's list could not be loaded, and works as before", async () => {
    answerServer({ table: () => json({ error: "boom" }, 500) });
    await renderForm();
    await chooseType("B738");
    await waitFor(() => expect(hintText()).toContain("737-800"));
    await act(async () => {});
    expect(fillButton()).toBeNull();
    expect(sourcesButton()).toBeNull();
    await chooseType("XB70");
    await waitFor(() => expect(hintText()).toContain("Not in SimBrief's list (it may still accept it)"));
  });
});

describe("filling from the table", () => {
  // @spec FLEET-TYPE-013, FLEET-TYPE-014, FLEET-TYPE-016
  it("fills a blank form with every number, the preset's taxi + approach, pressurised and the icon, saving nothing", async () => {
    answerServer();
    const saves = answerSaves();
    await renderForm();
    await chooseTableType("B738");
    await fill();
    expect(values()).toEqual({
      cruise: "455",
      runway: "7600",
      ceiling: "41000",
      xwind: "33",
      alt: "35000",
      climb: "2000",
      climbKts: "275",
      descent: "2000",
      overhead: "20",
    });
    expect(screen.getByText("Filled 9 values from 737-800")).toBeTruthy();
    expect(oxygen().checked).toBe(true);
    expect(iconOn("Airliner")).toBe(true);
    expect(saves).toEqual([]);

    fireEvent.change(field("Aircraft"), { target: { value: "PMDG 737-800" } });
    fireEvent.click(screen.getByRole("button", { name: "Add aircraft" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({
      name: "PMDG 737-800",
      icon: "builtin:airliner",
      oxygen: true,
      simbrief_type: "B738",
      cruise_kts: 455,
      min_runway_ft: 7600,
      ceiling_ft: 41000,
      max_xwind_kts: 33,
      cruise_alt_ft: 35000,
      climb_fpm: 2000,
      climb_kts: 275,
      descent_fpm: 2000,
      overhead_min: 20,
    });
  });

  // @spec FLEET-TYPE-013, FLEET-TYPE-016
  it("replaces the pilot's figures with researched ones, but fills class figures and taxi + approach only into blank fields", async () => {
    answerServer();
    await renderForm();
    type("cruise", "440");
    type("runway", "9000");
    type("climb", "1800");
    type("overhead", "25");
    await chooseTableType("B738");
    await fill();
    expect(values()).toEqual({
      cruise: "455",
      runway: "7600",
      ceiling: "41000",
      xwind: "33",
      alt: "35000",
      climb: "1800",
      climbKts: "275",
      descent: "2000",
      overhead: "25",
    });
    expect(screen.getByText("Filled 7 values from 737-800")).toBeTruthy();
  });

  // @spec FLEET-TYPE-013, FLEET-TYPE-014
  it("leaves a field the entry leaves blank as it is, and never unticks pressurised", async () => {
    answerServer();
    await renderForm({ initial: aircraft({ id: 4, oxygen: 1, max_xwind_kts: 20, simbrief_type: null }) });
    await chooseTableType("C208");
    await fill();
    expect(value("xwind")).toBe("20");
    expect(oxygen().checked).toBe(true);
  });

  // @spec FLEET-TYPE-014
  it("leaves pressurised unticked for an unpressurised type", async () => {
    answerServer();
    await renderForm();
    await chooseTableType("C208");
    await fill();
    expect(oxygen().checked).toBe(false);
  });

  // @spec FLEET-TYPE-014
  it("changes a built-in icon, the new aircraft's default among them, but keeps a URL or uploaded icon", async () => {
    answerServer();
    await renderForm({ initial: aircraft({ id: 4, icon: "builtin:twin-piston" }) });
    await chooseTableType("C208");
    await fill();
    expect(iconOn("Single piston (high wing)")).toBe(true);
  });

  // @spec FLEET-TYPE-014
  it("keeps an image URL icon", async () => {
    answerServer();
    const saves = answerSaves();
    await renderForm({ initial: aircraft({ id: 4, icon: "https://images.example.com/caravan.png" }) });
    await chooseTableType("C208");
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Save aircraft" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ icon: "https://images.example.com/caravan.png" });
  });

  // @spec FLEET-TYPE-014
  it("keeps an uploaded icon", async () => {
    answerServer();
    const saves = answerSaves();
    await renderForm({ initial: aircraft({ id: 4, icon: "/images/aircraft-4.png?v=1730000000000" }) });
    await chooseTableType("C208");
    await fill();
    fireEvent.click(screen.getByRole("button", { name: "Save aircraft" }));
    await waitFor(() => expect(saves).toHaveLength(1));
    expect(saves[0]).toMatchObject({ icon: "/images/aircraft-4.png?v=1730000000000" });
  });

  // @spec FLEET-TYPE-014
  it("keeps an image file picked but not yet uploaded", async () => {
    answerServer();
    const saves = answerSaves();
    const uploads: unknown[] = [];
    answerFetch(/\/api\/aircraft\/9\/icon$/, (_url, init) => {
      uploads.push(JSON.parse(String(init?.body)));
      return json(aircraft({ id: 9, icon: "/images/aircraft-9.png?v=1" }));
    });
    await renderForm();
    const png = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "caravan.png", { type: "image/png" });
    fireEvent.change(field(/or upload an image/), { target: { files: [png] } });
    await waitFor(() => expect(document.querySelector(".plane-head img")).not.toBeNull());
    await chooseTableType("C208");
    await fill();
    expect(document.querySelector(".plane-head img")).not.toBeNull();
    fireEvent.change(field("Aircraft"), { target: { value: "Caravan" } });
    fireEvent.click(screen.getByRole("button", { name: "Add aircraft" }));
    await waitFor(() => expect(uploads).toHaveLength(1));
    expect(saves[0]).toMatchObject({ icon: "builtin:twin-piston" });
  });

  // @spec FLEET-TYPE-014
  it("leaves IFR capable, the name, livery, notes, SimBrief type and sim binding as they are", async () => {
    answerServer();
    await renderForm({
      initial: aircraft({
        id: 4,
        name: "Blackhawk Caravan",
        livery: "N208BH",
        notes: "float kit",
        ifr_capable: 0,
        sim_title: "Cessna 208B Grand Caravan EX",
        sim_livery: "Blue",
      }),
    });
    await chooseTableType("C208");
    await fill();
    expect(field("Aircraft").value).toBe("Blackhawk Caravan");
    expect(field("Livery / registration").value).toBe("N208BH");
    expect(field("Notes").value).toBe("float kit");
    expect(field(/IFR capable/).checked).toBe(false);
    expect(typeField().value).toBe("C208");
    expect(field(/Sim aircraft title/).value).toBe("Cessna 208B Grand Caravan EX");
    expect(field(/Sim livery/).value).toBe("Blue");
  });
});

describe("an entry late or missing", () => {
  // @spec FLEET-TYPE-013
  it("keeps a figure typed while the entry was on its way from being replaced by a class figure", async () => {
    let release!: () => void;
    answerServer({
      entry: (t) => (t === "B738" ? new Promise<Response>((resolve) => (release = () => resolve(json(B738)))) : json({ error: "not in the performance table" }, 404)),
    });
    await renderForm();
    await chooseTableType("B738");
    fireEvent.click(fillButton()!);
    type("climb", "1800");
    await act(async () => release());
    await act(async () => {});
    expect(value("climb")).toBe("1800");
    expect(value("cruise")).toBe("455");
  });

  // @spec FLEET-TYPE-015
  it("fills nothing from an entry that arrives after the type has changed", async () => {
    let release!: () => void;
    answerServer({
      entry: (t) =>
        t === "B738" ? new Promise<Response>((resolve) => (release = () => resolve(json(B738)))) : json(ENTRIES[t] ?? { error: "not in the performance table" }, ENTRIES[t] ? 200 : 404),
    });
    await renderForm();
    await chooseTableType("B738");
    fireEvent.click(fillButton()!);
    await chooseTableType("C208");
    await act(async () => release());
    await act(async () => {});
    expect(value("cruise")).toBe("");
    expect(value("ceiling")).toBe("");
    expect(screen.queryByText(/^Filled /)).toBeNull();
  });

  // @spec FLEET-TYPE-015
  it("fills nothing and says so when the entry cannot be fetched", async () => {
    answerServer({ entry: () => json({ error: "boom" }, 500) });
    await renderForm();
    await chooseTableType("B738");
    fireEvent.click(fillButton()!);
    await screen.findByText("Couldn't load the performance table entry.");
    expect(values()).toEqual({ cruise: "", runway: "", ceiling: "", xwind: "", alt: "", climb: "", climbKts: "", descent: "", overhead: "" });
    expect(screen.queryByText(/^Filled /)).toBeNull();
  });
});

describe("the note", () => {
  // @spec FLEET-TYPE-016
  it("stays while the pilot edits, a filled climb speed not reworked from a new cruise speed, until the next fill", async () => {
    answerServer();
    await renderForm();
    await chooseTableType("B738");
    await fill();
    type("cruise", "500");
    expect(value("climbKts")).toBe("275");
    expect(screen.getByText("Filled 9 values from 737-800")).toBeTruthy();

    await chooseTableType("C208");
    fireEvent.click(fillButton()!);
    // Cruise, runway and ceiling are researched and replace; crosswind is blank in the entry; the
    // class figures find their fields already filled.
    await screen.findByText("Filled 3 values from Cessna 208 Caravan");
    expect(screen.queryByText("Filled 9 values from 737-800")).toBeNull();
  });
});

describe("the Sources panel", () => {
  // @spec FLEET-TYPE-017
  it("shows the entry's variant, dates and each value's provenance, filling nothing", async () => {
    answerServer();
    await renderForm();
    await chooseTableType("B738");
    fireEvent.click(sourcesButton()!);
    const panel = await screen.findByRole("region", { name: "Sources for 737-800" });
    const text = panel.textContent ?? "";
    expect(text).toContain("737-800 with winglets, CFM56-7B26");
    expect(text).toContain("Researched 2026-10-26 · checked 2026-10-27");
    // Published: the source's title, publisher and page, linked.
    expect(text).toContain("Service ceiling");
    expect(text).toContain("41000");
    expect(text).toContain("FAA");
    expect(text).toContain("Model 737-800");
    const tcds = within(panel).getAllByRole("link", { name: "Type Certificate Data Sheet A16WE" })[0];
    expect(tcds.getAttribute("href")).toBe("https://drs.faa.gov/A16WE.pdf");
    expect(tcds.getAttribute("target")).toBe("_blank");
    expect(tcds.getAttribute("rel")).toContain("noopener");
    // Derived: the calculation as well.
    expect(text).toContain("Calculation: M0.785 at FL350, ISA: 452.5 kt, to the nearest 5 kt");
    // Preset: said as such.
    expect(text).toContain("class preset (Airliner)");
    // A note.
    expect(text).toContain("typical initial cruise");
    // Nothing filled.
    expect(value("cruise")).toBe("");
    expect(screen.queryByText(/^Filled /)).toBeNull();

    fireEvent.click(sourcesButton()!);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Sources for 737-800" })).toBeNull());
  });

  // @spec FLEET-TYPE-017
  it("is there in a saved aircraft's form for its type", async () => {
    answerServer();
    await renderForm({ initial: aircraft({ id: 4, simbrief_type: "B738", cruise_kts: 450 }) });
    await screen.findByRole("button", { name: "Sources" });
    fireEvent.click(sourcesButton()!);
    await screen.findByRole("region", { name: "Sources for 737-800" });
    expect(value("cruise")).toBe("450");
  });
});
