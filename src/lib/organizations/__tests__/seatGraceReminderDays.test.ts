import { describe, expect, it } from "vitest";
import {
  DEFAULT_SEAT_GRACE_REMINDER_DAYS,
  MAX_REMINDER_SLOTS,
  effectiveReminderDays,
  formatReminderDays,
  normalizeReminderDays,
  parseReminderDays,
  sameReminderDays,
} from "@/lib/organizations/teamSeats";

describe("konfiguracja progów przypomnień o karencji", () => {
  it("parsuje zapis z panelu (przecinki, spacje, średniki)", () => {
    expect(parseReminderDays("14, 7 ;3  1")).toEqual([14, 7, 3, 1]);
  });

  it("odrzuca wartości spoza zakresu i duplikaty", () => {
    expect(parseReminderDays("0, 1, 1, 91, 90, abc")).toEqual([90, 1]);
  });

  it("ogranicza liczbę progów do limitu bazy", () => {
    const many = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(normalizeReminderDays(many)).toHaveLength(MAX_REMINDER_SLOTS);
  });

  it("brak konfiguracji = wartości domyślne, pusta lista = wyłączone", () => {
    expect(effectiveReminderDays(null)).toEqual([...DEFAULT_SEAT_GRACE_REMINDER_DAYS]);
    expect(effectiveReminderDays([])).toEqual([]);
  });

  it("formatuje progi do pola tekstowego", () => {
    expect(formatReminderDays([1, 14, 7])).toBe("14, 7, 1");
  });

  it("porównuje progi niezależnie od kolejności zapisu", () => {
    expect(sameReminderDays([1, 7], [7, 1])).toBe(true);
    expect(sameReminderDays([1, 7], [7, 3])).toBe(false);
  });
});
