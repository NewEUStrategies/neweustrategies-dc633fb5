// Model widoku zakładki „Przychód" (S7-C) - czyste funkcje bez Reacta:
// ziarno i strefa szeregu MRR, wiersze ruchów MRR (rodzaj × powód × waluta)
// i wiersze zgodności dokumentów z zamówieniami.
//
// PO CO OSOBNO. Każda z tych decyzji ma regułę, którą łatwo zgubić
// w JSX-ie: waluty nigdy się nie sumują, `null` nie jest zerem, segment
// w kluczu mostu musi być identyczny z kluczem `MrrBridgeCard` (inaczej
// tabela ruchów pobrałaby most drugi raz), a werdykt zgodności idzie z tego
// samego `reconcileMetric`, którym S6 uzgadnia przychód zrealizowany w BI.
// Funkcje czyste dają się sprawdzić testem bez renderu.
import { reconcileMetric, type ReconciliationVerdict } from "@/lib/analytics/semantic/reconcile";
import { SITE_TIME_ZONE } from "@/lib/i18n/format";
import type {
  ChurnReason,
  ChurnReasonRow,
  MrrBridgeCurrencyRow,
  MrrSeriesGrain,
  MrrSeriesPoint,
  RealizedDto,
} from "@/lib/revenue/finance/dto";
import type { BridgeParts } from "@/lib/revenue/finance/mrrMath";
import type { RevenueSegment } from "@/lib/revenue/search";
import type { RevenueRange } from "@/lib/revenue/window";

// ── Klucz mostu ─────────────────────────────────────────────────────────────

/**
 * Segment w kluczu mostu - LUSTRO `bridgeSegmentOf` z `MrrBridgeCard` (S7-B):
 * „wszystkie" i brak filtra to `null`. Tabela ruchów czyta ten sam most co
 * karta obok, więc klucz musi być bajt w bajt ten sam - test zakładki
 * sprawdza, że most jest pobierany raz.
 */
export function bridgeSegmentKeyOf(segment: RevenueSegment | null): string | null {
  return segment === null || segment === "all" ? null : segment;
}

/** Filtr segmentu zawęża tylko część kart - reszta liczy wszystkie segmenty. */
export function segmentNarrowed(segment: RevenueSegment | null): boolean {
  return bridgeSegmentKeyOf(segment) !== null;
}

// ── Szereg MRR ──────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/**
 * Najdłuższe okno, dla którego prosimy o punkty dzienne. LUSTRO
 * `FINANCE_DAY_GRAIN_MAX_DAYS` z walidatora server fn (SQL odrzuca dłuższe
 * okno z ziarnem `day` kodem `grain_invalid`) - stała powtórzona, żeby czysty
 * model nie importował modułu server fn; równość pilnuje `mrrModel.test.ts`.
 */
export const SERIES_DAY_GRAIN_MAX_DAYS = 120;

/**
 * Ziarno szeregu z kubełka okna huba (ta sama arytmetyka co pulpit):
 * minuty, godziny i dni → punkty dzienne, chyba że okno jest dłuższe niż
 * pozwala SQL - wtedy tygodniowe. Szereg MRR nie ma sensu poniżej doby
 * (migawka jest dzienna), więc kubełek godzinowy pulpitu też daje dni.
 */
export function seriesGrainOf(range: Pick<RevenueRange, "bucket" | "current">): MrrSeriesGrain {
  if (range.bucket === "month") return "month";
  if (range.bucket === "week") return "week";
  const days = (Date.parse(range.current.untilIso) - Date.parse(range.current.sinceIso)) / DAY_MS;
  return days <= SERIES_DAY_GRAIN_MAX_DAYS ? "day" : "week";
}

/** Lustro walidatora strefy w server fn (`TimeZone`) - inny napis dałby 400. */
const IANA_ZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/;

/**
 * Strefa kubełków szeregu: strefa przeglądarki, bo w niej hub liczy granice
 * okna (`resolveRevenueRange`) - punkt „1 października" ma zaczynać się tam,
 * gdzie zaczyna się okno. Strefa nieznana albo spoza wzorca walidatora →
 * strefa serwisu (domyślna strefa server fn), a nie błąd zapytania.
 */
