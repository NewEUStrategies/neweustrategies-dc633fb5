// Metadane migawki S6 dla kart zakładek Przychód i Retencja (S7-C): dzień
// początku księgi, waluta wiodąca wskaźników ilorazowych i wpis win-back.
//
// ZERO DODATKOWYCH ŻĄDAŃ. Hak woła `revenueSnapshotQueryOptions` z TYMI
// SAMYMI argumentami co wiersz KPI (`OverviewKpiTiles`: okno, a waluta
// i segment tylko wtedy, gdy admin je wybrał - `snapshotFiltersOf`), więc
// czyta ten sam wpis cache, który wiersz KPI już pobrał (i który czyta BI).
// `select` wybiera z migawki tylko to, czego karta potrzebuje - karta nie
// renderuje się ponownie, gdy w migawce zmieni się coś innego.
//
// „DANE OD …" (SPEC §6.2). `dataSince` to pierwszy dzień księgi ruchów MRR.
// Karty NRR/GRR i kohort podają go do `ProvenanceNote`, która przed upływem
// 12 miesięcy (`FULL_HISTORY_MONTHS`) mówi „Historia od X - wynik pełny od
// Y" - zamiast pokazywać niepełny wynik roczny jak pełny albo zero.
import { useQuery } from "@tanstack/react-query";

import { snapshotFiltersOf } from "@/components/admin/revenue/overview/hubWindow";
import {
  revenueSnapshotQueryOptions,
  type RevenueSnapshotResult,
} from "@/lib/analytics/semantic/revenueSnapshot.functions";
import type { RevenueSegment } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";

export interface SnapshotMeta {
  /** `YYYY-MM-DD` - pierwszy dzień księgi (`null` = księga pusta). */
  dataSince: string | null;
  /**
   * Waluta, w której migawka liczy wskaźniki ilorazowe (NRR, GRR, quick
   * ratio) - Z-S2-05. `null` = migawka nie zna żadnej kwoty.
   */
  leadingCurrency: string | null;
  /** Kanoniczna wartość `winback_rate_12m` (`null` = nie do policzenia). */
  winback12m: number | null;
}

/**
 * Waluta wiodąca jak w `getRevenueSnapshot`: filtr `?cur=`, a bez niego
 * pierwsza waluta pierwszej niepustej listy (MRR, potem przychód
 * zrealizowany). Migawka nie zwraca jeszcze `ratio_currency` (propozycja
 * Z-S2-05 dla S6), więc panel odtwarza tę samą regułę, żeby podpisać liczby.
 */
export function snapshotMetaOf(
  snapshot: Pick<RevenueSnapshotResult, "dataSince" | "money" | "entries">,
  currency: string | null,
): SnapshotMeta {
  const lists = [snapshot.money.mrr, snapshot.money.revenue_realized];
  const first = lists.find((list) => (list?.length ?? 0) > 0)?.[0]?.currency ?? null;
  const winback = snapshot.entries.find((entry) => entry.metricId === "winback_rate_12m");
  return {
    dataSince: snapshot.dataSince,
    leadingCurrency: currency ?? first,
    winback12m: winback?.canonicalValue ?? null,
  };
}

export function useSnapshotMeta(
  tenantId: string | null,
  range: RevenueRange,
  currency: string | null,
  segment: RevenueSegment | null,
): SnapshotMeta | undefined {
  const query = useQuery({
    ...revenueSnapshotQueryOptions(tenantId, range, snapshotFiltersOf(currency, segment)),
    select: (snapshot: RevenueSnapshotResult) => snapshotMetaOf(snapshot, currency),
  });
  return query.data;
}
