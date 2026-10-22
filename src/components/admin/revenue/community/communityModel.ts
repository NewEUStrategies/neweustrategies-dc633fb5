// Model kart zakładki „Społeczność" - czyste funkcje nad DTO S4
// (`src/lib/revenue/community/dto.ts`), bez Reacta.
//
// `null` ≠ 0. Udział bez mianownika (żadnego zgłoszenia dopuszczonego, żadnej
// decyzji) to „brak danych", nie 0 % - zero procent mówiłoby, że ktoś się
// zgłosił i nikt nie przyszedł. Kwoty per waluta, nigdy suma walut.
import type {
  RevenueClubsSummaryDto,
  RevenueEventMoney,
  RevenueEventSummaryRow,
} from "@/lib/revenue/community/dto";
import type { ChartLang } from "@/lib/charts/format";
import type { MoneyByCurrency } from "@/lib/revenue/money";

/**
 * Nazwa wydarzenia albo klubu w języku panelu. Pusta wersja językowa (klub
 * założony tylko po polsku) nie może dać pustego odnośnika - wtedy bierzemy
 * tę, która istnieje.
 */
export function localizedName(names: Readonly<Record<ChartLang, string>>, lang: ChartLang): string {
  const own = names[lang].trim();
  if (own !== "") return own;
  return Object.values(names).find((name) => name.trim() !== "") ?? "";
}

/** Iloraz z jawnym brakiem mianownika (`null` - nie ma czego dzielić). */
export function shareOf(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

/** Kwoty biletów w kształcie `MoneyByCurrency` (`null` = rola bez kwot). */
export function ticketMoney(
  byCurrency: readonly RevenueEventMoney[] | null,
): MoneyByCurrency[] | null {
  return byCurrency === null
    ? null
    : byCurrency.map((m) => ({ currency: m.currency, amountMinor: m.ticketRevenueNetMinor }));
}

/** Wydarzenia, w których ktoś skorzystał z puli biletów planu - od największej. */
export function poolEvents(rows: readonly RevenueEventSummaryRow[]): RevenueEventSummaryRow[] {
  return rows
    .filter((row) => row.planPool > 0)
    .sort((a, b) => b.planPool - a.planPool || a.startsAt.localeCompare(b.startsAt));
}

/**
 * Lejek zgłoszeń do klubów. Złożone i decyzje to RÓŻNE kohorty (decyzja
 * w oknie może dotyczyć zgłoszenia sprzed okna), więc między nimi nie ma
 * udziału (`null`); przyjęte to podzbiór decyzji z okna - ich udział liczy
 * się wśród decyzji (ta sama definicja co `club_application_acceptance`).
 */
export interface ClubFunnelModel {
  submitted: number;
  decided: number;
  accepted: number;
  acceptance: number | null;
}

export function clubFunnelOf(summary: RevenueClubsSummaryDto): ClubFunnelModel {
  const { submitted, accepted, rejected } = summary.applications;
  const decided = accepted + rejected;
  return { submitted, decided, accepted, acceptance: shareOf(accepted, decided) };
}
