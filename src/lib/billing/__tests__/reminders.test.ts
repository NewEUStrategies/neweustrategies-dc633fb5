import { describe, expect, it } from "vitest";
import { REMINDER_LEAD_DAYS, reminderSeed, reminderWindow } from "@/lib/billing/reminders.server";

describe("billing reminders", () => {
  it("okno obejmuje dokładnie dobę oddaloną o lead days", () => {
    const now = new Date("2026-07-29T10:00:00.000Z");
    const { from, to } = reminderWindow(now, 3);
    expect(from).toBe("2026-08-01T10:00:00.000Z");
    expect(to).toBe("2026-08-02T10:00:00.000Z");
  });

  it("klucz idempotencji jest stabilny w obrębie doby", () => {
    expect(reminderSeed("sub_1", "2026-08-01T10:00:00.000Z")).toBe(
      reminderSeed("sub_1", "2026-08-01T23:59:00.000Z"),
    );
  });

  it("standardowe wyprzedzenie zachowuje dotychczasowy kształt klucza", () => {
    // Zmiana kształtu wysłałaby w dniu wdrożenia drugie przypomnienie każdemu,
    // kto pierwsze już dostał.
    expect(reminderSeed("sub_1", "2026-08-01T10:00:00.000Z", REMINDER_LEAD_DAYS)).toBe(
      "sub_1:2026-08-01",
    );
    expect(reminderSeed("sub_1", "2026-08-01T10:00:00.000Z")).toBe("sub_1:2026-08-01");
  });

  it("inne wyprzedzenie ma WŁASNĄ przestrzeń kluczy - nie zużywa właściwego przypomnienia", () => {
    // SUB-08: ręczny przebieg z `leadDays = 30` zjadał klucz przypomnienia
    // wysyłanego 3 dni przed odnowieniem, więc ten drugi już nie wychodził.
    const regularny = reminderSeed("sub_1", "2026-08-01T10:00:00.000Z", REMINDER_LEAD_DAYS);
    const reczny = reminderSeed("sub_1", "2026-08-01T10:00:00.000Z", 30);
    expect(reczny).toBe("sub_1:2026-08-01:lead30");
    expect(reczny).not.toBe(regularny);
  });
});
