// Zużycie miesięcznego limitu bezpłatnych artykułów - reguła karty meteringu.
//
// Karta pokazuje sprzedaży, ile z bezpłatnego limitu wykorzystał kontakt: to
// argument w rozmowie o planie płatnym, więc liczby muszą być odporne na dane
// brzegowe (limit 0, zużycie ponad limit, brak ustawień tenanta). Reguła stała
// wewnątrz komponentu (`MeteringUsageCard`), więc nie była sprawdzana wcale.
//
// Progi zwracamy jako KLUCZ, nie jako kolor ani tekst - o wygląd dba panel.

/** Domyślny limit z ustawień tenanta (`metering_settings.member_monthly_limit`). */
export const DEFAULT_MONTHLY_LIMIT = 5;

export type UsageLevel = "ok" | "warning" | "exhausted";

export interface UsageView {
  used: number;
  limit: number;
  remaining: number;
  /** Wypełnienie paska w procentach (0-100, nigdy ponad). */
  percent: number;
  level: UsageLevel;
}

const clampCount = (value: number | null | undefined): number => {
  const n = Math.trunc(Number(value ?? 0));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/**
 * Liczby paska zużycia.
 *
 * `percent` jest przycięty do 100 - zużycie ponad limit (metering liczy wejścia,
 * limit mógł zostać obniżony) nie może wypchnąć paska poza kartę. `remaining`
 * nigdy nie schodzi poniżej zera z tego samego powodu.
 */
export function meteringUsageView(
  used: number | null | undefined,
  limit: number | null | undefined,
): UsageView {
  const usedCount = clampCount(used);
  const limitCount = clampCount(limit);
  const remaining = Math.max(limitCount - usedCount, 0);
  const percent = limitCount > 0 ? Math.min(100, Math.round((usedCount / limitCount) * 100)) : 0;
  return {
    used: usedCount,
    limit: limitCount,
    remaining,
    percent,
    level: usageLevel(percent, remaining),
  };
}

/**
 * Poziom zużycia jako klucz: `exhausted` gdy limit wyczerpany, `warning` od 80%
 * (moment na rozmowę o planie), inaczej `ok`.
 */
export function usageLevel(percent: number, remaining: number): UsageLevel {
  if (remaining <= 0) return "exhausted";
  return percent >= 80 ? "warning" : "ok";
}

/** Pierwszy dzień bieżącego miesiąca UTC - okres, w którym liczy się metering. */
export function meteringPeriodStart(now: Date = new Date()): string {
  const period = new Date(now.getTime());
  period.setUTCDate(1);
  period.setUTCHours(0, 0, 0, 0);
  return period.toISOString().slice(0, 10);
}
