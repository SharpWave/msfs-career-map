/**
 * The start-up list backups' names and pruning (src/desktop/start-list-backups.ts; m4 contract §3):
 * `EXE.xml.<Store|Steam>.<yyyyMMddTHHmmssZ>` and `Run.<yyyyMMddTHHmmssZ>.reg` in UTC to the second, a
 * `-2`, `-3`, … for a second one within the same second, and the five newest of each kind kept, judged
 * by the time in the name and then the suffix, only the app's own names ever deleted.
 */
import { describe, expect, it } from "vitest";
import {
  BACKUPS_FOLDER,
  KEEP,
  backupStamp,
  exeXmlBackupName,
  namesToPrune,
  regBackupName,
} from "../../../src/desktop/start-list-backups.ts";

const NOW = new Date("2026-10-25T12:03:04.567Z");

describe("the backups' names", () => {
  // @spec DESK-START-MSFS-029, DESK-START-WINDOWS-002
  it("live in the start-up list backups folder, five of each kind", () => {
    expect(BACKUPS_FOLDER).toBe("start-up list backups");
    expect(KEEP).toBe(5);
  });

  // @spec DESK-START-MSFS-029, DESK-START-WINDOWS-002
  it("stamp the UTC time to the second, ending in Z, whatever the offset the time was given in", () => {
    expect(backupStamp(NOW)).toBe("20261025T120304Z");
    expect(backupStamp(new Date("2026-10-25T14:03:04.999+02:00"))).toBe("20261025T120304Z");
    expect(backupStamp(new Date("2026-01-02T03:04:05Z"))).toBe("20260102T030405Z");
  });

  // @spec DESK-START-MSFS-029
  it("name an EXE.xml backup for its edition and the time", () => {
    expect(exeXmlBackupName("Store", NOW, [])).toBe("EXE.xml.Store.20261025T120304Z");
    expect(exeXmlBackupName("Steam", NOW, [])).toBe("EXE.xml.Steam.20261025T120304Z");
  });

  // @spec DESK-START-MSFS-029
  it("add -2, -3, … after the time for a second backup of the edition within one second", () => {
    const first = "EXE.xml.Store.20261025T120304Z";
    expect(exeXmlBackupName("Store", NOW, [first])).toBe(`${first}-2`);
    expect(exeXmlBackupName("Store", NOW, [first, `${first}-2`])).toBe(`${first}-3`);
    expect(exeXmlBackupName("Store", NOW, ["exe.xml.store.20261025t120304z"])).toBe(`${first}-2`);
  });

  // @spec DESK-START-MSFS-029
  it("give each edition its own names", () => {
    expect(exeXmlBackupName("Steam", NOW, ["EXE.xml.Store.20261025T120304Z"])).toBe("EXE.xml.Steam.20261025T120304Z");
  });

  // @spec DESK-START-WINDOWS-002
  it("name a .reg export for the time, the suffix before .reg", () => {
    expect(regBackupName(NOW, [])).toBe("Run.20261025T120304Z.reg");
    expect(regBackupName(NOW, ["Run.20261025T120304Z.reg"])).toBe("Run.20261025T120304Z-2.reg");
    expect(regBackupName(NOW, ["Run.20261025T120304Z.reg", "Run.20261025T120304Z-2.reg"])).toBe("Run.20261025T120304Z-3.reg");
    expect(regBackupName(NOW, ["run.20261025t120304z.REG"])).toBe("Run.20261025T120304Z-2.reg");
  });
});

describe("pruning", () => {
  const store = (stamp: string, suffix = "") => `EXE.xml.Store.${stamp}${suffix}`;
  const steam = (stamp: string, suffix = "") => `EXE.xml.Steam.${stamp}${suffix}`;
  const reg = (stamp: string, suffix = "") => `Run.${stamp}${suffix}.reg`;
  const sorted = (names: string[]) => [...names].sort();

  // @spec DESK-START-MSFS-030
  it("deletes nothing while five or fewer of the edition are kept", () => {
    const names = [store("20261020T000000Z"), store("20261021T000000Z"), store("20261022T000000Z"), store("20261023T000000Z"), store("20261024T000000Z")];
    expect(namesToPrune("Store", names)).toEqual([]);
  });

  // @spec DESK-START-MSFS-030
  it("keeps the five newest of the edition by the time in the name", () => {
    const names = [
      store("20261025T120000Z"),
      store("20261019T000000Z"),
      store("20261024T000000Z"),
      store("20261018T235959Z"),
      store("20261023T000000Z"),
      store("20261022T000000Z"),
      store("20261021T000000Z"),
    ];
    expect(sorted(namesToPrune("Store", names))).toEqual(sorted([store("20261019T000000Z"), store("20261018T235959Z")]));
  });

  // @spec DESK-START-MSFS-030
  it("orders backups within one second by their suffix as a number, none counting as 1", () => {
    const t = "20261025T120304Z";
    const names = [store(t, "-10"), store(t, "-2"), store(t), store(t, "-3"), store(t, "-9"), store(t, "-4"), store("20261024T000000Z")];
    expect(sorted(namesToPrune("Store", names))).toEqual(sorted([store("20261024T000000Z"), store(t)]));
  });

  // @spec DESK-START-MSFS-030
  it("counts and deletes only that edition's backups, never another's or a file not named as its own", () => {
    const names = [
      ...["20261019", "20261020", "20261021", "20261022", "20261023", "20261024"].map((d) => store(`${d}T000000Z`)),
      ...["20261001", "20261002", "20261003", "20261004", "20261005", "20261006"].map((d) => steam(`${d}T000000Z`)),
      "EXE.xml.Store.bad",
      "EXE.xml.Store.20261001T000000Z.bak",
      "EXE.xml.Store.20261001T000000",
      "EXE.xml.Xbox.20261001T000000Z",
      "notes.txt",
      reg("20261001T000000Z"),
    ];
    expect(namesToPrune("Store", names)).toEqual([store("20261019T000000Z")]);
    expect(namesToPrune("Steam", names)).toEqual([steam("20261001T000000Z")]);
  });

  // @spec DESK-START-MSFS-030
  it("knows its own names in any letter case", () => {
    const names = [
      "exe.xml.store.20261018t000000z",
      ...["20261019", "20261020", "20261021", "20261022", "20261023"].map((d) => store(`${d}T000000Z`)),
    ];
    expect(namesToPrune("Store", names)).toEqual(["exe.xml.store.20261018t000000z"]);
  });

  // @spec DESK-START-WINDOWS-002
  it("keeps the five newest .reg exports, the suffix judged after the time, nothing else deleted", () => {
    const t = "20261025T120304Z";
    const names = [
      reg("20261020T000000Z"),
      reg("20261021T000000Z"),
      reg(t),
      reg(t, "-2"),
      reg("20261022T000000Z"),
      reg("20261023T000000Z"),
      "Run.reg",
      "Run.20261001T000000Z.reg.old",
      "RunOnce.20261001T000000Z.reg",
      store("20261001T000000Z"),
    ];
    expect(sorted(namesToPrune("reg", names))).toEqual(sorted([reg("20261020T000000Z")]));
  });
});
