// ADAPTER BENCHMARKÓW - lokalizacja treści rejestru i przejście do typów
// wykresów (`ChartMetric`, `ChartSource`). SPEC §5.5, AD-09, N13.
//
// DWIE STRONY JEDNEGO KONTRAKTU. Treść grup (`groups/*.server.ts`, ok. 240 KB
// tekstu PL+EN) i rejestr źródeł z cytatami (`sources.ts`) żyją wyłącznie na
// serwerze: server fn `getBenchmarkGroup` lokalizuje je tu (`localizeBenchmark`,
// `buildGroupPayload`) i wysyła JEDEN język, bez cytatów źródeł. Klient dostaje
// gotowe napisy i z tego samego modułu bierze funkcje widoku (`toChartMetric`,
// `citationsFor`, `formatBenchValue`, `toBandsView`).
//
// DLATEGO TEN PLIK NIE IMPORTUJE `./sources` ANI `./groups/**`. Jest modułem
// klienta (≤ 4 KB gz razem z indeksem i ewaluatorem); jeden import treści
// wciągnąłby cały rejestr do chunku panelu. Pilnuje tego test
// `__tests__/clientBoundary.test.ts`.
import { MAX_CHART_SOURCES, type ChartSource } from "@/lib/charts/sources";
import type { ChartMetric } from "@/lib/charts/types";
import type { MetricId } from "../metrics";
import { contextDirection, type BenchDirection } from "./evaluate";
import type {
  Bi,
  BenchContext,
  BenchContextSegment,
  BenchGroup,
  BenchSource,
  BenchUnit,
  BenchWindow,
  Measure,
  MetricBenchmark,
  Tier,
} from "./types";

export type BenchLang = "pl" | "en";

/**
 * Jednostka WYŚWIETLANIA, gdy różni się od jednostki pasm. Czas reakcji na
 * leada jest w źródłach w minutach, a cykl sprzedaży w dniach - rejestr trzyma
 * oba w godzinach (jedna oś czasu, jedna normalizacja), a UI pokazuje to, co
 * czytelnik zna ze źródła. NPS to różnica punktów procentowych (`percent_pt`),
 * ale czyta się go jako liczbę ze znakiem, nie jako procent.
 */
export type BenchDisplayUnit = "minutes" | "days" | "score";

/** Kontekst generowany przez importer: typ I0 + jednostka wyświetlania (Z-S6-04). */
export type GeneratedContext = BenchContext & { displayUnit?: BenchDisplayUnit };

/**
 * Wpis generowany przez importer. `metricId` jest zawężony do słownika metryk
 * (literówka w nakładce nie przejdzie kompilacji), `noMetricReason` mówi,
 * czego brakuje, gdy wpis nie ma metryki (D-02, status N).
 */
export type GeneratedBenchmark = Omit<MetricBenchmark, "contexts" | "metricId"> & {
  metricId?: MetricId;
  contexts: readonly GeneratedContext[];
  noMetricReason?: Bi;
};

export interface LocalizedBand {
  tier: Tier;
  min: number | null;
  max: number | null;
  note?: string;
  basis: "B" | "E";
}

export interface LocalizedContext {
  id: string;
  label: string;
  segments: readonly BenchContextSegment[];
  measure: Measure;
  unit: BenchUnit;
  displayUnit?: BenchDisplayUnit;
  currency?: "PLN" | "USD";
  vat?: "net" | "gross";
  window: BenchWindow;
  direction: BenchDirection;
  method: string;
  sourceIds: readonly string[];
  bands: readonly LocalizedBand[];
}

/** Źródło w odpowiedzi do klienta - BEZ `excerpt` (cytat zostaje na serwerze). */
export interface LocalizedSource {
  id: string;
  title: string;
  publisher: string;
  published: string;
  url: string;
  accessed: string;
  reliability: "A" | "B" | "C";
  verification: "full" | "snippet";
  vendor?: true;
  /** Wiek publikacji w miesiącach względem `asOf` rejestru; `null` = brak daty. */
  ageMonths: number | null;
}

export interface LocalizedBenchmark {
  key: string;
  metricId?: MetricId;
  group: BenchGroup;
  abbr: string;
  name: string;
  expansion: string;
  formula: string;
  interpretation: string;
  levers: string;
  caveats: readonly { text: string; sourceIds?: readonly string[] }[];
  direction: BenchDirection;
  confidence: "low" | "medium" | "high";
  asOf: string;
  reviewBy: string;
  contexts: readonly LocalizedContext[];
  defaultContextBySegment: Partial<Record<BenchContextSegment, string>>;
  pairs: readonly string[];
  noMetricReason?: string;
}

