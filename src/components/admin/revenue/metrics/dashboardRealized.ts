// Okno pulpitu admina jako okno huba - dla kafla „Przychód zrealizowany"
// w sekcji Marketing pulpitu (`MarketingPanel`, pakiet S7 §8).
//
// TEN SAM KLUCZ CO HUB I BI. Pulpit liczy okno `resolveDashboardRange(okres,
// quantizeNow(okres, teraz))` - dokładnie tę arytmetykę, do której hub
// deleguje okresy wspólne (`resolveRevenueRange` → `fromDashboard`). Pola
// `DashboardRange` przepisane 1:1 do `RevenueRange` dają więc identyczny
// klucz `revenueSnapshotQueryOptions(najemca, okno)` co kafel Kokpitu, wiersz
// KPI zakładki Przychód i sekcja BI dla tego samego okresu - jeden wpis
// cache, jedna liczba (test `MarketingPanel.realized.test.tsx`).
//
// OKRESY SPOZA HUBA (`realtime`, `today`): migawka przychodu nie ma okna
// krótszego niż tydzień, więc kafel nie pyta o nic i mówi dlaczego („-"
// z powodem), zamiast pokazać liczbę z innego okresu.
//
// MODUŁ CZYSTY - bez Reacta.
import type { DashboardRange } from "@/lib/admin/dashboard/period";
import { REVENUE_PERIODS, type RevenuePeriod } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";

function isRevenuePeriod(period: string): period is RevenuePeriod {
  return (REVENUE_PERIODS as readonly string[]).includes(period);
}

/** Okno huba dla okna pulpitu; `null` = okres pulpitu, którego hub nie liczy. */
export function dashboardRevenueRange(range: DashboardRange): RevenueRange | null {
  if (!isRevenuePeriod(range.period)) return null;
  return {
    period: range.period,
    current: range.current,
    previous: range.previous,
    bucket: range.bucket,
    offsetMinutes: range.offsetMinutes,
    complete: range.complete,
  };
}
