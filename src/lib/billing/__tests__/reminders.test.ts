import { describe, expect, it } from "vitest";
import { reminderSeed, reminderWindow } from "@/lib/billing/reminders.server";

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
});