export interface BenchmarkGroupPayload {
  group: BenchGroup;
  lang: BenchLang;
  asOf: string;
  benchmarks: readonly LocalizedBenchmark[];
  sources: readonly LocalizedSource[];
}

/**
 * Źródło starsze niż 18 miesięcy dostaje w UI znacznik „historyczne” -
 * benchmark z 2022 r. opisuje rynek sprzed podwyżek cen i kryzysu kosztów
 * życia, więc czytelnik musi to widzieć przy liczbie, nie w przypisie.
 */
export const STALE_SOURCE_MONTHS = 18;

/** Tekst dwujęzyczny w wybranym języku - jedyne miejsce wyboru języka DANYCH (nie napisów UI). */
export function bi(text: Bi, lang: BenchLang): string {
  return text[lang];
}

/**
 * Wiek publikacji w miesiącach z WIODĄCEJ daty pola `published` („2025-06”,
 * „2026-03-12 (aktualizacja …)”, „2026 (strona bez daty …)”).
 *
 * Sam rok liczymy jako grudzień, czyli NAJMNIEJSZY możliwy wiek: znacznik
 * „historyczne” ma się zapalać tylko wtedy, gdy źródło na pewno jest stare -
 * fałszywy alarm przy każdej dacie bez miesiąca uczyłby ignorowania znacznika.
 */
export function ageMonths(published: string, asOf: string): number | null {
  const pub = /^(\d{4})(?:-(\d{2}))?/.exec(published.trim());
  const ref = /^(\d{4})-(\d{2})/.exec(asOf);
  if (!pub || !ref) return null;
  const pubIndex = Number(pub[1]) * 12 + (pub[2] ? Number(pub[2]) : 12);
  const refIndex = Number(ref[1]) * 12 + Number(ref[2]);
  return Math.max(0, refIndex - pubIndex);
}

/**
 * Data publikacji po angielsku: tylko wiodąca data. Dopiski badaczy są po
 * polsku („strona bez daty …”) i zostają w wersji PL; w EN brak daty to
 * konwencjonalne „n.d.”, a nie polskie zdanie w bibliografii.
 */
function publishedFor(published: string, lang: BenchLang): string {
  if (lang === "pl") return published;
  const lead = /^\d{4}(?:-\d{2}(?:-\d{2})?)?/.exec(published.trim());
  return lead ? lead[0] : "n.d.";
}

/** Dopisek w nawiasie na końcu nazwy wydawcy, jeśli jest polską adnotacją, a nie nazwiskiem. */
const TRAILING_NOTE = /\s*\(([^()]*)\)\s*$/;
const POLISH_NOTE =
  /(?:^|[\s(;,])(?:dane|raport|raportu|cytuje|kopia|badanie|badania|streszczenie|[a-ząćęłńóśźż]*[ąćęłńóśźż][a-ząćęłńóśźż]*)(?=$|[\s);,.:])/u;

/**
 * Wydawca po angielsku: polska adnotacja badacza w końcowym nawiasie
 * („omówienie raportu MGI”, „dane Vendr”) znika, a nazwiska autorów
 * („Kyle Poyar”, „Rafał Badowski”) zostają - to nazwy własne, nie tłumaczenie.
 */
function publisherFor(publisher: string, lang: BenchLang): string {
  if (lang === "pl") return publisher;
  const note = TRAILING_NOTE.exec(publisher);
  if (note && POLISH_NOTE.test(note[1])) return publisher.slice(0, note.index).trim();
  return publisher.replace(/ i in\.\)/, " et al.)");
}

/** Źródło rejestru w jednym języku, bez cytatu (`excerpt` nie opuszcza serwera). */
export function localizeSource(s: BenchSource, lang: BenchLang, asOf: string): LocalizedSource {
  return {
    id: s.id,
    title: s.title,
    publisher: publisherFor(s.publisher, lang),
    published: publishedFor(s.published, lang),
    url: s.url,
    accessed: s.accessed,
    reliability: s.reliability,
    verification: s.verification,
    ...(s.vendor ? { vendor: true as const } : {}),
    ageMonths: ageMonths(s.published, asOf),
  };
}

function localizeContext(c: GeneratedContext, lang: BenchLang): LocalizedContext {
  return {
    id: c.id,
    label: bi(c.label, lang),
    segments: c.segments,
    measure: c.measure,
    unit: c.unit,
    ...(c.displayUnit ? { displayUnit: c.displayUnit } : {}),
    ...(c.currency ? { currency: c.currency } : {}),
    ...(c.vat ? { vat: c.vat } : {}),
    window: c.window,
    // Importer zapisuje kierunek każdego kontekstu; wyliczenie z pasm jest
    // tylko asekuracją dla treści spoza importera (fikstury, testy).
    direction: c.direction ?? contextDirection(c),
    method: bi(c.method, lang),
    sourceIds: c.sourceIds,
    bands: c.bands.map((b) => ({
      tier: b.tier,
      min: b.min,
      max: b.max,
      ...(b.note ? { note: bi(b.note, lang) } : {}),
      basis: b.basis,
    })),
  };
}

