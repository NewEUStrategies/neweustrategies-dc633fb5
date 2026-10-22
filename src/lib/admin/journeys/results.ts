// WYNIKI ŚCIEŻKI (S8, SPEC §6.3 „Wyniki” i „Statystyki na kanwie”) - czyste
// przekształcenia `admin_journey_stats` i `admin_journey_series` w wiersze
// kart: lejek kroków, powody wyjścia, tabela maili, werdykt testu A/B, seria
// dzienna i tekst liczb kroku dla nazwy węzła na kanwie.
//
// KOLEJNOŚĆ = NUMERACJA. Kroki idą w kolejności numerów z `buildJourneyView`
// (ta sama, którą widzą kanwa, lista kroków i panel kroku), a nie w kolejności
// `node_id` z bazy - „krok 4.2.1” w lejku musi być tym samym krokiem co na
// kanwie. Kroki ze statystyk, których nie ma w bieżącym grafie (inna wersja
// w oknie), dochodzą na końcu bez numeru - nie znikają, bo ich liczby są
// prawdziwe.
//
// BRAK DANYCH TO NIE ZERO. Krok bez wiersza statystyk, udział bez mianownika,
// dzień sprzed retencji w serii - wszystko to `null` (UI pokazuje kreskę albo
// przerwę na wykresie), nigdy 0, które czytałoby się jak „nikt nie wszedł”.
//
// LICZB BENCHMARKÓW TU NIE MA. Moduł zna wyłącznie IDENTYFIKATORY wpisów
// rejestru S6 (`metricId`, `benchKey`, kontekst) - pasma i oceny liczy
// `useBenchmark` + `evaluateMetricValue` w komponencie.
//
// Moduł czyta kanwa i panel kroku w przeglądarce - bez I/O i bez Reacta.
import type { MetricId } from "@/lib/analytics/semantic/metrics";
import type { ChartLang } from "@/lib/charts/format";
import type {
  JourneyEmailStats,
  JourneyNodeStats,
  JourneySeriesPoint,
  JourneyStatsDto,
  JourneyVariantStats,
} from "@/lib/journeys/dto";
import {
  JOURNEY_EXIT_REASONS,
  JOURNEY_STEP_OUTCOMES,
  type JourneyExitReason,
  type JourneyStepOutcome,
} from "@/lib/journeys/limits";
import { JOURNEY_NODE_TYPES, type JourneyNodeType } from "@/lib/journeys/nodeTypes";
import type { RevenuePeriod } from "@/lib/revenue/search";
import { resolveRevenueRange } from "@/lib/revenue/window";
import type { JourneyEmailContentDto } from "./journeyEditor.functions";
import type { JourneySummary } from "./summaries";
import { buildJourneyView, compareStepNumbers, type JourneyGraphLike } from "./viewModel";

// ── Okno statystyk ───────────────────────────────────────────────────────────

export interface JourneyStatsWindow {
  /** Okres faktycznie policzony (`custom` bez granic w adresie edytora -> `month`). */
  period: RevenuePeriod;
  sinceIso: string;
  untilIso: string;
}

/**
 * Okno statystyk ścieżki z okresu huba - TA SAMA arytmetyka kalendarza co
 * reszta huba (`resolveRevenueRange`). „Teraz” jest kwantowane w środku, więc
 * kanwa, panel kroku i wyniki liczone w tej samej chwili dają identyczny klucz
 * `journeyKeys.stats(…)` i jedno zapytanie zamiast trzech. Edytor nie ma w
 * adresie granic okresu własnego, więc `custom` rozstrzyga się jak `month`
 * (i tak się nazywa w wyniku).
 */
export function journeyStatsWindow(period: RevenuePeriod, nowMs: number): JourneyStatsWindow {
  const range = resolveRevenueRange(period, nowMs);
  return {
    period: range.period,
    sinceIso: range.current.sinceIso,
    untilIso: range.current.untilIso,
  };
}

