// Okno czasu i filtry zakładki huba z adresu (SPEC §2.4; zakładki S7).
//
// TA SAMA ARYTMETYKA CO UKŁAD. Układ huba (`HubFilters`) liczy zakres pod
// przełącznikiem okresu z `?w=`, `?from=`, `?to=` i domyślnego okresu
// zakładki; zakładka MUSI dostać to samo okno, bo inaczej podpis „Okno: …"
// nad kartą mówiłby o innym miesiącu niż liczby w karcie. Dlatego oba
// miejsca wołają `resolveRevenueRange` z tymi samymi wejściami, a „teraz"
// jest kwantowane przez pulpit (`quantizeNow`) - dwa odczyty zegara z różnicą
// milisekund dają ten sam klucz zapytania.
//
// „TERAZ" ZAMROŻONE PRZY WEJŚCIU: okno trafia do kluczy zapytań, a zegar
// czytany w każdym renderze dawałby co render nowy zakres (i nowe pobranie).
//
// Odmowa z middleware (`requireCrmStaff`: brak roli albo `aal2`) przychodzi
// jako WYJĄTEK z napisem - zamieniamy go na stan karty, bo ponowienie
// zapytania niczego tu nie naprawi (SPEC §2.5: MFA = `MfaRequiredNotice`).
import { useMemo, useState } from "react";
import { useSearch } from "@tanstack/react-router";

import { defaultPeriodOf } from "@/lib/admin/revenue/hubTabs";
import type { RevenueHubSearch, RevenueSegment, RevenueTabId } from "@/lib/revenue/search";
import { resolveRevenueRange, type RevenueRange } from "@/lib/revenue/window";

export interface HubWindow {
  search: RevenueHubSearch;
  range: RevenueRange;
  segment: RevenueSegment | null;
  currency: string | null;
}

/** Okno i filtry zakładki - `search` z walidatora układu (`parseRevenueHubSearch`). */
export function hubWindowOf(tab: RevenueTabId, search: RevenueHubSearch, nowMs: number): HubWindow {
  const period = search.w ?? defaultPeriodOf(tab) ?? "month";
  return {
    search,
    range: resolveRevenueRange(period, nowMs, search.from, search.to),
    segment: search.seg ?? null,
    currency: search.cur ?? null,
  };
}

/** Hak zakładki: zwalidowany adres układu + okno policzone jak w `HubFilters`. */
export function useHubWindow(tab: RevenueTabId): HubWindow {
  const search = useSearch({ from: "/admin/revenue" });
  const [nowMs] = useState(() => Date.now());
  return useMemo(() => hubWindowOf(tab, search, nowMs), [tab, search, nowMs]);
}

/** Odmowa middleware jako stan karty (`null` = zwykły błąd, warto ponowić). */
export function queryDenial(error: unknown): "mfa_required" | "forbidden" | null {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (message.includes("mfa_required")) return "mfa_required";
  if (message.startsWith("Forbidden")) return "forbidden";
  return null;
}

/** Role huba z dokładnych ról sesji (bez `super_admin` i `isAdmin`). */
export function hubRoleOf(roles: readonly string[]): "admin" | "editor" | null {
  if (roles.includes("admin")) return "admin";
  if (roles.includes("editor")) return "editor";
  return null;
}

/** Stan karty huba poza danymi gotowymi (SPEC §2.5: stany kart, nie toasty). */
export type HubCardStatus =
  "no_tenant" | "loading" | "error" | "forbidden" | "unavailable" | "mfa_required";

/** Wycinek wyniku `useQuery`, z którego karta wybiera swój stan. */
export interface HubQueryView {
  data?: { state: string } | undefined;
  error: unknown;
  isError: boolean;
}

/**
 * Stan karty z odczytu fabryki producenta (`{state: "ready" | "forbidden" |
 * "unavailable"}`) albo z wyjątku middleware. `"ready"` = rysuj dane.
 * Błąd z danymi w cache (`keepPreviousData`, odświeżenie w tle) nie zasłania
 * liczb - karta pokazuje ostatni dobry odczyt.
 */
export function cardStatusOf(
  query: HubQueryView,
  tenantId: string | null,
): HubCardStatus | "ready" {
  if (!tenantId) return "no_tenant";
  const state = query.data?.state;
  if (state === "forbidden" || state === "unavailable" || state === "mfa_required") return state;
  if (state !== undefined) return "ready";
  if (query.isError) return queryDenial(query.error) ?? "error";
  return "loading";
}

/**
 * Filtry migawki S6: waluta i segment TYLKO wtedy, gdy admin je wybrał.
 * Bez filtrów klucz jest identyczny z kluczem sekcji BI
 * (`RevenueInsightSection`) - ta sama liczba spod tego samego wpisu cache.
 */
export function snapshotFiltersOf(
  currency: string | null,
  segment: RevenueSegment | null,
): { currency?: string; segment?: RevenueSegment } {
  return {
    ...(currency ? { currency } : {}),
    ...(segment && segment !== "all" ? { segment } : {}),
  };
}