/** Wpis rejestru w jednym języku (serwer). `pairs` z indeksu - pary obowiązkowe w UI. */
export function localizeBenchmark(
  b: GeneratedBenchmark,
  lang: BenchLang,
  pairs: readonly string[],
): LocalizedBenchmark {
  return {
    key: b.key,
    ...(b.metricId ? { metricId: b.metricId } : {}),
    group: b.group,
    abbr: b.abbr,
    name: bi(b.name, lang),
    expansion: bi(b.expansion, lang),
    formula: bi(b.formula, lang),
    interpretation: bi(b.interpretation, lang),
    levers: bi(b.levers, lang),
    caveats: b.caveats.map((c) => ({
      text: bi(c.text, lang),
      ...(c.sourceIds && c.sourceIds.length > 0 ? { sourceIds: c.sourceIds } : {}),
    })),
    direction: b.direction,
    confidence: b.confidence,
    asOf: b.asOf,
    reviewBy: b.reviewBy,
    contexts: b.contexts.map((c) => localizeContext(c, lang)),
    defaultContextBySegment: b.defaultContextBySegment,
    pairs,
    ...(b.noMetricReason ? { noMetricReason: bi(b.noMetricReason, lang) } : {}),
  };
}

/**
 * Odpowiedź server fn dla jednej grupy: wpisy w jednym języku i TYLKO źródła,
 * które grupa cytuje (konteksty i zastrzeżenia), w kolejności pierwszego
 * użycia. Czysta funkcja - server fn podaje treść, test podaje fiksturę.
 */
export function buildGroupPayload(input: {
  group: BenchGroup;
  lang: BenchLang;
  asOf: string;
  benchmarks: readonly GeneratedBenchmark[];
  pairs: Readonly<Record<string, readonly string[]>>;
  sourceById: (id: string) => BenchSource | undefined;
}): BenchmarkGroupPayload {
  const used: string[] = [];
  const collect = (ids: readonly string[] | undefined): void => {
    for (const id of ids ?? []) if (!used.includes(id)) used.push(id);
  };
  for (const b of input.benchmarks) {
    for (const c of b.contexts) collect(c.sourceIds);
    for (const c of b.caveats) collect(c.sourceIds);
  }
  const sources: LocalizedSource[] = [];
  for (const id of used) {
    const s = input.sourceById(id);
    if (s) sources.push(localizeSource(s, input.lang, input.asOf));
  }
  return {
    group: input.group,
    lang: input.lang,
    asOf: input.asOf,
    benchmarks: input.benchmarks.map((b) =>
      localizeBenchmark(b, input.lang, input.pairs[b.key] ?? []),
    ),
    sources,
  };
}