const KNOWN_NODE_TYPES: ReadonlySet<string> = new Set(JOURNEY_NODE_TYPES);

function nodeTypeOf(value: string | null | undefined): JourneyNodeType | null {
  return value && KNOWN_NODE_TYPES.has(value) ? (value as JourneyNodeType) : null;
}

// ── Lejek kroków ─────────────────────────────────────────────────────────────

export interface JourneyStepRow {
  nodeId: string;
  /** Numer hierarchiczny; pusty napis = krok spoza bieżącego grafu. */
  number: string;
  type: JourneyNodeType | null;
  /** Krok stoi w bieżącym grafie (wersji, której wyniki oglądamy). */
  inGraph: boolean;
  /** `null` = krok bez wejść w oknie (brak wiersza statystyk) - to nie jest zero. */
  stats: JourneyNodeStats | null;
  /**
   * Udział wejść kroku w wejściach rodzica (0-1). `null`: wyzwalacz, krok
   * łączący gałęzie (kilku rodziców - jeden mianownik byłby nieprawdą), krok
   * spoza grafu albo brak wejść rodzica.
   */
  rate: number | null;
  /** Do kroku prowadzi więcej niż jedna krawędź (zbiegające się gałęzie). */
  merge: boolean;
}

/**
 * Wiersze lejka: kroki przepływu w kolejności numeracji, potem kroki ze
 * statystyk spoza grafu. Udział liczymy względem RODZICA w drzewie, a nie
 * poprzedniego wiersza - po rozgałęzieniu „poprzedni wiersz” to sąsiednia
 * gałąź, a iloraz dwóch gałęzi nic nie znaczy.
 */
export function journeyStepRows(
  graph: JourneyGraphLike | null | undefined,
  stats: JourneyStatsDto | null | undefined,
): JourneyStepRow[] {
  const byId = new Map((stats?.nodes ?? []).map((node) => [node.nodeId, node]));
  const view = buildJourneyView(graph);
  const incoming = new Map<string, Set<string>>();
  for (const edge of graph?.edges ?? []) {
    const sources = incoming.get(edge.to) ?? new Set<string>();
    sources.add(edge.from);
    incoming.set(edge.to, sources);
  }

  const numbered = view.order
    .map((id) => view.nodes.get(id))
    .filter((node): node is NonNullable<typeof node> => Boolean(node && node.number !== ""))
    .sort((a, b) => compareStepNumbers(a.number, b.number));

  const rows: JourneyStepRow[] = numbered.map((node) => {
    const own = byId.get(node.id) ?? null;
    const merge = (incoming.get(node.id)?.size ?? 0) > 1;
    const parent = node.parentId ? (byId.get(node.parentId) ?? null) : null;
    const rate =
      !merge && own && parent && parent.entered > 0 ? own.entered / parent.entered : null;
    return {
      nodeId: node.id,
      number: node.number,
      type: node.type,
      inGraph: true,
      stats: own,
      rate,
      merge,
    };
  });

  const covered = new Set(rows.map((row) => row.nodeId));
  for (const node of stats?.nodes ?? []) {
    if (covered.has(node.nodeId)) continue;
    rows.push({
      nodeId: node.nodeId,
      number: "",
      type: nodeTypeOf(node.type),
      inGraph: false,
      stats: node,
      rate: null,
      merge: false,
    });
  }
  return rows;
}

// ── Powody wyjścia ───────────────────────────────────────────────────────────

export interface JourneyExitRow {
  reason: JourneyExitReason;
  count: number;
  /** Udział w wyjściach okna; `null`, gdy nikt nie wyszedł. */
  share: number | null;
}

