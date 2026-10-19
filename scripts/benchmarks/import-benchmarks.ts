// IMPORTER REJESTRU BENCHMARKÓW WSKAŹNIKÓW (SPEC §5.5, PLAN S6 §3.2-§3.4).
//
//   bun run scripts/benchmarks/import-benchmarks.ts <katalog> [--check]
//     [--groups przychod,retencja] [--out <katalog_wyjściowy>]
//
// SKĄD TREŚĆ. `docs/benchmarki/<data>/<grupa>.json` to dane zweryfikowane przez
// badaczy (pasma, metody, źródła z cytatami - PL, nazwy PL/EN), a
// `<grupa>.overlay.json` to warstwa redakcyjna: tłumaczenia EN, dźwignie,
// metadane kontekstów (segment, wielkość, jednostka, okno), mapa na `MetricId`
// i ocena źródeł. Dane zostają NIETKNIĘTE - każda poprawka idzie przez nakładkę,
// więc widać, co jest pomiarem badacza, a co decyzją redakcji.
//
// CO ROBI. Waliduje obie warstwy i naprawia znane defekty materiału (brief 05
// §3): scala zduplikowane `arpu` (D1), kanonizuje źródła po znormalizowanym
// URL (D2), wymaga przypięcia każdego źródła (D3), wylicza kierunek per
// kontekst (D4), sortuje pasma i sprawdza ciągłość (D5), ustawia wielkość,
// jednostkę, walutę, VAT i skalę (D6-D7), okno (D8), wiarygodność (D9),
// unikalne skróty (D10) i limit źródeł (D11). Generuje `groups/<grupa>.server.ts`
// (treść, tylko serwer), `sources.ts` (rejestr źródeł, tylko serwer) i `index.ts`
// (lekki indeks klienta).
//
// DLACZEGO GENERATOR, A NIE RĘCZNY TS. Treść ma ~240 KB w dwóch językach;
// ręczna edycja wygenerowanego pliku rozjechałaby go z danymi badaczy bez
// śladu. Nagłówek niesie SHA-256 treści kanonicznej wejść, a `--check`
// (generacja w pamięci + porównanie z repo) kończy się kodem 1 przy dryfie.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { z } from "zod";
import type {
  BenchDisplayUnit,
  GeneratedBenchmark,
  GeneratedContext,
} from "../../src/lib/analytics/semantic/benchmarks/adapter";
import { contextDirection } from "../../src/lib/analytics/semantic/benchmarks/evaluate";
import type {
  BenchBand,
  BenchContextSegment,
  BenchGroup,
  BenchSource,
  BenchUnit,
  BenchWindow,
  Measure,
  Tier,
} from "../../src/lib/analytics/semantic/benchmarks/types";

// ---------------------------------------------------------------------------
// Słowniki
// ---------------------------------------------------------------------------

/** Pliki grup w kolejności rejestru - ta kolejność rozstrzyga „pierwszy slug” źródła (D2). */
export const GROUP_FILES = [
  "przychod",
  "retencja",
  "ekonomika",
  "lejek",
  "email",
  "spolecznosc",
] as const;
export type GroupFile = (typeof GROUP_FILES)[number];

export const GROUP_OF_FILE: Readonly<Record<GroupFile, BenchGroup>> = {
  przychod: "revenue",
  retencja: "retention",
  ekonomika: "economics",
  lejek: "funnel",
  email: "email",
  spolecznosc: "community",
};

const EXPORT_NAME: Readonly<Record<BenchGroup, string>> = {
  revenue: "REVENUE_BENCHMARKS",
  retention: "RETENTION_BENCHMARKS",
  economics: "ECONOMICS_BENCHMARKS",
  funnel: "FUNNEL_BENCHMARKS",
  email: "EMAIL_BENCHMARKS",
  community: "COMMUNITY_BENCHMARKS",
};

/** Data stanu rejestru = data dostępu do źródeł (`BenchSource.accessed`). */
export const REGISTRY_AS_OF = "2026-10-18";

/** Katalog modułów rejestru względem korzenia repo (`--out`). */
export const BENCH_OUT_DIR = "src/lib/analytics/semantic/benchmarks";

/** Limit przypisów jednego wykresu (`MAX_CHART_SOURCES`, D11). */
const MAX_SOURCES_PER_CONTEXT = 12;
const MAX_LEVER_CHARS = 600;

const SEGMENTS = [
  "b2c_individual",
  "b2c_reduced",
  "b2b_institution",
  "membership_club",
  "events",
  "newsletter",
  "paywall",
  "all",
] as const satisfies readonly BenchContextSegment[];
const MEASURES = [
  "level",
  "change_yoy",
  "change_mom_cmgr",
  "share_of_base",
  "attainment_vs_plan",
  "cohort_survival",
  "ratio_of_flows",
] as const satisfies readonly Measure[];
const UNITS = [
  "money_minor",
  "percent_pt",
  "fraction",
  "multiple",
  "months",
  "hours",
] as const satisfies readonly BenchUnit[];
const WINDOWS = [
  "month",
  "month_avg3",
  "quarter",
  "year",
  "ltm",
  "cohort_12m",
  "cohort_m1",
  "cohort_m3",
  "cohort_m12",
  "per_campaign",
  "per_customer",
  "per_journey",
  "snapshot",
] as const satisfies readonly BenchWindow[];
const BENCH_GROUPS = [
  "revenue",
  "retention",
  "economics",
  "funnel",
  "email",
  "community",
] as const satisfies readonly BenchGroup[];
const DISPLAY_UNITS = ["minutes", "days", "score"] as const satisfies readonly BenchDisplayUnit[];

/** Etykiety pasm w danych → poziom. Kwalifikator w nawiasie („słaby (zbyt szczelnie)”) trafia do noty. */
const TIER_OF_LABEL: Readonly<Record<string, Tier>> = {
  krytyczny: "critical",
  słaby: "weak",
  normalny: "normal",
  dobry: "good",
  optymalny: "optimal",
};

const DIRECTION_OF: Readonly<Record<RawMetric["direction"], "higher" | "lower" | "range">> = {
  higher_better: "higher",
  lower_better: "lower",
  target_range: "range",
};

const CONFIDENCE_OF: Readonly<Record<RawMetric["confidence"], "low" | "medium" | "high">> = {
  niska: "low",
  średnia: "medium",
  wysoka: "high",
};

/**
 * Jednostka danych → dozwolone pary (jednostka pasm, jednostka wyświetlania).
 * Kwota (`PLN`) może mieć kontekst procentowy - wzrost ARR r/r czy realizacja
 * planu MRR to procenty przy metryce pieniężnej (D6).
 */
const UNIT_RULES: Readonly<
  Record<RawMetric["unit"], readonly { unit: BenchUnit; display?: BenchDisplayUnit }[]>
> = {
  "%": [{ unit: "percent_pt" }],
  PLN: [{ unit: "money_minor" }, { unit: "percent_pt" }],
  "PLN/mies.": [{ unit: "money_minor" }, { unit: "percent_pt" }],
  ratio: [{ unit: "multiple" }],
  months: [{ unit: "months" }],
  hours: [{ unit: "hours" }],
  minutes: [{ unit: "hours", display: "minutes" }],
  days: [{ unit: "hours", display: "days" }],
  score: [{ unit: "percent_pt", display: "score" }],
};