/** Domknięcie zdania kropką - zastrzeżenia sklejane w jeden akapit tooltipa. */
function sentence(text: string): string {
  const t = text.trim();
  return t === "" || /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Wpis rejestru jako `ChartMetric` - ten sam kształt, który już renderuje
 * `MetricTooltip` wykresów, więc objaśnienie benchmarku nie potrzebuje
 * drugiego komponentu. Skrót staje przy ikonie, nazwa idzie do „co mierzy”.
 */
export function toChartMetric(b: LocalizedBenchmark): ChartMetric {
  return {
    name: b.abbr,
    expansion: b.expansion,
    formula: b.formula,
    measures: b.name,
    reading: b.interpretation,
    levers: b.levers,
    caution: b.caveats
      .map((c) => sentence(c.text))
      .filter(Boolean)
      .join(" "),
  };
}

/**
 * Źródło rejestru jako przypis wykresu. Instytucja jest autorem (Chicago,
 * autor korporacyjny), więc pole wydawcy zostaje puste - inaczej opis
 * powtarzałby nazwę („SaaS Capital. *Tytuł*. SaaS Capital, 2025”).
 */
export function toChartSource(s: LocalizedSource): ChartSource {
  return {
    id: s.id,
    author: s.publisher,
    title: s.title,
    container: "",
    publisher: "",
    published: s.published,
    accessed: s.accessed,
    url: s.url,
    reliability: s.reliability,
  };
}

/**
 * Przypisy AKTYWNEGO kontekstu, w kolejności z kontekstu, najwyżej
 * `MAX_CHART_SOURCES`. Cytujemy kontekst, a nie cały wskaźnik: churn
 * miesięczny ma 15 źródeł łącznie, ale pasmo, które czytelnik widzi, opiera
 * się na najwyżej 9 (D11) - przypis do niewidocznego pasma tylko myli.
 */
export function citationsFor(
  ctx: Pick<LocalizedContext, "sourceIds">,
  sources: readonly LocalizedSource[],
): ChartSource[] {
  const out: ChartSource[] = [];
  for (const id of ctx.sourceIds) {
    const s = sources.find((x) => x.id === id);
    if (s) out.push(toChartSource(s));
    if (out.length === MAX_CHART_SOURCES) break;
  }
  return out;
}

function locale(lang: BenchLang): string {
  return lang === "en" ? "en-GB" : "pl-PL";
}

function unitFormat(lang: BenchLang, unit: string, display: "short" | "long"): Intl.NumberFormat {
  return new Intl.NumberFormat(locale(lang), {
    style: "unit",
    unit,
    unitDisplay: display,
    maximumFractionDigits: 1,
  });
}

/**
 * Wartość progu albo pomiaru w jednostce kontekstu, przez `Intl` - bez
 * słownika i bez warunków na język w treści. Brak wartości to „-”, nigdy „0”.
 *
 * Kwoty: pasma są w jednostkach podrzędnych (grosze, centy), więc dzielimy
 * przez wykładnik waluty z `Intl` (PLN 2, JPY 0). Godziny wracają do minut
 * albo dni według `displayUnit`, NPS dostaje znak („+42”).
 */
export function formatBenchValue(
  v: number | null,
  ctx: Pick<LocalizedContext, "unit" | "displayUnit" | "currency">,
  lang: BenchLang,
): string {
  if (v === null || !Number.isFinite(v)) return "-";
  const loc = locale(lang);
  switch (ctx.unit) {
    case "percent_pt":
      if (ctx.displayUnit === "score") {
        return new Intl.NumberFormat(loc, {
          maximumFractionDigits: 1,
          signDisplay: "exceptZero",
        }).format(v);
      }
      return new Intl.NumberFormat(loc, { style: "percent", maximumFractionDigits: 2 }).format(
        v / 100,
      );
    case "fraction":
      return new Intl.NumberFormat(loc, { style: "percent", maximumFractionDigits: 2 }).format(v);
    case "money_minor": {
      if (!ctx.currency) return "-";
      const exponent =
        new Intl.NumberFormat(loc, { style: "currency", currency: ctx.currency }).resolvedOptions()
          .maximumFractionDigits ?? 2;
      const amount = v / 10 ** exponent;
      return new Intl.NumberFormat(loc, {
        style: "currency",
        currency: ctx.currency,
        minimumFractionDigits: Number.isInteger(amount) ? 0 : exponent,
        maximumFractionDigits: exponent,
      }).format(amount);
    }
    case "multiple":
      return `${new Intl.NumberFormat(loc, { maximumFractionDigits: 2 }).format(v)}×`;
    case "months":
      return unitFormat(lang, "month", "long").format(v);
    case "hours":
      if (ctx.displayUnit === "minutes") return unitFormat(lang, "minute", "short").format(v * 60);
      if (ctx.displayUnit === "days") return unitFormat(lang, "day", "long").format(v / 24);
      return unitFormat(lang, "hour", "short").format(v);
  }
}

export interface BandView {
  tier: Tier;
  /** Zakres po ludzku: „< 2,7%”, „2,7%–3,5%”, „≥ 7%”. */
  label: string;
  basis: "B" | "E";
  /** Dolna granica sformatowana; pusta = otwarty początek. */
  from: string;
  /** Górna granica sformatowana; pusta = otwarty koniec. */
  to: string;
}

/**
 * Pasma kontekstu gotowe do skali porządkowej (AD-20: segmenty równej
 * szerokości, bo otwarte końce `null` nie mają długości). Etykieta używa
 * symboli „<” i „≥” - są takie same w obu językach i jednoznacznie mówią,
 * do którego pasma należy granica (`[min, max)`).
 */
export function toBandsView(
  ctx: Pick<LocalizedContext, "unit" | "displayUnit" | "currency" | "bands">,
  lang: BenchLang,
): BandView[] {
  return ctx.bands.map((b) => {
    const from = b.min === null ? "" : formatBenchValue(b.min, ctx, lang);
    const to = b.max === null ? "" : formatBenchValue(b.max, ctx, lang);
    const label = b.min === null ? `< ${to}` : b.max === null ? `≥ ${from}` : `${from}–${to}`;
    return { tier: b.tier, label, basis: b.basis, from, to };
  });
}