/** Powody wyjścia malejąco (remis - kolejność słownika powodów); same zera pominięte. */
export function journeyExitRows(stats: JourneyStatsDto | null | undefined): JourneyExitRow[] {
  const exited = stats?.journey.exited ?? {};
  const entries = JOURNEY_EXIT_REASONS.map((reason) => ({ reason, count: exited[reason] ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort(
      (a, b) =>
        b.count - a.count ||
        JOURNEY_EXIT_REASONS.indexOf(a.reason) - JOURNEY_EXIT_REASONS.indexOf(b.reason),
    );
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);
  return entries.map((entry) => ({ ...entry, share: total > 0 ? entry.count / total : null }));
}

// ── Maile kroków ─────────────────────────────────────────────────────────────

export interface JourneyEmailRates {
  /** Wysłane minus odbite - mianownik wskaźników „od doręczonych” rejestru S6. */
  delivered: number;
  /** Otwarcia LUDZKIE ÷ doręczone - górna granica (Apple MPP, Z-S5-06). */
  openRate: number | null;
  clickRate: number | null;
  /** Kliknięcia ÷ otwarcia ludzkie z bazy (`null` bez otwarć) - też górna granica. */
  ctor: number | null;
  unsubscribeRate: number | null;
  /** Odbicia ÷ wysłane (definicja HBR rejestru: mianownikiem są wysłane). */
  bounceRate: number | null;
  complaintRate: number | null;
}

function ratio(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/**
 * Wskaźniki maila w definicjach rejestru S6 (`journey_open_rate` = unikalne
 * otwarcia ÷ doręczone itd.). Otwarcia to otwarcia LUDZKIE - surowe
 * `uniqueOpens` zawierają pobrania proxy i zawyżałyby wynik jeszcze bardziej.
 */
export function journeyEmailRates(email: JourneyEmailStats): JourneyEmailRates {
  const delivered = Math.max(0, email.sent - email.bounced);
  return {
    delivered,
    openRate: ratio(email.uniqueHumanOpens, delivered),
    clickRate: ratio(email.uniqueClicks, delivered),
    ctor: email.ctor,
    unsubscribeRate: ratio(email.unsubscribed, delivered),
    bounceRate: ratio(email.bounced, email.sent),
    complaintRate: ratio(email.complained, delivered),
  };
}

export interface JourneyEmailRow {
  nodeId: string;
  number: string;
  /** Zawsze krok maila (typ dla wspólnej nazwy kroku z lejkiem). */
  type: JourneyNodeType;
  inGraph: boolean;
  /** `null` = krok maila bez wysyłek w oknie (brak wiersza) - kreski, nie zera. */
  email: JourneyEmailStats | null;
  rates: JourneyEmailRates | null;
}

/** Wiersze tabeli maili: kroki `send_email` w kolejności numeracji. */
export function journeyEmailRows(
  graph: JourneyGraphLike | null | undefined,
  stats: JourneyStatsDto | null | undefined,
): JourneyEmailRow[] {
  return journeyStepRows(graph, stats)
    .filter((row) => row.type === "send_email" || row.stats?.email)
    .map((row) => {
      const email = row.stats?.email ?? null;
      return {
        nodeId: row.nodeId,
        number: row.number,
        type: row.type ?? "send_email",
        inGraph: row.inGraph,
        email,
        rates: email ? journeyEmailRates(email) : null,
      };
    });
}

/**
 * Temat maila kroku (wariant A) w języku interfejsu - angielski spada na
 * polski tak jak wysyłka (`subject_en NULL` = mail po polsku).
 */
export function journeySubjects(
  contents: readonly Pick<
    JourneyEmailContentDto,
    "nodeId" | "variant" | "subjectPl" | "subjectEn"
  >[],
  lang: ChartLang,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const content of contents) {
    if (content.variant !== "A") continue;
    const subject = { pl: content.subjectPl, en: content.subjectEn ?? content.subjectPl }[lang];
    out.set(content.nodeId, subject);
  }
  return out;
}

// ── Benchmarki (wyłącznie identyfikatory rejestru S6) ────────────────────────

export type JourneyRateMetric =
  | "openRate"
  | "clickRate"
  | "goalRate"
  | "ctor"
  | "unsubscribeRate"
  | "bounceRate"
  | "complaintRate";

export interface JourneyBenchmarkRef {
  metricId: MetricId;
  benchKey: string;
  /** Kontekst porównania (`?ctx=`); pominięty - domyślny kontekst wpisu. */
  ctxId?: string;
  /**
   * Wpis mierzy KAMPANIE, nie automatyzacje - ocena jest orientacyjna i UI
   * mówi to obok odznaki (rejestr nie ma CTOR dla ścieżek).
   */
  campaign?: boolean;
}

/** Szablon z własnymi wpisami porzuconego koszyka w rejestrze. */
const ABANDONED_CHECKOUT_TEMPLATE = "abandoned_checkout";

/**
 * Mapowanie liczb ścieżki na wpisy rejestru S6 (pakiet S8 §6). Porzucona kasa
 * ma osobne wpisy (`abandoned_cart_*`): mail wysłany w chwili porzucenia
 * otwiera się inaczej niż powitalny, więc wspólne pasmo oceniałoby go
 * fałszywie. Wypisy oceniamy kontekstem maili AUTOMATYCZNYCH (progi łagodniejsze
 * niż kampanii), cel - kontekstem automatyzacji płatnych.
 */
export function journeyBenchmarkRefs(
  templateKey: string | null | undefined,
): Readonly<Record<JourneyRateMetric, JourneyBenchmarkRef>> {
  const abandoned = templateKey === ABANDONED_CHECKOUT_TEMPLATE;
  return {
    openRate: {
      metricId: "journey_open_rate",
      benchKey: abandoned ? "abandoned_cart_email_open_rate" : "welcome_email_open_rate",
    },
    clickRate: {
      metricId: "journey_click_rate",
      benchKey: abandoned ? "abandoned_cart_email_click_rate" : "welcome_email_click_rate",
    },
    goalRate: abandoned
      ? { metricId: "journey_goal_rate", benchKey: "abandoned_cart_email_conversion_rate" }
      : {
          metricId: "journey_goal_rate",
          benchKey: "email_conversion_rate",
          ctxId: "email_conversion_rate.automations_paid",
        },
    ctor: { metricId: "email_ctr", benchKey: "click_to_open_rate", campaign: true },
    unsubscribeRate: {
      metricId: "email_unsubscribe_rate",
      benchKey: "unsubscribe_rate",
      ctxId: "unsubscribe_rate.automated",
    },
    bounceRate: { metricId: "email_hard_bounce_rate", benchKey: "hard_bounce_rate" },
    complaintRate: { metricId: "email_spam_complaint_rate", benchKey: "spam_complaint_rate" },
  };
}

// ── Test A/B ─────────────────────────────────────────────────────────────────

/**
 * Minimalna liczba wejść NA RAMIĘ, od której baza liczy `z` (lustro `c_min_n`
 * w `admin_journey_stats`, SPEC §5.6). Poniżej różnica proporcji jest szumem -
 * panel mówi „za mało danych”, zamiast wskazywać zwycięzcę.
 */
export const JOURNEY_AB_MIN_N = 100;

/**
 * Progi |z| testu dwóch proporcji (dwustronnie): 1,96 = 95 %, 2,58 = 99 %
 * ufności - stałe rozkładu normalnego, nie benchmark.
 */
export const JOURNEY_AB_Z = { p95: 1.96, p99: 2.58 } as const;

export interface JourneyAbArm {
  variant: "A" | "B";
  entered: number;
  /** Kliknięcia albo cele - zależnie od miary podziału. */
  conversions: number;
  rate: number | null;
}

export type JourneyAbVerdict =
  | { kind: "no_data" }
  | {
      kind: "insufficient";
      metric: "goal" | "click";
      minN: number;
      a: JourneyAbArm;
      b: JourneyAbArm;
    }
  | {
      kind: "result";
      metric: "goal" | "click";
      a: JourneyAbArm;
      b: JourneyAbArm;
      /** Wariant z wyższą proporcją; `null` przy remisie. */
      leader: "A" | "B" | null;
      /** |różnica proporcji| w punktach procentowych. */
      diffPp: number;
      /** `z` liczone dla PROWADZĄCEGO (dodatnie = prowadzi); `null` bez wariancji. */
      z: number | null;
      confidence: 95 | 99 | null;
    };

function arm(stats: JourneyVariantStats): JourneyAbArm {
  const conversions = stats.metric === "click" ? stats.uniqueClicks : stats.goalReached;
  return {
    variant: stats.variant,
    entered: stats.entered,
    conversions,
    rate: ratio(conversions, stats.entered),
  };
}

/**
 * Werdykt testu A/B kroku. Istotność bierzemy z `z` policzonego w bazie (te
 * same zapisy, test dwóch proporcji ze wspólną proporcją; `z` wariantu B =
 * (pB − pA)/SE), a różnicę w pp z proporcji ramion. Poniżej
 * `JOURNEY_AB_MIN_N` wejść na którymkolwiek ramieniu werdykt to „za mało
 * danych” - nawet gdy różnica wygląda na dużą.
 */
export function journeyAbVerdict(variants: readonly JourneyVariantStats[]): JourneyAbVerdict {
  const statsA = variants.find((variant) => variant.variant === "A");
  const statsB = variants.find((variant) => variant.variant === "B");
  if (!statsA || !statsB) return { kind: "no_data" };
  const a = arm(statsA);
  const b = arm(statsB);
  const metric = statsB.metric;
  if (a.entered < JOURNEY_AB_MIN_N || b.entered < JOURNEY_AB_MIN_N) {
    return { kind: "insufficient", metric, minN: JOURNEY_AB_MIN_N, a, b };
  }
  const diff = (b.rate ?? 0) - (a.rate ?? 0);
  const leader = diff > 0 ? "B" : diff < 0 ? "A" : null;
  const zB = statsB.z ?? (statsA.z === null ? null : -statsA.z);
  const z = zB === null || leader === null ? null : leader === "B" ? zB : -zB;
  const absZ = z === null ? 0 : Math.abs(z);
  // Istotność tylko wtedy, gdy znak `z` zgadza się z kierunkiem różnicy -
  // rozjazd (zaokrąglenia przy remisie) to brak dowodu, nie „99 %”.
  const confidence =
    z === null || z <= 0
      ? null
      : absZ >= JOURNEY_AB_Z.p99
        ? 99
        : absZ >= JOURNEY_AB_Z.p95
          ? 95
          : null;
  return { kind: "result", metric, a, b, leader, diffPp: Math.abs(diff) * 100, z, confidence };
}

export interface JourneyAbNode {
  nodeId: string;
  number: string;
  inGraph: boolean;
  variants: JourneyVariantStats[];
  verdict: JourneyAbVerdict;
}

/** Podziały A/B z wynikami: kroki `ab_split` grafu i każdy podział ze statystyk. */
export function journeyAbNodes(
  graph: JourneyGraphLike | null | undefined,
  stats: JourneyStatsDto | null | undefined,
): JourneyAbNode[] {
  const variants = stats?.variants ?? [];
  const withVariants = new Set(variants.map((variant) => variant.nodeId));
  return journeyStepRows(graph, stats)
    .filter((row) => row.type === "ab_split" || withVariants.has(row.nodeId))
    .map((row) => {
      const own = variants.filter((variant) => variant.nodeId === row.nodeId);
      return {
        nodeId: row.nodeId,
        number: row.number,
        inGraph: row.inGraph,
        variants: own,
        verdict: journeyAbVerdict(own),
      };
    });
}

/** Klucze werdyktu A/B - jawna lista (czytelnik każdego klucza). */
export const JOURNEY_AB_VERDICT_KEY = {
  noData: "adminJourneys.results.ab.noData",
  insufficient: "adminJourneys.results.ab.insufficient",
  equal: "adminJourneys.results.ab.equal",
  better: "adminJourneys.results.ab.better",
  notSignificant: "adminJourneys.results.ab.notSignificant",
} as const;

/**
 * Zdanie werdyktu („B lepsze o 3,1 pp (95 %)”, „za mało danych (n < 100)”) -
 * jedno źródło dla karty A/B, panelu kroku i chipu na kanwie.
 */
export function journeyAbSummary(
  verdict: JourneyAbVerdict,
  formatPp: (points: number) => string,
): JourneySummary {
  switch (verdict.kind) {
    case "no_data":
      return { labelKey: JOURNEY_AB_VERDICT_KEY.noData, params: {} };
    case "insufficient":
      return { labelKey: JOURNEY_AB_VERDICT_KEY.insufficient, params: { min: verdict.minN } };
    case "result":
      if (verdict.leader === null) return { labelKey: JOURNEY_AB_VERDICT_KEY.equal, params: {} };
      return verdict.confidence === null
        ? {
            labelKey: JOURNEY_AB_VERDICT_KEY.notSignificant,
            params: { variant: verdict.leader, pp: formatPp(verdict.diffPp) },
          }
        : {
            labelKey: JOURNEY_AB_VERDICT_KEY.better,
            params: {
              variant: verdict.leader,
              pp: formatPp(verdict.diffPp),
              level: verdict.confidence,
            },
          };
  }
}

// ── Wyniki kroku ─────────────────────────────────────────────────────────────

const KNOWN_OUTCOMES: ReadonlySet<string> = new Set(JOURNEY_STEP_OUTCOMES);

export interface JourneyOutcomeRow {
  code: string;
  /** Kod ze słownika wyników (`stepOutcome`); obcy kod UI pokazuje surowo. */
  known: boolean;
  outcome: JourneyStepOutcome | null;
  count: number;
}

/** Wyniki kroku (gałąź, wariant, powód pominięcia) w kolejności słownika S5. */
export function journeyOutcomeRows(node: JourneyNodeStats | null | undefined): JourneyOutcomeRow[] {
  return Object.entries(node?.outcomes ?? {})
    .filter(([, count]) => count > 0)
    .map(([code, count]) => {
      const known = KNOWN_OUTCOMES.has(code);
      return { code, known, outcome: known ? (code as JourneyStepOutcome) : null, count };
    })
    .sort((a, b) => {
      const rank = (row: JourneyOutcomeRow) =>
        row.outcome ? JOURNEY_STEP_OUTCOMES.indexOf(row.outcome) : JOURNEY_STEP_OUTCOMES.length;
      return rank(a) - rank(b) || a.code.localeCompare(b.code);
    });
}

// ── Seria dzienna i retencja (Z-I9c-06) ──────────────────────────────────────

const DAY_MS = 86_400_000;

/**
 * Pierwszy dzień z pełnymi danymi po zapieczętowaniu retencji
 * (`journeySealed` = ostatni dzień zestawiony dziennie, włącznie). Arytmetyka
 * na dacie kalendarzowej w UTC - kolumna DATE nie ma strefy, a lokalna
 * północ przesunęłaby dzień.
 */
export function journeyFullDataFrom(sealedDay: string | null | undefined): string | null {
  if (!sealedDay || !/^\d{4}-\d{2}-\d{2}$/.test(sealedDay)) return null;
  const next = Date.parse(`${sealedDay}T00:00:00Z`) + DAY_MS;
  return Number.isFinite(next) ? new Date(next).toISOString().slice(0, 10) : null;
}

/**
 * Okno sięga dni sprzed retencji: liczniki kroków pochodzą z zestawienia
 * dziennego, a podsumowanie zapisów (wejścia, cele, wyjścia) obejmuje tylko
 * zapisy, które przetrwały - może być niepełne.
 */
export function isJourneyStatsPartial(stats: JourneyStatsDto | null | undefined): boolean {
  return stats?.source === "rollup";
}

export interface JourneySeriesChart {
  categories: string[];
  enrolled: (number | null)[];
  goalReached: (number | null)[];
  exited: (number | null)[];
  /** Dni przed tą datą nie mają danych dziennych (przerwa na wykresie). */
  gapBefore: string | null;
  /** Jakakolwiek liczba > 0 w oknie (inaczej karta mówi „brak wejść”). */
  hasData: boolean;
}

/**
 * Seria dzienna do wykresu liniowego. Seria czyta wyłącznie surowe zapisy, więc
 * dni zapieczętowane retencją dałyby zera - zamieniamy je w `null` (przerwa),
 * żeby spadek do zera nie udawał braku wejść.
 */
export function journeySeriesChart(
  points: readonly JourneySeriesPoint[] | null | undefined,
  fullDataFrom: string | null = null,
): JourneySeriesChart {
  const list = points ?? [];
  const gap = (point: JourneySeriesPoint) => fullDataFrom !== null && point.day < fullDataFrom;
  const pick = (field: "enrolled" | "goalReached" | "exited") =>
    list.map((point) => (gap(point) ? null : point[field]));
  const enrolled = pick("enrolled");
  const goalReached = pick("goalReached");
  const exited = pick("exited");
  const hasData = [...enrolled, ...goalReached, ...exited].some(
    (value) => value !== null && value > 0,
  );
  return {
    categories: list.map((point) => point.day),
    enrolled,
    goalReached,
    exited,
    gapBefore: list.some(gap) ? fullDataFrom : null,
    hasData,
  };
}

// ── Kontakty: stronicowanie ──────────────────────────────────────────────────

/** Liczba stron listy kontaktów (co najmniej jedna - pusta lista też ma stronę). */
export function journeyPageCount(total: number, pageSize: number): number {
  return pageSize > 0 ? Math.max(1, Math.ceil(total / pageSize)) : 1;
}

// ── Tekst liczb kroku (nazwa węzła na kanwie, S8.3) ──────────────────────────

/** Klucze tekstu liczb kroku - jawna lista (czytelnik każdego klucza). */
export const JOURNEY_STATS_ARIA_KEY = {
  entered: "adminJourneys.statsOverlay.aria.entered",
  sent: "adminJourneys.statsOverlay.aria.sent",
  withWaiting: "adminJourneys.statsOverlay.aria.withWaiting",
} as const;

/**
 * Liczby kroku jako fragment nazwy węzła („380 wysłanych”, „1 200 wejść,
 * czeka: 45”). Kanwa (S8.3) dokleja go do `aria-label` karty kroku, a
 * nakładka statystyk jest `aria-hidden` - czytnik słyszy liczby raz.
 * `null` = krok bez wejść w oknie albo statystyki wyłączone.
 */
export function journeyNodeStatsSummary(
  node: JourneyNodeStats | null | undefined,
  formatNumber: (value: number) => string,
): JourneySummary | null {
  if (!node) return null;
  const base: JourneySummary = node.email
    ? {
        labelKey: JOURNEY_STATS_ARIA_KEY.sent,
        params: { count: node.email.sent, value: formatNumber(node.email.sent) },
      }
    : {
        labelKey: JOURNEY_STATS_ARIA_KEY.entered,
        params: { count: node.entered, value: formatNumber(node.entered) },
      };
  if (node.waitingNow <= 0) return base;
  return {
    labelKey: JOURNEY_STATS_ARIA_KEY.withWaiting,
    params: { waiting: formatNumber(node.waitingNow) },
    refs: { base },
  };
}