/**
 * Okresy, których znaczenie jest jednoznaczne (D8). Dla pozostałych („rocznie
 * (okno 12M)”, „kohorta odejść; okno do 12 mies.”) okno wybiera redakcja
 * w nakładce - importer tylko pilnuje, by oczywiste przypadki się zgadzały.
 */
function expectedWindow(period: string): BenchWindow | null {
  const p = period.trim();
  if (p === "miesięcznie") return "month";
  if (p === "miesięcznie (średnia 3-miesięczna)") return "month_avg3";
  if (p === "kwartalnie") return "quarter";
  if (p === "rocznie" || p.startsWith("rocznie (CY-")) return "year";
  if (p === "kroczące 12 miesięcy" || p.startsWith("LTM")) return "ltm";
  if (p === "na kampanię" || p === "na wysyłkę") return "per_campaign";
  return null;
}

// ---------------------------------------------------------------------------
// Schematy wejścia
// ---------------------------------------------------------------------------

const text = z.string().trim().min(1);
const digits = z.string().regex(/^\d+$/, "oczekiwano indeksu (cyfry)");
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "oczekiwano daty RRRR-MM-DD");

const RawBandSchema = z
  .object({
    label: text,
    min: z.number().nullable(),
    max: z.number().nullable(),
    note: text.optional(),
  })
  .strict();
const RawContextSchema = z
  .object({
    context: text,
    period: text,
    method: text,
    source_ids: z.array(text),
    bands: z.array(RawBandSchema).min(2),
  })
  .strict();
const RawMetricSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9_]+$/),
    abbr: text,
    name_pl: text,
    name_en: text,
    expansion_pl: text,
    expansion_en: text,
    formula: text,
    unit: z.enum(["%", "PLN", "PLN/mies.", "ratio", "months", "hours", "minutes", "days", "score"]),
    interpretation_pl: text,
    interpretation_en: text,
    direction: z.enum(["higher_better", "lower_better", "target_range"]),
    contexts: z.array(RawContextSchema).min(1),
    caveats: z.array(text),
    confidence: z.enum(["niska", "średnia", "wysoka"]),
  })
  .strict();
const RawSourceSchema = z
  .object({
    id: text,
    title: text,
    publisher: text,
    published: text,
    url: text,
    excerpt: z.string(),
    verification: z.enum(["tak", "częściowo", "nie da się sprawdzić"]),
  })
  .strict();
const RawGroupSchema = z
  .object({
    group: text,
    metrics: z.array(RawMetricSchema).min(1),
    sources: z.array(RawSourceSchema),
    changelog: z.array(z.string()).optional(),
  })
  .strict();
type RawMetric = z.infer<typeof RawMetricSchema>;
type RawContext = z.infer<typeof RawContextSchema>;
type RawSource = z.infer<typeof RawSourceSchema>;
/** Plik danych badaczy (`<grupa>.json`) po walidacji. */
export type RawGroup = z.infer<typeof RawGroupSchema>;

const BiSchema = z.object({ pl: text, en: text }).strict();

const OverlayContextSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9_]+\.[a-z0-9_]{1,32}$/, "id: <key>.<slug [a-z0-9_]{1,32}>"),
    label_en: text,
    method_en: text,
    period_en: text,
    segments: z.array(z.enum(SEGMENTS)).min(1),
    measure: z.enum(MEASURES),
    unit: z.enum(UNITS),
    display_unit: z.enum(DISPLAY_UNITS).optional(),
    currency: z.enum(["PLN", "USD"]).optional(),
    vat: z.enum(["net", "gross"]).optional(),
    window: z.enum(WINDOWS),
    direction: z.enum(["higher", "lower", "range"]).optional(),
    notes_en: z.record(digits, text).optional(),
    basis_e: z.array(z.number().int().nonnegative()).optional(),
  })
  .strict();
const OverlayMetricSchema = z
  .object({
    metric_id: z
      .string()
      .regex(/^[a-z0-9_]+$/)
      .nullable()
      .optional(),
    no_metric_reason: BiSchema.optional(),
    primary: z.literal(true).optional(),
    abbr: text.optional(),
    merge_into: z.enum(BENCH_GROUPS).optional(),
    formula_en: text.optional(),
    levers: BiSchema.optional(),
    caveats_en: z.array(text),
    caveat_sources: z.record(digits, z.array(text).min(1)).optional(),
    pairs: z.array(text).optional(),
    review_by: isoDate.optional(),
    default_context_by_segment: z.record(z.enum(SEGMENTS), text).optional(),
    contexts: z.array(OverlayContextSchema),
  })
  .strict();
const OverlaySourceSchema = z
  .object({
    canonical: z
      .string()
      .regex(/^[a-z0-9_]+$/)
      .optional(),
    reliability: z.enum(["A", "B", "C"]).optional(),
    vendor: z.literal(true).optional(),
    drop_reason: text.optional(),
  })
  .strict();
const OverlaySchema = z
  .object({
    schema: z.literal("nes-benchmark-overlay/1"),
    group: z.enum(BENCH_GROUPS),
    source_file: text,
    metrics: z.record(z.string(), OverlayMetricSchema),
    sources: z.record(z.string(), OverlaySourceSchema),
  })
  .strict();
type OverlayContext = z.infer<typeof OverlayContextSchema>;
type OverlaySource = z.infer<typeof OverlaySourceSchema>;
/** Nakładka redakcyjna (`<grupa>.overlay.json`) po walidacji - schemat PLAN S6 §3.3. */
export type Overlay = z.infer<typeof OverlaySchema>;

// ---------------------------------------------------------------------------
// Wynik
// ---------------------------------------------------------------------------

export interface GroupInput {
  file: GroupFile;
  data: unknown;
  overlay: unknown;
}

/**
 * Wpis rejestru po imporcie. `metricId` jest tu napisem: importer sprawdza go
 * ze słownikiem metryk w czasie wykonania, a zawężenie do `MetricId` daje
 * dopiero kompilacja wygenerowanego modułu.
 */
export type RegistryBenchmark = Omit<GeneratedBenchmark, "metricId" | "contexts"> & {
  metricId?: string;
  contexts: GeneratedContext[];
};

export interface RegistryIndexEntry {
  key: string;
  abbr: string;
  group: BenchGroup;
  metricId?: string;
  primary?: true;
}

export interface RegistryStats {
  entries: number;
  contexts: number;
  bands: number;
  canonicalSources: number;
  /** Wpisy źródeł z plików grup rozwiązane przez aliasy `<grupa>:<id>`. */
  aliases: number;
  droppedSources: number;
}

