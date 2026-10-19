// OCENA WARTOŚCI WSKAŹNIKA W PASMACH BENCHMARKU (SPEC §5.5, AD-09, AD-20).
//
// JEDNA REGUŁA, CZYSTA FUNKCJA. Ocenę liczą kafel KPI, skala benchmarku,
// słownik wskaźników i sekcja BI - gdyby każdy liczył po swojemu, ten sam
// churn 4,9 % byłby „normalny” w kaflu i „słaby” w słowniku. Moduł nie ma
// I/O ani zależności runtime, więc jedzie do klienta razem z lekkim indeksem.
//
// SZUKAMY PASMA ZAWIERAJĄCEGO WARTOŚĆ, NIE PO ETYKIECIE. Wskaźniki
// przedziałowe (`range`) mają powtórzone etykiety („normalny” poniżej
// i powyżej optimum), a pasma kierunku `lower` rosną od „optymalnego” do
// „krytycznego”. Kolejność etykiet niczego więc nie mówi - rozstrzyga
// wyłącznie to, w którym przedziale `[min, max)` leży wartość.
//
// „BRAK OCENY” TO STAN, NIE SZARY POZIOM. Każda sytuacja, w której nie wolno
// porównać liczby z pasmem (inna wielkość, waluta, VAT, mała próba), daje
// `tier: "none"` z powodem. UI pokazuje powód słowem - szare pasmo udające
// ocenę byłoby gorsze niż brak oceny (AD-20).
import type { MetricUnit } from "../metrics";
import type { LocalizedContext } from "./adapter";
import type { BenchBand, BenchContextSegment, BenchUnit, Measure, Tier } from "./types";

/**
 * Minimalna liczebność, przy której ocena ma sens. Poniżej 50 obserwacji
 * pojedyncza rezygnacja przesuwa churn o 2 pp i „przeskakuje” pasmo - ocena
 * mierzyłaby szum, nie zdrowie biznesu.
 */
export const SMALL_SAMPLE_N = 50;

/** Dlaczego wartość NIE dostała oceny - każdy powód ma własny komunikat w UI. */
export type BenchmarkNoneReason =
  | "no_value"
  | "no_benchmark"
  | "no_context"
  | "measure_mismatch"
  | "currency_mismatch"
  | "vat_mismatch"
  | "unit_mismatch"
  | "small_sample"
  | "no_data"
  | "incomparable";

/**
 * Pasmo w kształcie, którego potrzebuje ocena. Wspólny mianownik pasma
 * z rejestru (`BenchBand`, nota dwujęzyczna) i pasma zlokalizowanego
 * (`LocalizedBand`, nota jako napis) - ocena nie czyta noty, więc oba typy
 * przechodzą bez rzutowania.
 */
export type EvaluatedBand = Pick<BenchBand, "tier" | "min" | "max" | "basis">;

export type BenchDirection = "higher" | "lower" | "range";

export type BenchmarkEvaluation =
  | {
      tier: Tier;
      band: EvaluatedBand;
      basis: "B" | "E";
      contextId: string;
      direction: BenchDirection;
      /** Wartość PO normalizacji do jednostki kontekstu - ta, którą oceniono. */
      value: number;
    }
  | { tier: "none"; why: BenchmarkNoneReason; contextId?: string };

/** Ranga poziomu: krytyczny 1 … optymalny 5. `switch` zamiast mapy - zero stałych obiektowych w chunku. */
function tierRank(tier: Tier): number {
  switch (tier) {
    case "critical":
      return 1;
    case "weak":
      return 2;
    case "normal":
      return 3;
    case "good":
      return 4;
    case "optimal":
      return 5;
  }
}

/**
 * Kierunek kontekstu wyliczony z SEKWENCJI RANG pasm (D4): rosnąco - `higher`,
 * malejąco - `lower`, inaczej (wzrost, potem spadek) - `range`.
 *
 * Kierunek jest cechą KONTEKSTU, nie wskaźnika: udział planów rocznych jest
 * przedziałowy dla mediów B2C, ale monotoniczny dla B2B (więcej znaczy
 * lepiej). Pasma niosą tę wiedzę wprost, więc nie ufamy deklaracji - przy
 * mniej niż dwóch pasmach (brak sekwencji) zostaje deklaracja albo `higher`.
 * Pasma muszą być posortowane rosnąco po `min` (robi to importer).
 */
