// ANOMALIE POMIARU EKSPOZYCJI SPONSORÓW (OPS-09) - warstwa RPC panelu i model
// ostrzeżenia w raporcie dla sponsorów.
//
// SKĄD SIĘ BIORĄ. `event_sponsor_exposure_ingest` (migracja 20261012120000)
// zapisuje trzy rodzaje zdarzeń, które zmieniają sposób liczenia:
//   * `rate_limited` - paczka odrzucona limitem zapytań adresu (nic nie
//     zapisane; `hits` = liczba paczek);
//   * `session_cap` - sesja ponad limit z jednego adresu w ciągu dnia (najwyżej
//     50 unikalnych: 49 sesji + kubełek adresu);
//   * `invalid_session` - sesja bez ważnego podpisu serwera (stara wersja
//     strony albo podrobione żądanie).
// Dwie ostatnie liczą się do ŁĄCZNYCH, ale do UNIKALNYCH tylko raz na adres
// i dzień (`hits` = liczba pozycji). Raport już jest skorygowany - ostrzeżenie
// mówi organizatorowi, ILE i z ILU źródeł, zanim pokaże liczby sponsorowi.
//
// AUTORYZACJA SIEDZI W SQL (`assert_event_admin_tenant()`); najemca to najemca
// domowy wołającego - tutaj nie ma `tenant_id`. Typ wiersza z `Database`.
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { SponsorReportQuery } from "@/lib/events/sponsorReportApi";

type Fns = Database["public"]["Functions"];

export type SponsorExposureAnomalyRow =
  Fns["admin_event_sponsor_exposure_anomalies"]["Returns"][number];

/** Lustro CHECK-a `event_sponsor_exposure_anomalies_reason_values` (test parytetu). */
export const SPONSOR_EXPOSURE_ANOMALY_REASONS = [
  "rate_limited",
  "session_cap",
  "invalid_session",
] as const;
export type SponsorExposureAnomalyReason = (typeof SPONSOR_EXPOSURE_ANOMALY_REASONS)[number];

/** Klucze i18n powodów - LITERAŁY, żeby widziała je bramka kluczy. */
export const ADMIN_ANOMALY_LABEL_KEYS = {
  rate_limited: "adminEventSponsorReport.anomalies.rateLimited",
  session_cap: "adminEventSponsorReport.anomalies.sessionCap",
  invalid_session: "adminEventSponsorReport.anomalies.invalidSession",
} as const satisfies Record<SponsorExposureAnomalyReason, string>;

export function isSponsorExposureAnomalyReason(
  value: unknown,
): value is SponsorExposureAnomalyReason {
  return (
    typeof value === "string" &&
    (SPONSOR_EXPOSURE_ANOMALY_REASONS as readonly string[]).includes(value)
  );
}

export async function fetchSponsorExposureAnomalies(
  query: SponsorReportQuery,
): Promise<SponsorExposureAnomalyRow[]> {
  // Argument opcjonalny pominięty = bez filtra (jak w `sponsorReportApi.ts`).
  const args: Fns["admin_event_sponsor_exposure_anomalies"]["Args"] = {
    p_event_id: query.eventId,
  };
  if (query.from !== null) args.p_from = query.from;
  if (query.to !== null) args.p_to = query.to;
  if (query.sponsorId !== null) args.p_sponsor_id = query.sponsorId;
  const { data, error } = await supabase.rpc("admin_event_sponsor_exposure_anomalies", args);
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Jedna linia ostrzeżenia: powód, liczba zdarzeń, liczba par adres x dzień. */
export interface SponsorExposureAnomalyLine {
  reason: SponsorExposureAnomalyReason;
  hits: number;
  sources: number;
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Wiersze dzień x powód -> linie ostrzeżenia w stałej kolejności powodów.
 * Źródło jest skrótem adresu W DANYM DNIU, więc suma `sources` po dniach to
 * liczba par adres x dzień, a nie liczba adresów. Powód nieznany (nowa wartość
 * w bazie przed wdrożeniem frontu) i zera odpadają - ostrzeżenie bez liczby
 * nie mówi nic.
 */
export function summarizeExposureAnomalies(
  rows: readonly SponsorExposureAnomalyRow[],
): SponsorExposureAnomalyLine[] {
  const totals = new Map<SponsorExposureAnomalyReason, SponsorExposureAnomalyLine>();
  for (const row of rows) {
    if (!isSponsorExposureAnomalyReason(row.reason)) continue;
    const line = totals.get(row.reason) ?? { reason: row.reason, hits: 0, sources: 0 };
    line.hits += count(row.hits);
    line.sources += count(row.sources);
    totals.set(row.reason, line);
  }
  return SPONSOR_EXPOSURE_ANOMALY_REASONS.flatMap((reason) => {
    const line = totals.get(reason);
    return line !== undefined && line.hits > 0 ? [line] : [];
  });
}