export interface Registry {
  groups: readonly BenchGroup[];
  files: readonly GroupFile[];
  benchmarks: ReadonlyMap<BenchGroup, readonly RegistryBenchmark[]>;
  sources: readonly BenchSource[];
  index: readonly RegistryIndexEntry[];
  pairs: Readonly<Record<string, readonly string[]>>;
  /** SHA-256 treści kanonicznej każdej pary plików (dane + nakładka). */
  inputHashes: ReadonlyMap<GroupFile, string>;
  /** Pliki, z których powstała treść grupy (własny + scalone wpisy, D1). */
  contributors: ReadonlyMap<BenchGroup, readonly GroupFile[]>;
  warnings: readonly string[];
  stats: RegistryStats;
}

/** Błąd walidacji z PEŁNĄ listą problemów - poprawka jednego nie ukrywa reszty. */
export class BenchmarkImportError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(
      `Import benchmarków przerwany (${problems.length} problemów):\n- ${problems.join("\n- ")}`,
    );
    this.name = "BenchmarkImportError";
    this.problems = problems;
  }
}

// ---------------------------------------------------------------------------
// Pomocnicze
// ---------------------------------------------------------------------------

/**
 * Adres źródła w postaci porównywalnej (D2): host małymi literami, bez `www.`,
 * bez końcowego `/`, bez parametrów `utm_*` i fragmentu. Ten sam raport bywał
 * zapisany z `www.` i bez (`mather_q1_2026`) albo pod trzema identyfikatorami
 * w trzech grupach - po normalizacji to jeden wpis kanoniczny z aliasami.
 */
export function normalizeSourceUrl(raw: string): string {
  const u = new URL(raw.trim());
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  const port = u.port ? `:${u.port}` : "";
  const params = [...u.searchParams.entries()].filter(([k]) => !/^utm_/i.test(k));
  const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : "";
  const pathname = u.pathname.replace(/\/+$/, "");
  return `${u.protocol}//${host}${port}${pathname}${query}`;
}

function sha256(textValue: string): string {
  return createHash("sha256").update(textValue).digest("hex");
}

/**
 * Treść kanoniczna wejścia: `JSON.stringify` po parsowaniu. Przeformatowanie
 * pliku Prettierem (wcięcia, zawijanie) nie zmienia skrótu, zmiana liczby - tak.
 */
function canonicalHash(input: GroupInput): string {
  return sha256(`${JSON.stringify(input.data)}\n${JSON.stringify(input.overlay)}`);
}

