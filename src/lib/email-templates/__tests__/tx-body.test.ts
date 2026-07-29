import { describe, expect, it } from "vitest";

import { txBody } from "../tx-body";

const vars = {
  planName: "NES Pro",
  previousPlanName: "NES Plus",
  amount: "199,00 zł",
  interval: "miesięcznie",
  renewsAt: "12 sierpnia 2026",
  accessUntil: "12 sierpnia 2026",
  retryAt: "3 sierpnia 2026",
  graceDays: 14,
  prorationAmount: "64,00 zł",
};

describe("txBody", () => {
  it("wstawia zmienne personalizacji do treści zakupu", () => {
    const body = txBody("subscription_confirmed", "pl", "female", vars);
    expect(body.intro).toContain("NES Pro");
    expect(body.intro).toContain("199,00 zł");
    expect(body.intro).toContain("12 sierpnia 2026");
  });

  it("odmienia treść przez rodzaj gramatyczny", () => {
    const male = txBody("subscription_confirmed", "pl", "male", vars).extra ?? "";
    const female = txBody("subscription_confirmed", "pl", "female", vars).extra ?? "";
    const neutral = txBody("subscription_confirmed", "pl", "unknown", vars).extra ?? "";
    expect(male).toContain("otrzymałeś");
    expect(female).toContain("otrzymałaś");
    expect(neutral).not.toMatch(/otrzymałeś|otrzymałaś/);
  });

  it("pokazuje proratę przy upgrade i karencję przy nieudanej płatności", () => {
    expect(txBody("subscription_upgraded", "pl", "male", vars).intro).toContain("64,00 zł");
    const failed = txBody("payment_failed", "pl", "unknown", vars);
    expect(failed.intro).toContain("3 sierpnia 2026");
    expect(failed.extra).toContain("14 dni karencji");
  });

  it("nie odmienia przez płeć w wersji angielskiej", () => {
    const en = txBody("subscription_canceled", "en", "female", vars);
    expect(en.intro).toContain("NES Pro");
    expect(en.intro).toContain("12 sierpnia 2026");
  });
});
