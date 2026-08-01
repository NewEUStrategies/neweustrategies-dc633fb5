import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEAT_GRACE_REMINDER_DAYS,
  normalizeReminderDays,
} from "@/lib/organizations/teamSeats.server";
import { txCopy } from "@/lib/email-templates/tx-copy";
import { txBody } from "@/lib/email-templates/tx-body";

describe("harmonogram przypomnień o karencji miejsc", () => {
  it("domyślne progi to 7 i 1 dzień", () => {
    expect([...DEFAULT_SEAT_GRACE_REMINDER_DAYS]).toEqual([7, 1]);
  });

  it("normalizuje progi: bez duplikatów, malejąco, w zakresie 1-90", () => {
    expect(normalizeReminderDays([1, 7, 7, 0, -3, 200, 30.7])).toEqual([30, 7, 1]);
  });

  it("odrzuca pustą listę progów", () => {
    expect(normalizeReminderDays([0, 999])).toEqual([]);
  });

  it("ma treść przypomnienia w PL i EN", () => {
    for (const lang of ["pl", "en"] as const) {
      const copy = txCopy("team_seat_grace_reminder", lang);
      expect(copy.subject({ subject: "Acme" })).toContain("Acme");
      expect(copy.heading.length).toBeGreaterThan(0);

      const body = txBody("team_seat_grace_reminder", lang, "unknown", {
        orgName: "Acme",
        accessUntil: "5.08.2026",
        daysLeft: 1,
      });

      expect(body.intro).toContain("Acme");
    }
  });
});