export function contextDirection(ctx: {
  bands: readonly Pick<BenchBand, "tier">[];
  direction?: BenchDirection;
}): BenchDirection {
  const ranks = ctx.bands.map((b) => tierRank(b.tier));
  if (ranks.length < 2) return ctx.direction ?? "higher";
  let up = true;
  let down = true;
  for (let i = 1; i < ranks.length; i += 1) {
    if (ranks[i] < ranks[i - 1]) up = false;
    if (ranks[i] > ranks[i - 1]) down = false;
  }
  if (up && !down) return "higher";
  if (down && !up) return "lower";
  if (up && down) return ctx.direction ?? "higher";
  return "range";
}

/**
 * Wartość metryki w jednostce kontekstu albo `null`, gdy przeliczenie nie
 * istnieje (wtedy ocena = `unit_mismatch`).
 *
 * Najgroźniejszy błąd to skala: rejestr trzyma udziały jako ułamek 0-1, a pasma
 * są w punktach procentowych - bez mnożenia churn 0,03 zostałby oceniony jako
 * 0,03 % i dostał „optymalny”. Pieniądze przechodzą 1:1 (grosze ↔ grosze),
 * a zgodność waluty i VAT sprawdza `evaluateMetric`, bo to nie jest kwestia
 * skali, tylko porównywalności.
 */
export function normalizeToUnit(value: number, from: MetricUnit, to: BenchUnit): number | null {
  if (!Number.isFinite(value)) return null;
  switch (to) {
    case "percent_pt":
      return from === "ratio" ? value * 100 : null;
    case "fraction":
      return from === "ratio" ? value : null;
    case "money_minor":
      return from === "money_minor" ? value : null;
    case "multiple":
      return from === "multiple" ? value : null;
    case "months":
      return from === "months" ? value : null;
    case "hours":
      if (from === "hours") return value;
      // Cykl sprzedaży jest liczony w dniach, a pasma czasu - w godzinach
      // (jedna oś dla czasu reakcji i cyklu; `displayUnit` przywraca dni w UI).
      if (from === "days") return value * 24;
      if (from === "milliseconds") return value / 3_600_000;
      return null;
  }
}

/**
 * Kontekst porównania: jawny wybór (`?ctx=`) > domyślny dla segmentu danych
 * > domyślny ogólny (`all`). Nieznane `ctxId` nie jest błędem - link z zakładką
 * starego kontekstu po zmianie rejestru spada do domyślnego, zamiast gasić ocenę.
 */
export function selectContext<C extends { id: string; segments: readonly BenchContextSegment[] }>(
  bench: {
    contexts: readonly C[];
    defaultContextBySegment: Partial<Record<BenchContextSegment, string>>;
  },
  segment?: BenchContextSegment,
  ctxId?: string,
): C | null {
  const byId = (id: string | undefined): C | null =>
    id === undefined ? null : (bench.contexts.find((c) => c.id === id) ?? null);
  return (
    byId(ctxId) ??
    (segment ? byId(bench.defaultContextBySegment[segment]) : null) ??
    byId(bench.defaultContextBySegment.all)
  );
}

/**
 * Pasmo zawierające wartość: przedziały `[min, max)`, `null` = ±∞, NAJWYŻSZE
 * pasmo domknięte z prawej (udział 100 % należy do ostatniego pasma `[75, 100)`,
 * a nie „poza skalą”). Wyszukiwanie nie zależy od kolejności pasm.
 *
 * Wartość poza dziedziną pasm (np. ujemny udział przy pierwszym paśmie od 0)
 * daje `incomparable` - liczba jest spoza tego, co benchmark w ogóle opisuje.
 */
export function tierOf(
  value: number | null,
  ctx: { id: string; bands: readonly EvaluatedBand[]; direction?: BenchDirection },
): BenchmarkEvaluation {
  if (value === null || !Number.isFinite(value)) {
    return { tier: "none", why: "no_value", contextId: ctx.id };
  }
  if (ctx.bands.length === 0) return { tier: "none", why: "no_benchmark", contextId: ctx.id };
  let top: EvaluatedBand | null = null;
  for (const b of ctx.bands) {
    if (b.max === null) {
      top = null;
      break;
    }
    if (top === null || (top.max !== null && b.max > top.max)) top = b;
  }
  const band = ctx.bands.find(
    (b) =>
      (b.min === null || value >= b.min) &&
      (b.max === null || value < b.max || (b === top && value === b.max)),
  );
  if (!band) return { tier: "none", why: "incomparable", contextId: ctx.id };
  return {
    tier: band.tier,
    band,
    basis: band.basis,
    contextId: ctx.id,
    direction: contextDirection(ctx),
    value,
  };
}