export function seriesTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && IANA_ZONE.test(zone) ? zone : SITE_TIME_ZONE;
  } catch {
    return SITE_TIME_ZONE;
  }
}

export interface CurrencySeries {
  currency: string;
  points: MrrSeriesPoint[];
  /** Punkt z największą bezwzględną różnicą migawki i księgi (`null` = brak różnic). */
  maxDrift: MrrSeriesPoint | null;
  /** Ile punktów nie ma migawki dziennej (`snapshotMrrMinor === null`). */
  missingSnapshots: number;
}

/**
 * Punkty pogrupowane per waluta (kolejność walut jak z serwera - wiodąca
 * pierwsza), posortowane po dniu. Każda waluta to osobny wykres: kurs
 * z dnia odczytu zmieniałby historię przy każdym odświeżeniu.
 */
export function seriesByCurrency(points: readonly MrrSeriesPoint[]): CurrencySeries[] {
  const groups = new Map<string, MrrSeriesPoint[]>();
  for (const point of points) {
    const list = groups.get(point.currency) ?? [];
    list.push(point);
    groups.set(point.currency, list);
  }
  return [...groups].map(([currency, list]) => {
    const sorted = [...list].sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
    let maxDrift: MrrSeriesPoint | null = null;
    for (const point of sorted) {
      if (point.driftMinor === null || point.driftMinor === 0) continue;
      if (maxDrift === null || Math.abs(point.driftMinor) > Math.abs(maxDrift.driftMinor ?? 0)) {
        maxDrift = point;
      }
    }
    return {
      currency,
      points: sorted,
      maxDrift,
      missingSnapshots: sorted.filter((p) => p.snapshotMrrMinor === null).length,
    };
  });
}

// ── Ruchy MRR ───────────────────────────────────────────────────────────────

