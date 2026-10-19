// FABRYKA KLUCZY REACT QUERY HUBA „PRZYCHÓD I LEJEK" (agregaty z RPC).
//
// LIŚĆ BEZ IMPORTÓW RUNTIME (dozwolone `import type`). Te klucze czyta
// rozszerzenie mapy inwalidacji szyny zdarzeń; moduł, który wciągnie React
// Query albo klienta Supabase, wciągnie je do chunku szyny. Pilnuje tego
// `hubKeyFactories.test.ts` (czyta źródło).
//
// DZIEDZINA PRZED NAJEMCĄ. Reguła szyny wie, CO się zmieniło (np. ruch MRR),
// ale nie zna okna ani filtrów, które admin ma otwarte. Prefiks
// `["admin-revenue", dziedzina, najemca]` trafia w każde zapamiętane okno tej
// dziedziny i w nic poza nią - a najemca w kluczu sprawia, że przełączenie
// obszaru roboczego nie poda agregatów cudzej firmy z cache.
import type { RevenueRange } from "@/lib/revenue/window";

/** Dziedziny huba - każda ma własny prefiks inwalidacji i własny `staleTime`. */
export const REVENUE_DOMAINS = [
  "snapshot",
  "mrr",
  "churn",
  "cohorts",
  "dunning",
  "retention",
  "funnel",
  "realized",
  "offer",
  "access",
  "events",
  "clubs",
  "email",
  "diagnostics",
  "inputs",
  "economics",
] as const;
export type RevenueDomain = (typeof REVENUE_DOMAINS)[number];

/**
 * Filtry odczytu okresowego. Kolejność w kluczu jest STAŁA (waluta, segment,
 * ziarno, kategoria, tor), a brak filtra to `null` - dzięki temu ten sam
 * odczyt ma zawsze ten sam klucz, niezależnie od tego, czy ekran podał
 * `{ segment: null }`, czy nie podał segmentu wcale.
 */
export type RevenueQueryFilters = Readonly<{
  currency?: string | null;
  segment?: string | null;
  grain?: string | null;
  category?: string | null;
  track?: string | null;
}>;

/** Część okna, która wchodzi do klucza (pełne `RevenueRange` też pasuje). */
type RangeKeyPart = Pick<RevenueRange, "period" | "current">;

export const revenueKeys = {
  /** Cały hub - wylogowanie, zmiana najemcy. */
  root: () => ["admin-revenue"] as const,
  /** Dziedzina u wszystkich najemców. */
  domain: (domain: RevenueDomain) => ["admin-revenue", domain] as const,
  /** Dziedzina najemcy - prefiks reguł szyny (`rev(d)` w rozszerzeniu mapy). */
  domainTenant: (domain: RevenueDomain, tenantId: string) =>
    ["admin-revenue", domain, tenantId] as const,
  /**
   * Odczyt okresowy. Obie granice okna w kluczu (wzór `dashboardQueryKey`):
   * okres sam w sobie nie wystarcza, bo „ten miesiąc" w październiku i w
   * listopadzie to dwa różne zapytania.
   */
  query: (
    domain: RevenueDomain,
    tenantId: string,
    range: RangeKeyPart,
    filters: RevenueQueryFilters = {},
  ) =>
    [
      "admin-revenue",
      domain,
      tenantId,
      range.period,
      range.current.sinceIso,
      range.current.untilIso,
      filters.currency ?? null,
      filters.segment ?? null,
      filters.grain ?? null,
      filters.category ?? null,
      filters.track ?? null,
    ] as const,
  /** Fakty diagnostyki (bez okna) - czyta je też `RevenueSignalChip` w modułach. */
  facts: (tenantId: string) => ["admin-revenue", "diagnostics", tenantId, "facts"] as const,
  /** Wyciszenia diagnoz. */
  snoozes: (tenantId: string) => ["admin-revenue", "diagnostics", tenantId, "snoozes"] as const,
  /** Inwentarz treści za paywallem. */
  accessInventory: (tenantId: string) =>
    ["admin-revenue", "access", tenantId, "inventory"] as const,
  /** Macierz plan × benefit. */
  offerMatrix: (tenantId: string) => ["admin-revenue", "offer", tenantId, "matrix"] as const,
  /** Dane wejściowe planu i kosztów dla zakresu miesięcy (`YYYY-MM-01`). */
  manualInputs: (tenantId: string, fromMonth: string, toMonth: string) =>
    ["admin-revenue", "inputs", tenantId, fromMonth, toMonth] as const,
} as const;
