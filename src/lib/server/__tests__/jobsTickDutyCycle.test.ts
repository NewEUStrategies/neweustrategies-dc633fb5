import { describe, expect, it } from "vitest";
import { everyNthMinute } from "../jobsTick.server";

/** Bramka cyklu pracy decyduje, czy kosztowne joby biegną w danym ticku. */
describe("everyNthMinute", () => {
  const at = (minute: number) => new Date(Date.UTC(2026, 6, 29, 10, minute, 0));

  it("wpuszcza pracę na pełnych wielokrotnościach minut", () => {
    expect(everyNthMinute(5, at(0))).toBe(true);
    expect(everyNthMinute(5, at(15))).toBe(true);
    expect(everyNthMinute(15, at(45))).toBe(true);
  });

  it("pomija pozostałe minuty", () => {
    expect(everyNthMinute(5, at(3))).toBe(false);
    expect(everyNthMinute(15, at(14))).toBe(false);
  });

  it("co minutę przy n = 1", () => {
    for (let m = 0; m < 60; m += 7) expect(everyNthMinute(1, at(m))).toBe(true);
  });
});