/** Rodzaje ruchu w kolejności mostu (otwarcie księgi tylko, gdy jest w oknie). */
export const MOVEMENT_KINDS = [
  "opening",
  "new",
  "expansion",
  "reactivation",
  "contraction",
  "churn",
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

const KIND_PART: Readonly<Record<MovementKind, keyof BridgeParts>> = {
  opening: "openingMinor",
  new: "newMinor",
  expansion: "expansionMinor",
  reactivation: "reactivationMinor",
  contraction: "contractionMinor",
  churn: "churnMinor",
};

export interface MovementRow {
  kind: MovementKind;
  /** Powód ruchu (`null` = wiersz rodzaju, wszystkie powody razem). */
  reason: ChurnReason | null;
  /** Liczba ruchów - znana tylko dla powodów odejść (`null` = most jej nie podaje). */
  movements: number | null;
  /** Kwota per waluta kolumny; `null` = ta waluta nie ma wiersza w źródle. */
  amounts: ReadonlyMap<string, number | null>;
}

export interface MovementTable {
  /** Kolumny walut: waluty mostu, potem waluty występujące tylko w powodach. */
  currencies: string[];
  rows: MovementRow[];
}

/**
 * Tabela ruchów: wiersz na rodzaj ruchu (z mostu), a pod odejściami - wiersz
 * na powód (z księgi odejść). Waluty są KOLUMNAMI, więc żadna komórka nie
 * łączy dwóch walut. Otwarcie księgi pojawia się tylko, gdy któraś waluta ma
 * je w oknie - tak samo jak krok wodospadu w `MrrBridgeCard`.
 *
 * Powód bez kwoty w danej walucie to ZMIERZONE zero (lista kwot powodu
 * wymienia waluty, w których były ruchy), a waluta spoza mostu w wierszu
 * rodzaju to brak danych (`null`), nie zero.
 */
export function movementTable(
  bridge: readonly MrrBridgeCurrencyRow[],
  reasons: readonly ChurnReasonRow[] | null,
): MovementTable {
  const currencies = bridge.map((row) => row.currency);
  for (const reason of reasons ?? []) {
    for (const amount of reason.amounts) {
      if (!currencies.includes(amount.currency)) currencies.push(amount.currency);
    }
  }
  const byCurrency = new Map(bridge.map((row) => [row.currency, row]));
  const kindAmounts = (kind: MovementKind) =>
    new Map(
      currencies.map((currency) => {
        const row = byCurrency.get(currency);
        return [currency, row ? row[KIND_PART[kind]] : null] as const;
      }),
    );

  const rows: MovementRow[] = [];
  for (const kind of MOVEMENT_KINDS) {
    if (kind === "opening" && bridge.every((row) => row.openingMinor === 0)) continue;
    rows.push({ kind, reason: null, movements: null, amounts: kindAmounts(kind) });
    if (kind !== "churn" || reasons === null) continue;
    for (const reason of reasons) {
      const amounts = new Map(reason.amounts.map((a) => [a.currency, a.amountMinor]));
      rows.push({
        kind,
        reason: reason.reason,
        movements: reason.movements,
        amounts: new Map(currencies.map((c) => [c, amounts.get(c) ?? 0] as const)),
      });
    }
  }
  return { currencies, rows };
}

// ── Zgodność źródeł ─────────────────────────────────────────────────────────

export interface ReconciliationRow {
  currency: string;
  /** Netto opłaconych dokumentów (księga - źródło autorytatywne). */
  documentsMinor: number;
  /** Netto opłaconych zamówień z kasy (źródło potwierdzające). */
  ordersMinor: number;
  documents: number;
  orders: number;
  /** Dokumenty − zamówienia: dodatnia = odnowienia i dokumenty spoza kasy. */
  differenceMinor: number;
  verdict: ReconciliationVerdict;
}

/**
 * Dokumenty i zamówienia per waluta z werdyktem rejestru S6
 * (`reconcileMetric("revenue_realized", …)`: tolerancja i oczekiwany porządek
 * „księga ≥ zamówienia" są w definicji wskaźnika, nie tutaj - bez nowych
 * progów). Waluta obecna tylko po jednej stronie to zmierzone zero po drugiej:
 * RPC wymienia waluty, w których były dokumenty albo zamówienia.
 *
 * WYJĄTEK ZERA. Przy księdze = 0 odchylenie względne nie istnieje (dzielenie
 * przez zero), więc `reconcileMetric` uznałby zamówienia za „jedno źródło".
 * Zamówienia ponad pustą księgą to jednak dokładnie odwrócony porządek
 * z definicji - zgubione dokumenty - i tak je oznaczamy.
 */
export function reconciliationRows(dto: RealizedDto): ReconciliationRow[] {
  const currencies = dto.totals.map((row) => row.currency);
  for (const row of dto.orders) {
    if (!currencies.includes(row.currency)) currencies.push(row.currency);
  }
  const rows: ReconciliationRow[] = [];
  for (const currency of currencies) {
    const documentsMinor = dto.totals.find((row) => row.currency === currency)?.netMinor ?? 0;
    const orderRow = dto.orders.find((row) => row.currency === currency);
    const ordersMinor = orderRow?.amountMinor ?? 0;
    if (documentsMinor === 0 && ordersMinor === 0) continue;
    const documents = dto.categories
      .filter((row) => row.currency === currency)
      .reduce((sum, row) => sum + row.documents, 0);
    const orders = orderRow?.orders ?? 0;
    const verdict: ReconciliationVerdict =
      documentsMinor === 0 && ordersMinor > 0
        ? "order_inverted"
        : reconcileMetric("revenue_realized", [
            { streamId: "billing", value: documentsMinor, samples: documents },
            { streamId: "lifecycle", value: ordersMinor, samples: orders },
          ]).verdict;
    rows.push({
      currency,
      documentsMinor,
      ordersMinor,
      documents,
      orders,
      differenceMinor: documentsMinor - ordersMinor,
      verdict,
    });
  }
  return rows;
}

// ── Daty ────────────────────────────────────────────────────────────────────

/** `YYYY-MM-DD` jako lokalna północ (AGENTS: daty lokalne, bez przesunięcia). */
export function localDay(day: string): Date {
  const [y, m, d] = day.slice(0, 10).split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}
