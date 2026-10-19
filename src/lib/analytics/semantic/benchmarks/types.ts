// TYPY REJESTRU BENCHMARKÓW WSKAŹNIKÓW (SPEC §5.5) - kontrakt danych dla S6.
//
// I0 ustala sam KSZTAŁT, bez wartości: importer (`scripts/benchmarks/
// import-benchmarks.ts`) generuje treść grup do plików `*.server.ts`, a klient
// dostaje tylko lekki indeks. Typy stoją osobno, żeby generator, ewaluator
// i komponenty dzieliły jedną definicję bez wciągania treści do chunku.
//
// Pola `Bi` są dwujęzyczne obowiązkowo (test parytetu PL/EN w S6) - stąd para
// `{ pl, en }`, a nie klucz słownika: treść benchmarku to dane z datą
// i źródłem, nie napis interfejsu.

/** Ocena wartości wskaźnika w paśmie benchmarku. */
export type Tier = "critical" | "weak" | "normal" | "good" | "optimal";

/** Tekst dwujęzyczny. */
export type Bi = { pl: string; en: string };

export type BenchUnit = "money_minor" | "percent_pt" | "fraction" | "multiple" | "months" | "hours";

export type Measure =
  | "level"
  | "change_yoy"
  | "change_mom_cmgr"
  | "share_of_base"
  | "attainment_vs_plan"
  | "cohort_survival"
  | "ratio_of_flows";

export type BenchWindow =
  | "month"
  | "month_avg3"
  | "quarter"
  | "year"
  | "ltm"
  | "cohort_12m"
  | "cohort_m1"
  | "cohort_m3"
  | "cohort_m12"
  | "per_campaign"
  | "per_customer"
  | "per_journey"
  | "snapshot";

export type BenchContextSegment =
  | "b2c_individual"
  | "b2c_reduced"
  | "b2b_institution"
  | "membership_club"
  | "events"
  | "newsletter"
  | "paywall"
  | "all";

export interface BenchBand {
  tier: Tier;
  min: number | null;
  max: number | null;
  note?: Bi;
  /** `B` - pasmo z kwartyli źródła, `E` - heurystyka (opisana w nocie/metodzie). */
  basis: "B" | "E";
}

/** Kontekst porównania. Pasma posortowane i ciągłe (`[min, max)`). */
export interface BenchContext {
  id: string;
  label: Bi;
  segments: BenchContextSegment[];
  measure: Measure;
  unit: BenchUnit;
  currency?: "PLN" | "USD";
  vat?: "net" | "gross";
  window: BenchWindow;
  direction?: "higher" | "lower" | "range";
  method: Bi;
  sourceIds: string[];
  bands: BenchBand[];
}

export interface BenchSource {
  id: string;
  aliases: string[];
  title: string;
  publisher: string;
  published: string;
  url: string;
  accessed: "2026-10-18";
  reliability: "A" | "B" | "C";
  verification: "full" | "snippet";
  vendor?: true;
  excerpt?: string;
}

export interface MetricBenchmark {
  key: string;
  metricId?: string;
  group: BenchGroup;
  abbr: string;
  name: Bi;
  expansion: Bi;
  formula: Bi;
  interpretation: Bi;
  levers: Bi;
  caveats: { text: Bi; sourceIds?: string[] }[];
  direction: "higher" | "lower" | "range";
  confidence: "low" | "medium" | "high";
  asOf: string;
  reviewBy: string;
  contexts: BenchContext[];
  defaultContextBySegment: Partial<Record<BenchContextSegment, string>>;
}

export type BenchGroup = "revenue" | "retention" | "economics" | "funnel" | "email" | "community";