function addMonths(isoDay: string, months: number): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  const index = y * 12 + (m - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Zdanie zakończone kropką - metoda i okres sklejane w jeden opis. */
function closeSentence(s: string): string {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
}

/**
 * Wartość w skali pasm: kwoty w jednostkach podrzędnych (grosze, centy -
 * liczby całkowite), minuty i dni w godzinach. Zaokrąglenie usuwa ogon
 * zmiennoprzecinkowy (12,64 × 100 = 1264,0000000000002), żeby wygenerowany
 * plik zawierał liczby z danych, a nie artefakty arytmetyki.
 */
function scaleValue(v: number | null, unit: BenchUnit, display?: BenchDisplayUnit): number | null {
  if (v === null) return null;
  if (unit === "money_minor") return Math.round(v * 100);
  if (display === "minutes") return Number((v / 60).toPrecision(12));
  if (display === "days") return Number((v * 24).toPrecision(12));
  return v;
}

const POLISH_LETTERS = /[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/;

/**
 * Samodzielne słowa będące klasami Tailwinda, których nie ma w arkuszu
 * publicznym: treść grup leży w `src/lib/**`, który skanuje arkusz publiczny
 * (`src/styles.css`), więc takie słowo w zdaniu dokłada regułę CSS do
 * zamrożonego budżetu `publicCss` (PLAN S6 §0).
 */
const TAILWIND_WORDS =
  /(?<![\w-])(table|contents|isolate|collapse|invisible|italic|ordinal|grow|shrink|sticky)(?![\w-])/;

function rank(r: "A" | "B" | "C"): number {
  return r === "A" ? 3 : r === "B" ? 2 : 1;
}

// ---------------------------------------------------------------------------
// Budowa rejestru
// ---------------------------------------------------------------------------

interface ParsedGroup {
  file: GroupFile;
  group: BenchGroup;
  data: RawGroup;
  overlay: Overlay;
}

interface SourceMember {
  file: GroupFile;
  raw: RawSource;
  ov: OverlaySource;
}

/**
 * Rejestr z wejść (dane + nakładka per grupa). Czysta funkcja: zero I/O,
 * pełna lista problemów w `BenchmarkImportError`. `knownMetricIds` - słownik
 * metryk (CLI podaje `METRICS`); bez niego `metric_id` sprawdza dopiero
 * kompilacja wygenerowanego modułu.
 */
export function buildRegistry(
  inputs: readonly GroupInput[],
  opts: { knownMetricIds?: ReadonlySet<string> } = {},
): Registry {
  const problems: string[] = [];
  const warnings: string[] = [];
  const fail = (where: string, msg: string): void => {
    problems.push(`${where}: ${msg}`);
  };
  const checkEn = (where: string, value: string): void => {
    if (POLISH_LETTERS.test(value)) warnings.push(`${where}: polskie znaki w tekście EN`);
    const word = TAILWIND_WORDS.exec(value);
    if (word) warnings.push(`${where}: słowo-klasa Tailwinda „${word[1]}” w tekście EN`);
  };

  // 1. Parsowanie i zgodność plików ----------------------------------------
  const parsed: ParsedGroup[] = [];
  const inputHashes = new Map<GroupFile, string>();
  const sortedInputs = [...inputs].sort(
    (a, b) => GROUP_FILES.indexOf(a.file) - GROUP_FILES.indexOf(b.file),
  );
  for (const input of sortedInputs) {
    if (inputHashes.has(input.file)) {
      fail(input.file, "grupa podana dwa razy");
      continue;
    }
    inputHashes.set(input.file, canonicalHash(input));
    const data = RawGroupSchema.safeParse(input.data);
    const overlay = OverlaySchema.safeParse(input.overlay);
    if (!data.success) {
      for (const issue of data.error.issues) {
        fail(`${input.file}.json:${issue.path.join(".")}`, issue.message);
      }
    }
    if (!overlay.success) {
      for (const issue of overlay.error.issues) {
        fail(`${input.file}.overlay.json:${issue.path.join(".")}`, issue.message);
      }
    }
    if (!data.success || !overlay.success) continue;
    const group = GROUP_OF_FILE[input.file];
    if (data.data.group !== input.file) {
      fail(`${input.file}.json`, `pole group = „${data.data.group}”, oczekiwano „${input.file}”`);
    }
    if (overlay.data.group !== group) {
      fail(
        `${input.file}.overlay.json`,
        `pole group = „${overlay.data.group}”, oczekiwano „${group}”`,
      );
    }
    if (overlay.data.source_file !== `${input.file}.json`) {
      fail(`${input.file}.overlay.json`, `source_file musi wskazywać „${input.file}.json”`);
    }
    const keys = new Set(data.data.metrics.map((m) => m.key));
    for (const m of data.data.metrics) {
      if (!overlay.data.metrics[m.key])
        fail(`${input.file}.overlay.json`, `brak wpisu metrics.${m.key}`);
    }
    for (const k of Object.keys(overlay.data.metrics)) {
      if (!keys.has(k)) fail(`${input.file}.overlay.json`, `metrics.${k} nie istnieje w danych`);
    }
    const sourceIds = new Set<string>();
    for (const s of data.data.sources) {
      if (sourceIds.has(s.id)) fail(`${input.file}.json`, `zdublowane id źródła ${s.id}`);
      sourceIds.add(s.id);
      if (!overlay.data.sources[s.id]) {
        fail(`${input.file}.overlay.json`, `brak wpisu sources.${s.id} (wiarygodność A/B/C)`);
      }
    }
    for (const k of Object.keys(overlay.data.sources)) {
      if (!sourceIds.has(k))
        fail(`${input.file}.overlay.json`, `sources.${k} nie istnieje w danych`);
    }
    parsed.push({ file: input.file, group, data: data.data, overlay: overlay.data });
  }
  if (problems.length > 0) throw new BenchmarkImportError(problems);

  // 2. Kanonizacja źródeł (D2, D9) ------------------------------------------
  const byUrl = new Map<string, SourceMember[]>();
  const dropped = new Set<string>();
  for (const g of parsed) {
    for (const raw of g.data.sources) {
      const ov = g.overlay.sources[raw.id] ?? {};
      const where = `${g.file}.sources.${raw.id}`;
      if (ov.drop_reason) {
        dropped.add(`${g.file}:${raw.id}`);
        continue;
      }
      if (!ov.reliability) fail(where, "brak reliability w nakładce");
      if (!raw.url.trim().startsWith("https://")) {
        fail(where, `adres musi być https (${raw.url})`);
        continue;
      }
      let key: string;
      try {
        key = normalizeSourceUrl(raw.url);
      } catch {
        fail(where, `niepoprawny URL ${raw.url}`);
        continue;
      }
      const members = byUrl.get(key) ?? [];
      members.push({ file: g.file, raw, ov });
      byUrl.set(key, members);
    }
  }
  const localToCanonical = new Map<string, string>();
  const sources: BenchSource[] = [];
  const canonicalOwner = new Map<string, string>();
  for (const [url, members] of byUrl) {
    const fromOverlay = [
      ...new Set(members.flatMap((m) => (m.ov.canonical ? [m.ov.canonical] : []))),
    ];
    if (fromOverlay.length > 1) {
      fail(`źródło ${url}`, `sprzeczne canonical w nakładkach: ${fromOverlay.join(", ")}`);
    }
    const firstSlug = members.find((m) => !/^S\d+$/.test(m.raw.id));
    const first = members[0];
    const canonical =
      fromOverlay[0] ??
      firstSlug?.raw.id ??
      `${first.file}_s${first.raw.id.replace(/^S/, "").toLowerCase()}`;
    if (/^s\d+$/i.test(canonical))
      fail(`źródło ${url}`, `kanoniczny id „${canonical}” ma postać S<n>`);
    const owner = canonicalOwner.get(canonical);
    if (owner !== undefined) {
      fail(`źródło ${url}`, `kanoniczny id „${canonical}” zajęty już przez ${owner}`);
    }
    canonicalOwner.set(canonical, url);
    for (const m of members) localToCanonical.set(`${m.file}:${m.raw.id}`, canonical);
    const verified = members.some((m) => m.raw.verification === "tak");
    const reliability = members
      .map((m) => (m.raw.verification === "nie da się sprawdzić" ? "C" : (m.ov.reliability ?? "C")))
      .reduce<"A" | "B" | "C">((low, r) => (rank(r) < rank(low) ? r : low), "A");
    const vendor = members.some((m) => m.ov.vendor === true);
    sources.push({
      id: canonical,
      aliases: members.map((m) => `${m.file}:${m.raw.id}`),
      title: first.raw.title,
      publisher: first.raw.publisher,
      published: first.raw.published,
      url: first.raw.url.trim(),
      accessed: "2026-10-18",
      reliability,
      verification: verified ? "full" : "snippet",
      ...(vendor ? { vendor: true as const } : {}),
      excerpt: first.raw.excerpt,
    });
  }

  // 3. Wpisy i konteksty -----------------------------------------------------
  const used = new Set<string>();
  const resolveSource = (file: GroupFile, local: string, where: string): string | null => {
    const ref = `${file}:${local}`;
    if (dropped.has(ref)) {
      fail(where, `źródło ${local} ma drop_reason, a jest użyte`);
      return null;
    }
    const canonical = localToCanonical.get(ref);
    if (canonical === undefined) {
      fail(where, `nieznane źródło ${local}`);
      return null;
    }
    used.add(ref);
    return canonical;
  };

  const entriesByGroup = new Map<BenchGroup, RegistryBenchmark[]>();
  const contributors = new Map<BenchGroup, GroupFile[]>();
  const pairs: Record<string, string[]> = {};
  const merges: {
    from: GroupFile;
    target: BenchGroup;
    key: string;
    contexts: GeneratedContext[];
    caveats: RegistryBenchmark["caveats"];
  }[] = [];
  const keyOwner = new Map<string, GroupFile>();
  const contextIds = new Map<string, string>();

  for (const g of parsed) {
    if (!contributors.has(g.group)) contributors.set(g.group, [g.file]);
    const list: RegistryBenchmark[] = [];
    for (const raw of g.data.metrics) {
      const ov = g.overlay.metrics[raw.key];
      const where = `${g.file}.${raw.key}`;
      if (!ov) continue;
      const entryDirection = DIRECTION_OF[raw.direction];

      if (ov.caveats_en.length !== raw.caveats.length) {
        fail(where, `caveats_en ma ${ov.caveats_en.length} pozycji, dane ${raw.caveats.length}`);
      }
      if (ov.contexts.length !== raw.contexts.length) {
        fail(where, `contexts ma ${ov.contexts.length} pozycji, dane ${raw.contexts.length}`);
        continue;
      }
      const caveatSources = ov.caveat_sources ?? {};
      for (const idx of Object.keys(caveatSources)) {
        if (Number(idx) >= raw.caveats.length) fail(where, `caveat_sources.${idx} poza zakresem`);
      }
      const caveats: RegistryBenchmark["caveats"] = raw.caveats.map((pl, i) => {
        const en = ov.caveats_en[i] ?? "";
        checkEn(`${where}.caveats_en[${i}]`, en);
        const ids = (caveatSources[String(i)] ?? [])
          .map((local) => resolveSource(g.file, local, `${where}.caveat_sources.${i}`))
          .filter((x): x is string => x !== null);
        const unique = [...new Set(ids)];
        return unique.length > 0 ? { text: { pl, en }, sourceIds: unique } : { text: { pl, en } };
      });

      const contexts: GeneratedContext[] = [];
      raw.contexts.forEach((rc, i) => {
        const built = buildContext(g.file, raw, rc, ov.contexts[i], `${where}.contexts[${i}]`);
        if (built) contexts.push(built);
      });

      if (ov.merge_into) {
        if (
          ov.levers ||
          ov.formula_en ||
          ov.pairs ||
          ov.default_context_by_segment ||
          ov.metric_id !== undefined
        ) {
          fail(where, "wpis scalany (merge_into) niesie tylko konteksty i zastrzeżenia");
        }
        merges.push({ from: g.file, target: ov.merge_into, key: raw.key, contexts, caveats });
        continue;
      }

      const previous = keyOwner.get(raw.key);
      if (previous) fail(where, `klucz ${raw.key} istnieje już w grupie ${previous}`);
      keyOwner.set(raw.key, g.file);

      if (ov.metric_id === undefined) fail(where, "brak metric_id (MetricId albo null)");
      const metricId = ov.metric_id ?? undefined;
      if (metricId && opts.knownMetricIds && !opts.knownMetricIds.has(metricId)) {
        fail(where, `metric_id „${metricId}” nie istnieje w słowniku metryk`);
      }
      if (ov.metric_id === null && !ov.no_metric_reason) {
        fail(where, "metric_id null wymaga no_metric_reason {pl, en}");
      }
      if (ov.metric_id && ov.no_metric_reason)
        fail(where, "no_metric_reason tylko przy metric_id null");
      if (!ov.formula_en) fail(where, "brak formula_en");
      if (!ov.levers) fail(where, "brak levers {pl, en}");
      if (ov.levers) {
        for (const lang of ["pl", "en"] as const) {
          if (ov.levers[lang].length > MAX_LEVER_CHARS) {
            fail(
              where,
              `levers.${lang} ma ${ov.levers[lang].length} znaków (limit ${MAX_LEVER_CHARS})`,
            );
          }
        }
        checkEn(`${where}.levers.en`, ov.levers.en);
      }
      if (ov.formula_en) checkEn(`${where}.formula_en`, ov.formula_en);
      if (ov.no_metric_reason) checkEn(`${where}.no_metric_reason.en`, ov.no_metric_reason.en);
      if (!ov.default_context_by_segment?.all)
        fail(where, "default_context_by_segment.all jest wymagane");
      if (ov.pairs && ov.pairs.length > 0) pairs[raw.key] = [...ov.pairs];

      const confidence = CONFIDENCE_OF[raw.confidence];
      const entry: RegistryBenchmark = {
        key: raw.key,
        ...(metricId ? { metricId } : {}),
        group: g.group,
        abbr: ov.abbr ?? raw.abbr,
        name: { pl: raw.name_pl, en: raw.name_en },
        expansion: { pl: raw.expansion_pl, en: raw.expansion_en },
        formula: { pl: raw.formula, en: ov.formula_en ?? "" },
        interpretation: { pl: raw.interpretation_pl, en: raw.interpretation_en },
        levers: ov.levers ?? { pl: "", en: "" },
        caveats,
        direction: entryDirection,
        confidence,
        asOf: REGISTRY_AS_OF,
        // Pewność niska = krótszy termin przeglądu: heurystyka starzeje się
        // szybciej niż kwartyl z badania z próbą.
        reviewBy: ov.review_by ?? addMonths(REGISTRY_AS_OF, confidence === "low" ? 6 : 12),
        contexts,
        defaultContextBySegment: { ...(ov.default_context_by_segment ?? {}) },
        ...(ov.no_metric_reason ? { noMetricReason: ov.no_metric_reason } : {}),
      };
      list.push(entry);
    }
    const existing = entriesByGroup.get(g.group) ?? [];
    entriesByGroup.set(g.group, [...existing, ...list]);
  }

  // Scalenie zduplikowanych wpisów (D1: ekonomika.arpu → przychód.arpu).
  for (const m of merges) {
    const target = entriesByGroup.get(m.target)?.find((e) => e.key === m.key);
    if (!target) {
      fail(
        `${m.from}.${m.key}`,
        `merge_into: brak wpisu ${m.key} w grupie ${m.target} (wczytaj ją)`,
      );
      continue;
    }
    target.contexts.push(...m.contexts);
    target.caveats.push(...m.caveats);
    const list = contributors.get(m.target) ?? [];
    if (!list.includes(m.from)) list.push(m.from);
    contributors.set(m.target, list);
  }

  // 4. Kontrole całego rejestru ---------------------------------------------
  const allEntries = [...entriesByGroup.values()].flat();
  const allKeys = new Set(allEntries.map((e) => e.key));
  const abbrOwner = new Map<string, string>();
  for (const e of allEntries) {
    const where = `${e.group}.${e.key}`;
    const abbrKey = e.abbr.toLowerCase();
    const prev = abbrOwner.get(abbrKey);
    if (prev) fail(where, `skrót „${e.abbr}” zajęty już przez ${prev} (D10)`);
    abbrOwner.set(abbrKey, e.key);
    for (const c of e.contexts) {
      const owner = contextIds.get(c.id);
      if (owner) fail(where, `id kontekstu ${c.id} zajęte już przez ${owner}`);
      contextIds.set(c.id, e.key);
      if (!c.id.startsWith(`${e.key}.`))
        fail(where, `id kontekstu ${c.id} musi zaczynać się od „${e.key}.”`);
    }
    for (const seg of SEGMENTS) {
      const ctxId = e.defaultContextBySegment[seg];
      if (ctxId === undefined) continue;
      const ctx = e.contexts.find((c) => c.id === ctxId);
      // Kontekst „all” pasuje do każdego segmentu; inny musi go jawnie obejmować,
      // inaczej domyślna ocena porównałaby np. członkostwa z pasmem SaaS B2B.
      if (!ctx) {
        fail(where, `default_context_by_segment.${seg} → nieznany kontekst ${ctxId}`);
      } else if (seg !== "all" && !ctx.segments.includes("all") && !ctx.segments.includes(seg)) {
        fail(
          where,
          `default_context_by_segment.${seg} → kontekst ${ctxId} nie obejmuje segmentu ${seg}`,
        );
      }
    }
    for (const p of pairs[e.key] ?? []) {
      if (p === e.key) fail(where, "para wskazuje sam wpis");
      else if (!allKeys.has(p)) {
        if (parsed.length === GROUP_FILES.length) fail(where, `para → nieznany wpis ${p}`);
        else warnings.push(`${where}: para → ${p} spoza wczytanych grup (niesprawdzona)`);
      }
    }
  }
  const byMetric = new Map<string, RegistryBenchmark[]>();
  for (const e of allEntries) {
    if (!e.metricId) continue;
    byMetric.set(e.metricId, [...(byMetric.get(e.metricId) ?? []), e]);
  }
  const primaryKeys = new Set<string>();
  for (const g of parsed) {
    for (const [key, ov] of Object.entries(g.overlay.metrics)) {
      if (ov.primary) primaryKeys.add(key);
    }
  }
  for (const [metricId, list] of byMetric) {
    const primaries = list.filter((e) => primaryKeys.has(e.key));
    if (list.length > 1 && primaries.length !== 1) {
      fail(
        `metric_id ${metricId}`,
        `${list.length} wpisy wymagają dokładnie jednego primary (jest ${primaries.length})`,
      );
    }
    if (list.length === 1 && primaries.length > 0) {
      fail(`metric_id ${metricId}`, "primary tylko gdy kilka wpisów wskazuje ten sam MetricId");
    }
  }

  // D3: każde źródło przypięte do kontekstu albo zastrzeżenia, inaczej drop_reason.
  for (const g of parsed) {
    for (const raw of g.data.sources) {
      const ref = `${g.file}:${raw.id}`;
      if (!dropped.has(ref) && !used.has(ref)) {
        fail(
          `${g.file}.sources.${raw.id}`,
          "źródło nieużyte - przypnij w caveat_sources albo podaj drop_reason (D3)",
        );
      }
    }
  }

  if (problems.length > 0) throw new BenchmarkImportError(problems);

  const groups = BENCH_GROUPS.filter((g) => entriesByGroup.has(g));
  const index: RegistryIndexEntry[] = [];
  for (const g of groups) {
    for (const e of entriesByGroup.get(g) ?? []) {
      index.push({
        key: e.key,
        abbr: e.abbr,
        group: g,
        ...(e.metricId ? { metricId: e.metricId } : {}),
        ...(primaryKeys.has(e.key) ? { primary: true as const } : {}),
      });
    }
  }
  const usedCanonical = new Set(sources.map((s) => s.id));
  return {
    groups,
    files: parsed.map((p) => p.file),
    benchmarks: entriesByGroup,
    sources,
    index,
    pairs,
    inputHashes,
    contributors,
    warnings,
    stats: {
      entries: allEntries.length,
      contexts: allEntries.reduce((n, e) => n + e.contexts.length, 0),
      bands: allEntries.reduce((n, e) => n + e.contexts.reduce((k, c) => k + c.bands.length, 0), 0),
      canonicalSources: usedCanonical.size,
      aliases: sources.reduce((n, s) => n + s.aliases.length, 0),
      droppedSources: dropped.size,
    },
  };

  // -------------------------------------------------------------------------
  // Kontekst (zamknięcie: dzieli `fail`, `checkEn`, `resolveSource`)
  // -------------------------------------------------------------------------
  function buildContext(
    file: GroupFile,
    metric: RawMetric,
    rc: RawContext,
    oc: OverlayContext | undefined,
    where: string,
  ): GeneratedContext | null {
    if (!oc) {
      fail(where, "brak kontekstu w nakładce");
      return null;
    }
    checkEn(`${where}.label_en`, oc.label_en);
    checkEn(`${where}.method_en`, oc.method_en);
    checkEn(`${where}.period_en`, oc.period_en);

    // Jednostka, wielkość, waluta, VAT (D6-D7).
    const rule = UNIT_RULES[metric.unit].find(
      (r) => r.unit === oc.unit && r.display === oc.display_unit,
    );
    if (!rule) {
      fail(
        where,
        `jednostka ${oc.unit}${oc.display_unit ? `/${oc.display_unit}` : ""} niezgodna z jednostką danych „${metric.unit}”`,
      );
    }
    if (oc.unit === "money_minor") {
      if (!oc.currency || !oc.vat) fail(where, "kontekst pieniężny wymaga currency i vat");
    } else if (oc.currency || oc.vat) {
      fail(where, "currency/vat tylko przy money_minor");
    }
    if (metric.unit.startsWith("PLN") && oc.unit === "percent_pt" && oc.measure === "level") {
      fail(where, "procent przy metryce pieniężnej nie jest poziomem - ustaw measure (D6)");
    }
    const expected = expectedWindow(rc.period);
    if (expected && expected !== oc.window) {
      fail(where, `okres „${rc.period}” → window ${expected}, nakładka ma ${oc.window} (D8)`);
    }

    // Pasma: etykiety, noty, kwalifikatory, podstawa B/E, skala.
    const notesEn = oc.notes_en ?? {};
    const basisE = new Set(oc.basis_e ?? []);
    for (const idx of basisE) {
      if (idx >= rc.bands.length) fail(where, `basis_e ${idx} poza zakresem pasm`);
    }
    for (const idx of Object.keys(notesEn)) {
      if (Number(idx) >= rc.bands.length) fail(where, `notes_en.${idx} poza zakresem pasm`);
    }
    const bands: BenchBand[] = [];
    rc.bands.forEach((rb, i) => {
      const m = /^(\S+)(?:\s*\((.+)\))?$/.exec(rb.label.trim());
      const tier = m ? TIER_OF_LABEL[m[1]] : undefined;
      if (!m || !tier) {
        fail(`${where}.bands[${i}]`, `nieznana etykieta „${rb.label}”`);
        return;
      }
      const qualifier = m[2]?.trim();
      const notePl = [qualifier, rb.note].filter((x): x is string => Boolean(x)).join("; ");
      const noteEn = notesEn[String(i)];
      if (notePl && !noteEn)
        fail(`${where}.bands[${i}]`, "pasmo z notą lub kwalifikatorem wymaga notes_en");
      if (!notePl && noteEn) fail(`${where}.bands[${i}]`, "notes_en dla pasma bez noty");
      if (noteEn) checkEn(`${where}.notes_en.${i}`, noteEn);
      // Podstawa E = heurystyka: wskazana w nocie albo przez redakcję
      // (metoda mówi „granica słaby/krytyczny to heurystyka”).
      const basis = /heurysty/i.test(notePl) || basisE.has(i) ? "E" : "B";
      const unit = rule?.unit ?? oc.unit;
      const band: BenchBand = {
        tier,
        min: scaleValue(rb.min, unit, oc.display_unit),
        max: scaleValue(rb.max, unit, oc.display_unit),
        ...(notePl ? { note: { pl: notePl, en: noteEn ?? "" } } : {}),
        basis,
      };
      bands.push(band);
    });
    if (bands.length !== rc.bands.length) return null;

    // D5: sortowanie, ciągłość, otwarte końce tylko na brzegach.
    bands.sort((a, b) => (a.min ?? Number.NEGATIVE_INFINITY) - (b.min ?? Number.NEGATIVE_INFINITY));
    bands.forEach((b, i) => {
      if (b.min === null && i > 0)
        fail(where, "otwarty początek (min null) tylko w pierwszym paśmie");
      if (b.max === null && i < bands.length - 1)
        fail(where, "otwarty koniec (max null) tylko w ostatnim paśmie");
      if (b.min !== null && b.max !== null && !(b.min < b.max))
        fail(where, `pasmo [${b.min}, ${b.max}) puste lub odwrócone`);
      const next = bands[i + 1];
      if (next && b.max !== next.min)
        fail(where, `przerwa lub zakładka pasm: ${b.max} ≠ ${next.min}`);
    });

    // D4: kierunek per kontekst z sekwencji rang.
    const direction = contextDirection({ bands });
    if (direction === "range") {
      const ranks = bands.map((b) =>
        ["critical", "weak", "normal", "good", "optimal"].indexOf(b.tier),
      );
      const peak = ranks.indexOf(Math.max(...ranks));
      const rising = ranks.slice(0, peak + 1).every((r, i, a) => i === 0 || r >= a[i - 1]);
      const falling = ranks.slice(peak).every((r, i, a) => i === 0 || r <= a[i - 1]);
      if (!rising || !falling) fail(where, "pasma ani monotoniczne, ani jednomodalne (D5)");
    }
    if (oc.direction && oc.direction !== direction) {
      fail(where, `direction w nakładce = ${oc.direction}, z pasm wynika ${direction} (D4)`);
    }
    const declared = DIRECTION_OF[metric.direction];
    if (declared !== "range" && direction !== declared && oc.direction !== direction) {
      fail(
        where,
        `wskaźnik ${declared}, a pasma dają ${direction} - potwierdź direction w nakładce (D4)`,
      );
    }

    // Źródła kontekstu (D2, D11).
    const sourceIds = [
      ...new Set(
        rc.source_ids
          .map((local) => resolveSource(file, local, where))
          .filter((x): x is string => x !== null),
      ),
    ];
    if (sourceIds.length === 0)
      fail(where, "kontekst bez źródła (pasmo bez przypisu nie istnieje)");
    if (sourceIds.length > MAX_SOURCES_PER_CONTEXT) {
      fail(where, `${sourceIds.length} źródeł (limit ${MAX_SOURCES_PER_CONTEXT}, D11)`);
    }

    return {
      id: oc.id,
      label: { pl: rc.context, en: oc.label_en },
      segments: [...oc.segments],
      measure: oc.measure,
      unit: oc.unit,
      ...(oc.display_unit ? { displayUnit: oc.display_unit } : {}),
      ...(oc.currency ? { currency: oc.currency } : {}),
      ...(oc.vat ? { vat: oc.vat } : {}),
      window: oc.window,
      direction,
      method: {
        pl: `${closeSentence(rc.method)} Okres: ${closeSentence(rc.period)}`,
        en: `${closeSentence(oc.method_en)} Period: ${closeSentence(oc.period_en)}`,
      },
      sourceIds,
      bands,
    };
  }
}

// ---------------------------------------------------------------------------
// Generowanie modułów
// ---------------------------------------------------------------------------

export interface ModuleHeader {
  /** Pliki wejściowe (ścieżki względem korzenia repo). */
  inputs: readonly string[];
  sha256: string;
}

function headerLines(h: ModuleHeader, purpose: readonly string[]): string {
  return [
    "// PLIK GENEROWANY przez scripts/benchmarks/import-benchmarks.ts - nie edytuj ręcznie.",
    `// Wejście: ${h.inputs.join(", ")}`,
    `// SHA-256 treści kanonicznej wejść: ${h.sha256}`,
    "// Zmiana treści = poprawka danych albo nakładki w docs/benchmarki i ponowny import;",
    "// `--check` wykrywa ręczną edycję tego pliku i nieuruchomiony importer.",
    "//",
    ...purpose.map((l) => (l === "" ? "//" : `// ${l}`)),
  ].join("\n");
}

/** Moduł treści jednej grupy (`groups/<group>.server.ts`) - tylko serwer. */
export function renderGroupModule(
  group: BenchGroup,
  benchmarks: readonly RegistryBenchmark[],
  header: ModuleHeader,
): string {
  return `${headerLines(header, [
    `Treść grupy „${group}” - WYŁĄCZNIE serwer (sufiks .server). Klient dostaje ją`,
    "zlokalizowaną przez `getBenchmarkGroup`; import z komponentu wciągnąłby oba",
    "języki do chunku panelu (bramka: __tests__/clientBoundary.test.ts).",
  ])}
import type { GeneratedBenchmark } from "../adapter";

export const ${EXPORT_NAME[group]}: readonly GeneratedBenchmark[] = ${JSON.stringify(benchmarks, null, 2)};
`;
}

/** Rejestr źródeł (`sources.ts`) - tylko serwer: niesie cytaty (`excerpt`). */
export function renderSourcesModule(sources: readonly BenchSource[], header: ModuleHeader): string {
  return `${headerLines(header, [
    "Globalny rejestr źródeł benchmarków (D2): jeden wpis na znormalizowany URL,",
    "aliasy `<grupa>:<id lokalne>` z plików badaczy. Moduł TYLKO dla serwera -",
    "niesie cytaty (`excerpt`), których klient nigdy nie dostaje.",
  ])}
import type { BenchSource } from "./types";

export const BENCHMARK_SOURCES: readonly BenchSource[] = ${JSON.stringify(sources, null, 2)};

const BY_ID = new Map<string, BenchSource>(BENCHMARK_SOURCES.map((s) => [s.id, s]));
const BY_ALIAS = new Map<string, string>(
  BENCHMARK_SOURCES.flatMap((s) => s.aliases.map((a): [string, string] => [a, s.id])),
);

/** Źródło po identyfikatorze kanonicznym. */
export function sourceById(id: string): BenchSource | undefined {
  return BY_ID.get(id);
}

/** Identyfikator kanoniczny z aliasu \`<grupa>:<id>\` albo z samego id kanonicznego. */
export function canonicalSourceId(alias: string): string | undefined {
  return BY_ID.has(alias) ? alias : BY_ALIAS.get(alias);
}
`;
}

/** Lekki indeks klienta (`index.ts`) - szablon PLAN S6 §3.2. */
export function renderIndexModule(registry: Registry, header: ModuleHeader): string {
  return `${headerLines(header, [
    "Lekki indeks benchmarków - moduł KLIENTA: klucz, skrót, grupa, metryka",
    "i pary obowiązkowe. Treść (pasma, metody, źródła) pobiera `getBenchmarkGroup`.",
  ])}
import type { MetricId } from "../metrics";
import type { BenchGroup } from "./types";

export const BENCH_GROUPS: readonly BenchGroup[] = ${JSON.stringify(registry.groups)};

/** Stan rejestru = data dostępu do źródeł; typ literalny (stała bez adnotacji). */
export const BENCHMARK_REGISTRY_AS_OF = "${REGISTRY_AS_OF}";

export interface BenchmarkIndexEntry {
  key: string;
  abbr: string;
  group: BenchGroup;
  metricId?: MetricId;
  primary?: true;
}

export const BENCHMARK_INDEX: readonly BenchmarkIndexEntry[] = ${JSON.stringify(registry.index, null, 2)};

/** Pary obowiązkowe w UI (brief 05 §5): wskaźnik → wskaźniki, bez których jest mylący. */
export const BENCHMARK_PAIRS: Readonly<Record<string, readonly string[]>> = ${JSON.stringify(registry.pairs, null, 2)};

export function benchmarkIndexEntry(key: string): BenchmarkIndexEntry | undefined {
  return BENCHMARK_INDEX.find((e) => e.key === key);
}

/** Wszystkie wpisy wskazujące metrykę (np. trzy e-maile ścieżek → jedna metryka). */
export function benchmarksForMetric(id: MetricId): readonly BenchmarkIndexEntry[] {
  return BENCHMARK_INDEX.filter((e) => e.metricId === id);
}

/** Wpis wiodący metryki: oznaczony \`primary\` albo jedyny. */
export function primaryBenchmarkFor(id: MetricId): BenchmarkIndexEntry | undefined {
  const all = benchmarksForMetric(id);
  return all.find((e) => e.primary === true) ?? (all.length === 1 ? all[0] : undefined);
}
`;
}

/** Korzeń repozytorium - względem niego konfiguracja Prettiera i ścieżki w nagłówkach. */
export const REPO_ROOT = repoRoot();

function repoRoot(): string {
  try {
    return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  } catch {
    // Pod happy-dom (vitest) `import.meta.url` nie jest adresem `file:` - testy
    // i tak biegną z korzenia repo, więc katalog roboczy jest tym samym miejscem.
    return process.cwd();
  }
}

function repoRelative(p: string): string {
  return path.relative(REPO_ROOT, p).split(path.sep).join("/");
}

/**
 * Wszystkie pliki rejestru: ścieżka względna → treść sformatowana Prettierem
 * z konfiguracją REPO (także przy `--out` poza repo), żeby plik przeszedł
 * `format:check` i `lint` bez ręcznych poprawek. `index.ts` i `sources.ts`
 * powstają tylko z kompletu sześciu grup - z podzbioru byłyby niepełne.
 */
export async function generateFiles(
  registry: Registry,
  dataDir: string,
): Promise<Map<string, string>> {
  const input = (file: GroupFile): string[] => [
    repoRelative(path.join(dataDir, `${file}.json`)),
    repoRelative(path.join(dataDir, `${file}.overlay.json`)),
  ];
  const hashOf = (files: readonly GroupFile[]): string =>
    sha256(files.map((f) => `${f}:${registry.inputHashes.get(f) ?? ""}`).join("\n"));
  const out = new Map<string, string>();
  for (const group of registry.groups) {
    const files = registry.contributors.get(group) ?? [];
    const rel = `${BENCH_OUT_DIR}/groups/${group}.server.ts`;
    out.set(
      rel,
      renderGroupModule(group, registry.benchmarks.get(group) ?? [], {
        inputs: files.flatMap(input),
        sha256: hashOf(files),
      }),
    );
  }
  const all = { inputs: registry.files.flatMap(input), sha256: hashOf(registry.files) };
  out.set(`${BENCH_OUT_DIR}/sources.ts`, renderSourcesModule(registry.sources, all));
  out.set(`${BENCH_OUT_DIR}/index.ts`, renderIndexModule(registry, all));
  const formatted = new Map<string, string>();
  for (const [rel, source] of out) {
    const target = path.join(REPO_ROOT, rel);
    const config = (await prettier.resolveConfig(target)) ?? {};
    formatted.set(rel, await prettier.format(source, { ...config, filepath: target }));
  }
  return formatted;
}

function readJson(file: string): unknown {
  if (!existsSync(file)) throw new Error(`brak pliku ${file}`);
  return JSON.parse(readFileSync(file, "utf8"));
}

/** Wejścia z katalogu danych: `<grupa>.json` + `<grupa>.overlay.json`. */
export function readGroupInputs(dir: string, files: readonly GroupFile[]): GroupInput[] {
  return files.map((file) => ({
    file,
    data: readJson(path.join(dir, `${file}.json`)),
    overlay: readJson(path.join(dir, `${file}.overlay.json`)),
  }));
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export interface CliIo {
  log: (line: string) => void;
  error: (line: string) => void;
  cwd: string;
  /** Słownik metryk do kontroli `metric_id`; domyślnie `METRICS` z rejestru. */
  knownMetricIds?: ReadonlySet<string>;
}

const USAGE =
  "użycie: bun run scripts/benchmarks/import-benchmarks.ts <katalog> [--check] [--groups przychod,retencja] [--out <katalog>]";

function isGroupFile(x: string): x is GroupFile {
  return (GROUP_FILES as readonly string[]).includes(x);
}

/** Przebieg CLI; zwraca kod wyjścia (0 OK, 1 dryf lub błąd walidacji, 2 złe wywołanie). */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  let dir: string | null = null;
  let check = false;
  let out: string | null = null;
  let files: GroupFile[] = [...GROUP_FILES];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") check = true;
    else if (arg === "--out") out = argv[++i] ?? null;
    else if (arg === "--groups") {
      const list = (argv[++i] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const bad = list.filter((g) => !isGroupFile(g));
      if (bad.length > 0 || list.length === 0) {
        io.error(
          `nieznane grupy: ${bad.join(", ") || "(pusto)"}; dozwolone: ${GROUP_FILES.join(", ")}`,
        );
        return 2;
      }
      files = GROUP_FILES.filter((g) => list.includes(g));
    } else if (arg.startsWith("--")) {
      io.error(`nieznana opcja ${arg}\n${USAGE}`);
      return 2;
    } else if (dir === null) dir = arg;
    else {
      io.error(USAGE);
      return 2;
    }
  }
  if (dir === null || (argv.includes("--out") && out === null)) {
    io.error(USAGE);
    return 2;
  }
  const dataDir = path.resolve(io.cwd, dir);
  const outRoot = path.resolve(io.cwd, out ?? REPO_ROOT);
  const complete = files.length === GROUP_FILES.length;

  let registry: Registry;
  try {
    let known = io.knownMetricIds;
    if (!known) {
      const { METRICS } = await import("../../src/lib/analytics/semantic/metrics");
      known = new Set<string>(METRICS.map((m) => m.id));
    }
    registry = buildRegistry(readGroupInputs(dataDir, files), { knownMetricIds: known });
  } catch (e) {
    io.error(e instanceof Error ? e.message : String(e));
    return 1;
  }
  for (const w of registry.warnings) io.log(`ostrzeżenie: ${w}`);

  const generated = await generateFiles(registry, dataDir);
  if (!complete) {
    // Indeks i rejestr źródeł z podzbioru grup byłyby niepełne - w repo
    // lądują tylko z kompletu. Przy `--out` (przegląd) zapisujemy wszystko.
    io.log("podzbiór grup: index.ts i sources.ts porównywane/zapisywane tylko przy --out");
  }
  const s = registry.stats;
  io.log(
    `rejestr: ${s.entries} wpisów, ${s.contexts} kontekstów, ${s.bands} pasm, ` +
      `${s.canonicalSources} źródeł kanonicznych, ${s.aliases} aliasów, ${s.droppedSources} odrzuconych`,
  );

  const relevant = [...generated].filter(
    ([rel]) => complete || out !== null || rel.includes("/groups/"),
  );
  if (check) {
    const drift = relevant.filter(([rel, content]) => {
      const target = path.join(outRoot, rel);
      return !existsSync(target) || readFileSync(target, "utf8") !== content;
    });
    for (const [rel] of drift) io.error(`dryf: ${rel} różni się od wyniku importera`);
    if (drift.length > 0) {
      io.error("uruchom importer bez --check i zatwierdź wygenerowane pliki");
      return 1;
    }
    io.log(`--check: ${relevant.length} plików zgodnych`);
    return 0;
  }
  for (const [rel, content] of relevant) {
    const target = path.join(outRoot, rel);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, content);
    io.log(`zapisano ${path.relative(io.cwd, target)}`);
  }
  return 0;
}

// Przebieg tylko przy `bun run` tego pliku; import (testy) niczego nie
// uruchamia - konwencja `scripts/i18n-translate-widgets.ts`.
if (import.meta.main) {
  runCli(process.argv.slice(2), {
    log: (l) => console.log(l),
    error: (l) => console.error(l),
    cwd: process.cwd(),
  })
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
}
