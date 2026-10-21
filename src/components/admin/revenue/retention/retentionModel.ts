// Model widoku zakładki „Retencja" (S7-C) - czyste funkcje bez Reacta:
// zakres i siatka kohort, ranking powodów rezygnacji i kroki przepływu
// anulowania.
//
// PO CO OSOBNO. Każda z tych funkcji niesie regułę ze zgłoszeń, którą łatwo
// zgubić w JSX-ie: komórka kohorty, której miesiąc jeszcze nie minął, to
// `null`, a nie zero; `not_given` nie jest powodem i nie wchodzi do rankingu
// (Z-S2-04); `stripe:<kod>` to odpowiedź z portalu operatora, nie etykieta
// z katalogu; przepływ anulowania ma NAJWYŻEJ dwa kroki, liczone z tych samych
// warunków, z których dialog czytelnika decyduje o ofercie.
import { MAX_SERIES } from "@/lib/charts/types";
import type { CohortsDto, RetentionReasonRow } from "@/lib/revenue/finance/dto";
import type { RevenueRange } from "@/lib/revenue/window";

// ── Kohorty ─────────────────────────────────────────────────────────────────

/**
 * Wierszy mapy ciepła kohort: tyle, ile silnik wykresów przyjmuje serii
 * (`MAX_SERIES` - nadmiar `parse.ts` ucina po cichu). Kohorty starsze widać
 * po wybraniu wcześniejszego okresu, bo koniec zakresu idzie za oknem huba.
 */
export const COHORT_ROWS = MAX_SERIES;

/** `YYYY-MM-01` z lokalnych składowych daty - bez przesunięcia strefy. */
function monthStartIso(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${date.getFullYear()}-${month}-01`;
}

/**
 * Zakres miesięcy kohort: `COHORT_ROWS` miesięcy kończących się na miesiącu
 * OSTATNIEGO DNIA okna (granica `untilIso` jest wyłączna - odejmujemy
 * milisekundę). Składowe lokalne, bo okno huba stoi na lokalnych północach.
 */
export function cohortWindowOf(range: Pick<RevenueRange, "current">): {
  fromMonth: string;
  toMonth: string;
} {
  const last = new Date(Date.parse(range.current.untilIso) - 1);
  const to = new Date(last.getFullYear(), last.getMonth(), 1);
  const from = new Date(to.getFullYear(), to.getMonth() - (COHORT_ROWS - 1), 1);
  return { fromMonth: monthStartIso(from), toMonth: monthStartIso(to) };
}

export interface CohortGridRow {
  /** `YYYY-MM-01`. */
  cohortMonth: string;
  size: number;
  /** Udział aktywnych (0-1) per miesiąc kohorty; `null` = miesiąc nie minął. */
  shares: (number | null)[];
}

export interface CohortGrid {
  /** Miesiące kohorty 0…`maxOffset` - kolumny mapy. */
  offsets: number[];
  rows: CohortGridRow[];
}

/**
 * Siatka kohort: wiersz na miesiąc startu (od najstarszej), kolumna na
 * miesiąc życia. SQL zwraca tylko komórki miesięcy, które już minęły -
 * brakująca komórka to `null` (puste pole mapy), NIGDY zero: „0 % zostało"
 * w kohorcie sprzed tygodnia byłoby fałszywym alarmem.
 */
export function cohortGrid(dto: CohortsDto): CohortGrid {
  const offsets = Array.from({ length: Math.max(dto.maxOffset, 0) + 1 }, (_, i) => i);
  const rows = [...dto.cohorts]
    .sort((a, b) => a.cohortMonth.localeCompare(b.cohortMonth))
    .slice(-COHORT_ROWS)
    .map((cohort) => {
      const byOffset = new Map(cohort.retained.map((cell) => [cell.monthOffset, cell.share]));
      return {
        cohortMonth: cohort.cohortMonth,
        size: cohort.size,
        shares: offsets.map((offset) => byOffset.get(offset) ?? null),
      };
    });
  return { offsets, rows };
}

// ── Powody rezygnacji ───────────────────────────────────────────────────────

/** Odpowiedź „Anuluj mimo to" przed wyborem powodu (Z-09) - to nie powód. */
export const NOT_GIVEN_REASON = "not_given";
/** Prefiks odpowiedzi z ankiety portalu Stripe (`stripe:<kod>`). */
export const STRIPE_REASON_PREFIX = "stripe:";

export type ReasonLabel = { kind: "text"; text: string } | { kind: "stripe"; code: string };

export interface RankedReason {
  rank: number;
  key: string;
  label: ReasonLabel;
  responses: number;
  /** Udział w odpowiedziach Z POWODEM (0-1); `null` przy zerowej sumie. */
  share: number | null;
}

function labelOf(reasonLabel: string): ReasonLabel {
  if (reasonLabel.startsWith(STRIPE_REASON_PREFIX)) {
    const code = reasonLabel.slice(STRIPE_REASON_PREFIX.length).trim();
    return { kind: "stripe", code: code === "" ? "-" : code };
  }
  return { kind: "text", text: reasonLabel };
}

/**
 * Ranking powodów: malejąco po liczbie odpowiedzi, remisy po etykiecie.
 * `not_given` wypada z rankingu (SQL i tak liczy go osobno jako
 * `reasonNotGiven`; filtr tutaj chroni przed starszą wersją funkcji), a udział
 * liczymy z sumy odpowiedzi Z POWODEM - „bez powodu" nie rozcieńcza rankingu.
 */
export function rankReasons(reasons: readonly RetentionReasonRow[]): RankedReason[] {
  const given = reasons.filter((row) => row.reasonLabel !== NOT_GIVEN_REASON);
  const total = given.reduce((sum, row) => sum + row.responses, 0);
  return [...given]
    .sort((a, b) => b.responses - a.responses || a.reasonLabel.localeCompare(b.reasonLabel))
    .map((row, index) => ({
      rank: index + 1,
      key: row.reasonId ?? `label:${row.reasonLabel}`,
      label: labelOf(row.reasonLabel),
      responses: row.responses,
      share: total > 0 ? row.responses / total : null,
    }));
}

// ── Przepływ anulowania ─────────────────────────────────────────────────────

/** Ustawienia retencji potrzebne do kroków (wiersz `retention_settings`). */
export interface CancelFlowSettings {
  enabled: boolean;
  discount_pct: number;
  discount_periods: number;
}

export type CancelFlowStep =
  { kind: "confirm" } | { kind: "reason" } | { kind: "offer"; pct: number; periods: number };

/**
 * Kroki przepływu anulowania widziane przez klienta - te same warunki co
 * dialog czytelnika (`RetentionDialog`) i `offerFor` po stronie serwera:
 *   * brak ustawień albo retencja wyłączona → samo potwierdzenie (1 krok);
 *   * włączona → krok 1: powód (opcjonalny) i komentarz;
 *   * oferta jako krok 2 tylko przy rabacie > 0 (serwer przy rabacie 0
 *     oferty nie pokazuje).
 * NIGDY więcej niż dwa kroki (P01/P02, DSA art. 25).
 */
export function cancelFlowSteps(settings: CancelFlowSettings | null): CancelFlowStep[] {
  if (!settings?.enabled) return [{ kind: "confirm" }];
  if (settings.discount_pct <= 0) return [{ kind: "reason" }];
  return [
    { kind: "reason" },
    { kind: "offer", pct: settings.discount_pct, periods: settings.discount_periods },
  ];
}