/** Kontekst w kształcie, którego potrzebuje ocena (zlokalizowany albo z rejestru). */
export type EvaluableContext = Pick<
  LocalizedContext,
  "id" | "segments" | "measure" | "unit" | "currency" | "vat" | "direction"
> & { bands: readonly EvaluatedBand[] };

export interface EvaluateInput {
  value: number | null;
  unit: MetricUnit;
  /**
   * Co mierzy liczba (wzrost r/r, realizacja planu, efektywność…). Podany -
   * musi zgadzać się z kontekstem. Pominięty - liczba jest NATYWNĄ wartością
   * metryki (churn jako churn, udział jako udział), a kontekst o innej
   * wielkości odrzuca kontrola jednostki: procent r/r przy kwocie MRR nie
   * ma przeliczenia z groszy.
   */
  measure?: Measure;
  currency?: string;
  /** Podstawa kwoty; rejestr liczy przychód NETTO (bez VAT), więc to wartość domyślna. */
  vat?: "net" | "gross";
  /** Liczebność próby (np. baza klientów na początku okna). */
  n?: number;
  segment?: BenchContextSegment;
  ctxId?: string;
}

/**
 * Pełna ocena wartości metryki względem benchmarku: wybór kontekstu, kontrola
 * porównywalności, normalizacja jednostki i pasmo.
 *
 * Kolejność kontroli jest celowa - od „nie ma z czym porównać” do „nie wolno
 * porównać”: najpierw brak benchmarku/kontekstu/danych/wartości, potem mała
 * próba, potem niezgodność wielkości, waluty, VAT i jednostki. Dzięki temu UI mówi
 * najbardziej podstawowy powód, a nie np. „inna waluta” przy pustej wartości.
 */
export function evaluateMetric(
  input: EvaluateInput,
  bench:
    | {
        contexts: readonly EvaluableContext[];
        defaultContextBySegment: Partial<Record<BenchContextSegment, string>>;
      }
    | null
    | undefined,
): BenchmarkEvaluation {
  if (!bench || bench.contexts.length === 0) return { tier: "none", why: "no_benchmark" };
  const ctx = selectContext(bench, input.segment, input.ctxId);
  if (!ctx) return { tier: "none", why: "no_context" };
  const none = (why: BenchmarkNoneReason): BenchmarkEvaluation => ({
    tier: "none",
    why,
    contextId: ctx.id,
  });
  // Pusta baza (zero klientów na początku okna) to brak danych, a nie mała
  // próba - komunikat „za mało obserwacji” sugerowałby, że wystarczy poczekać.
  if (input.n !== undefined && input.n <= 0) return none("no_data");
  if (input.value === null || !Number.isFinite(input.value)) return none("no_value");
  if (input.n !== undefined && input.n < SMALL_SAMPLE_N) return none("small_sample");
  if (input.measure !== undefined && ctx.measure !== input.measure) return none("measure_mismatch");
  if (ctx.unit === "money_minor") {
    if (input.unit !== "money_minor") return none("unit_mismatch");
    // Konteksty w USD są odniesieniem (D7): kwoty w PLN nie wolno oceniać
    // pasmem w dolarach, bo wynik zależałby od kursu, a nie od biznesu.
    if (!input.currency || input.currency !== ctx.currency) return none("currency_mismatch");
    // Pasmo brutto przy kwocie netto (albo odwrotnie) różni się o stawkę VAT -
    // 23 % to więcej niż szerokość typowego pasma (D1).
    if (ctx.vat !== undefined && ctx.vat !== (input.vat ?? "net")) return none("vat_mismatch");
  }
  const normalized = normalizeToUnit(input.value, input.unit, ctx.unit);
  if (normalized === null) return none("unit_mismatch");
  return tierOf(normalized, ctx);
}
