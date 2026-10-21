// Wyniki ścieżki (S8-B) - czyste przekształcenia statystyk i słownik wyników.
//
// CO TEN PLIK DOWODZI.
//   1. Lejek idzie w kolejności numeracji kanwy (nie `node_id`), udział liczy
//      się względem kroku nadrzędnego, krok łączący gałęzie nie ma udziału,
//      a krok bez wiersza statystyk to `null`, nie zero; kroki spoza grafu
//      dochodzą na końcu bez numeru.
//   2. Werdykt A/B: poniżej 100 wejść na ramię „za mało danych (n < 100)”;
//      inaczej różnica w pp i ufność z `z` (|z| ≥ 1,96 -> 95 %, ≥ 2,58 -> 99 %);
//      miara `click` liczy kliknięcia, `goal` - cele; zdania PL/EN.
//   3. Maile: wskaźniki w definicjach rejestru S6 (od doręczonych, otwarcia
//      ludzkie), wpisy rejestru dla porzuconej kasy i dla pozostałych
//      szablonów istnieją, a kontekst wypisów to maile automatyczne.
//   4. Retencja (Z-I9c-06): dzień po zapieczętowaniu, przerwa w serii zamiast
//      zera; stronicowanie; tekst liczb kroku dla nazwy węzła na kanwie.
//   5. Słownik S8-B: parytet PL/EN, liczebniki, zero kolizji z S5 i S8-A,
//      czytelnik każdego klucza w kodzie produkcyjnym S8-B.
//
// Fikstury z kształtów prawdziwych RPC (`RPC_SHAPES`) przepuszczone przez
// `parse.ts`; kopie przez JSON (`clone` zwraca `unknown`).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  JOURNEY_AB_MIN_N,
  JOURNEY_STATS_ARIA_KEY,
  isJourneyStatsPartial,
  journeyAbNodes,
  journeyAbSummary,
  journeyAbVerdict,
  journeyBenchmarkRefs,
  journeyEmailRates,
  journeyEmailRows,
  journeyExitRows,
  journeyFullDataFrom,
  journeyNodeStatsSummary,
  journeyOutcomeRows,
  journeyPageCount,
  journeySeriesChart,
  journeyStatsWindow,
  journeyStepRows,
  journeySubjects,
} from "../results";
import { translateSummary } from "../summaries";
import { buildJourneyView, type JourneyGraphLike } from "../viewModel";
import { localized } from "@/components/admin/analytics/semantic/__tests__/benchmarkFixtures";
import { evaluateMetricValue } from "@/components/admin/analytics/semantic/hooks/useBenchmark";
import { BENCHMARK_INDEX } from "@/lib/analytics/semantic/benchmarks/index";
import { journeysDictionaries } from "@/lib/i18n-admin-journeys";
import { journeysListDictionaries } from "@/lib/i18n-admin-journeys-list";
import { journeysResultsDictionaries } from "@/lib/i18n-admin-journeys-results";
import { RPC_SHAPES } from "@/lib/journeys/__tests__/rpcShapes.fixture";
import type { JourneyVariantStats } from "@/lib/journeys/dto";
import { parseJourneySeries, parseJourneyStats } from "@/lib/journeys/parse";
import { realT } from "@/test/i18nReal";

const pl = realT("pl");
const en = realT("en");

function clone(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

type RawNode = { node_id: string; type: string | null; entered: number } & Record<string, unknown>;
type RawStats = {
  source: string;
  nodes: RawNode[];
  variants: Record<string, unknown>[];
  journey: Record<string, unknown>;
};

/** Surowy wiersz kroku jak z bazy (`admin_journey_stats`), bez maila. */
function rawNode(nodeId: string, type: string, entered: number, extra: object = {}): RawNode {
  return {
    node_id: nodeId,
    type,
    entered,
    succeeded: entered,
    skipped: 0,
    failed: 0,
    dead: 0,
    waiting_now: 0,
    outcomes: {},
    email: null,
    ...extra,
  };
}

/**
 * Graf z podziałem A/B, którego obie gałęzie zbiegają się w celu:
 * 1 wyzwalacz, 2 czekanie, 3 mail, 4 podział, 4.1.1 mail A, 4.1.2 cel
 * (pod pierwszym rodzicem), 4.2.1 mail B (chip scalenia do celu).
 */
const GRAPH: JourneyGraphLike = {
  nodes: [
    { id: "t", type: "trigger", params: {} },
    { id: "w", type: "wait", params: { mode: "duration", minutes: 60 } },
    { id: "m", type: "send_email", params: {} },
    { id: "ab", type: "ab_split", params: { weights: { A: 50, B: 50 }, winnerMetric: "goal" } },
    { id: "ma", type: "send_email", params: {} },
    { id: "mb", type: "send_email", params: {} },
    { id: "g", type: "goal", params: {} },
  ],
  edges: [
    { from: "t", to: "w", branch: "next" },
    { from: "w", to: "m", branch: "next" },
    { from: "m", to: "ab", branch: "next" },
    { from: "ab", to: "ma", branch: "A" },
    { from: "ab", to: "mb", branch: "B" },
    { from: "ma", to: "g", branch: "next" },
    { from: "mb", to: "g", branch: "next" },
  ],
};

/** Statystyki grafu w kolejności `node_id` (jak z bazy) + krok spoza grafu. */
function graphStats() {
  const raw = clone(RPC_SHAPES.statsAb) as RawStats;
  const email = (RPC_SHAPES.statsEmail.nodes[0] as { email: unknown }).email;
  raw.nodes = [
    rawNode("ab", "ab_split", 200, { outcomes: { A: 100, B: 100 } }),
    rawNode("g", "goal", 90),
    rawNode("m", "send_email", 200, { email }),
    rawNode("ma", "send_email", 100),
    rawNode("mb", "send_email", 100),
    rawNode("old", "notify_staff", 5),
    rawNode("t", "trigger", 400),
    rawNode("w", "wait", 400, { waiting_now: 12 }),
  ];
  return parseJourneyStats(raw);
}

function variant(
  name: "A" | "B",
  entered: number,
  goalReached: number,
  z: number | null,
  metric: "goal" | "click" = "goal",
  uniqueClicks = 0,
): JourneyVariantStats {
  return { nodeId: "ab", variant: name, metric, entered, uniqueClicks, goalReached, z };
}

const formatPp = (points: number) =>
  points.toLocaleString("pl-PL", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

describe("okno statystyk", () => {
  it("okres huba -> okno ISO; ten sam kwant = ten sam klucz zapytania", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    const month = journeyStatsWindow("month", now);
    expect(month.period).toBe("month");
    expect(Date.parse(month.sinceIso)).toBeLessThan(Date.parse(month.untilIso));
    expect(journeyStatsWindow("month", now + 30_000)).toEqual(month);
  });

  it("okres własny bez granic w adresie edytora liczy się jak miesiąc", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    expect(journeyStatsWindow("custom", now)).toEqual(journeyStatsWindow("month", now));
  });
});

describe("lejek kroków", () => {
  it("kolejność numeracji kanwy, nie kolejność `node_id` z bazy", () => {
    const view = buildJourneyView(GRAPH);
    const rows = journeyStepRows(GRAPH, graphStats());
    expect(rows.map((row) => [row.nodeId, row.number])).toEqual([
      ["t", "1"],
      ["w", "2"],
      ["m", "3"],
      ["ab", "4"],
      ["ma", "4.1.1"],
      ["g", "4.1.2"],
      ["mb", "4.2.1"],
      ["old", ""],
    ]);
    expect(rows.slice(0, 7).map((row) => row.number)).toEqual(
      rows.slice(0, 7).map((row) => view.numbering.get(row.nodeId)),
    );
  });

  it("udział względem kroku nadrzędnego; scalenie i wyzwalacz bez udziału", () => {
    const rows = new Map(journeyStepRows(GRAPH, graphStats()).map((row) => [row.nodeId, row]));
    expect(rows.get("t")?.rate).toBeNull();
    expect(rows.get("w")?.rate).toBe(1);
    expect(rows.get("m")?.rate).toBe(0.5);
    expect(rows.get("ma")?.rate).toBe(0.5);
    expect(rows.get("mb")?.rate).toBe(0.5);
    expect(rows.get("g")).toMatchObject({ merge: true, rate: null });
  });

  it("krok bez wiersza statystyk to `null`, nie zero; krok spoza grafu bez numeru", () => {
    const raw = clone(RPC_SHAPES.statsAb) as RawStats;
    raw.nodes = [rawNode("t", "trigger", 10), rawNode("gone", "wait", 3)];
    const rows = journeyStepRows(GRAPH, parseJourneyStats(raw));
    const byId = new Map(rows.map((row) => [row.nodeId, row]));
    expect(byId.get("w")).toMatchObject({ stats: null, rate: null, inGraph: true });
    expect(byId.get("gone")).toMatchObject({ number: "", inGraph: false, type: "wait" });
  });

  it("bez grafu i bez statystyk - pusta lista, bez wyjątku", () => {
    expect(journeyStepRows(null, null)).toEqual([]);
  });
});

describe("powody wyjścia", () => {
  it("malejąco, z udziałem; zera pominięte; remis w kolejności słownika", () => {
    const raw = clone(RPC_SHAPES.statsEmail) as RawStats;
    raw.journey.exited = { manual: 2, unsubscribed: 5, consent: 2, goal: 0 };
    const rows = journeyExitRows(parseJourneyStats(raw));
    expect(rows.map((row) => [row.reason, row.count])).toEqual([
      ["unsubscribed", 5],
      ["consent", 2],
      ["manual", 2],
    ]);
    expect(rows[0].share).toBeCloseTo(5 / 9);
  });

  it("brak wyjść = pusta lista", () => {
    expect(journeyExitRows(parseJourneyStats(clone(RPC_SHAPES.statsEmail)))).toEqual([]);
  });
});

describe("maile kroków", () => {
  it("wskaźniki od doręczonych, otwarcia LUDZKIE, CTOR z bazy", () => {
    const email = {
      queued: 120,
      sent: 100,
      suppressed: 2,
      bounced: 4,
      complained: 1,
      uniqueOpens: 70,
      uniqueHumanOpens: 48,
      uniqueClicks: 12,
      ctor: 0.25,
      unsubscribed: 3,
      fallbackLocale: 0,
    };
    expect(journeyEmailRates(email)).toEqual({
      delivered: 96,
      openRate: 48 / 96,
      clickRate: 12 / 96,
      ctor: 0.25,
      unsubscribeRate: 3 / 96,
      bounceRate: 4 / 100,
      complaintRate: 1 / 96,
    });
  });

  it("nic nie wysłano - wskaźniki `null`, nie zero", () => {
    const rates = journeyEmailRates({
      queued: 3,
      sent: 0,
      suppressed: 3,
      bounced: 0,
      complained: 0,
      uniqueOpens: 0,
      uniqueHumanOpens: 0,
      uniqueClicks: 0,
      ctor: null,
      unsubscribed: 0,
      fallbackLocale: 0,
    });
    expect(rates).toMatchObject({ delivered: 0, openRate: null, clickRate: null, ctor: null });
  });

  it("wiersze tabeli: maile w kolejności numeracji; mail bez wysyłek = `null`", () => {
    const rows = journeyEmailRows(GRAPH, graphStats());
    expect(rows.map((row) => [row.nodeId, row.number])).toEqual([
      ["m", "3"],
      ["ma", "4.1.1"],
      ["mb", "4.2.1"],
    ]);
    expect(rows[0].email?.uniqueHumanOpens).toBe(1);
    expect(rows[1]).toMatchObject({ email: null, rates: null, type: "send_email" });
  });

  it("temat wariantu A w języku interfejsu, angielski spada na polski", () => {
    const contents = [
      { nodeId: "m", variant: "A", subjectPl: "Witaj", subjectEn: "Welcome" },
      { nodeId: "m", variant: "B", subjectPl: "Hej", subjectEn: null },
      { nodeId: "ma", variant: "A", subjectPl: "Tylko PL", subjectEn: null },
    ];
    expect([...journeySubjects(contents, "en")]).toEqual([
      ["m", "Welcome"],
      ["ma", "Tylko PL"],
    ]);
    expect(journeySubjects(contents, "pl").get("m")).toBe("Witaj");
  });
});

describe("benchmarki - wyłącznie identyfikatory rejestru S6", () => {
  it("każdy wpis istnieje w indeksie i należy do właściwej metryki", () => {
    for (const template of ["welcome_onboarding", "abandoned_checkout", null]) {
      for (const ref of Object.values(journeyBenchmarkRefs(template))) {
        const entry = BENCHMARK_INDEX.find((item) => item.key === ref.benchKey);
        expect(entry?.metricId, ref.benchKey).toBe(ref.metricId);
        if (ref.ctxId) {
          const bench = localized("email", ref.benchKey, "pl");
          expect(bench.contexts.map((context) => context.id)).toContain(ref.ctxId);
        }
      }
    }
  });

  it("porzucona kasa ma własne wpisy; reszta - powitalne; CTOR to benchmark kampanii", () => {
    expect(journeyBenchmarkRefs("abandoned_checkout").openRate.benchKey).toBe(
      "abandoned_cart_email_open_rate",
    );
    expect(journeyBenchmarkRefs("abandoned_checkout").goalRate.benchKey).toBe(
      "abandoned_cart_email_conversion_rate",
    );
    expect(journeyBenchmarkRefs("welcome_onboarding").openRate.benchKey).toBe(
      "welcome_email_open_rate",
    );
    expect(journeyBenchmarkRefs(null).goalRate.ctxId).toBe(
      "email_conversion_rate.automations_paid",
    );
    expect(journeyBenchmarkRefs(null).unsubscribeRate.ctxId).toBe("unsubscribe_rate.automated");
    expect(journeyBenchmarkRefs(null).ctor).toMatchObject({
      metricId: "email_ctr",
      benchKey: "click_to_open_rate",
      campaign: true,
    });
  });

  it("ocena przechodzi przez rejestr: poziom przy dużej próbie, jawny powód przy małej", () => {
    const refs = journeyBenchmarkRefs(null);
    for (const metric of ["openRate", "clickRate", "ctor", "unsubscribeRate"] as const) {
      const ref = refs[metric];
      const bench = localized("email", ref.benchKey, "pl");
      const graded = evaluateMetricValue(ref.metricId, 0.2, bench, { n: 500, ctxId: ref.ctxId });
      expect(graded.tier, metric).not.toBe("none");
      expect(
        evaluateMetricValue(ref.metricId, 0.2, bench, { n: 10, ctxId: ref.ctxId }),
      ).toMatchObject({ tier: "none", why: "small_sample" });
      expect(
        evaluateMetricValue(ref.metricId, null, bench, { n: 0, ctxId: ref.ctxId }),
      ).toMatchObject({ tier: "none", why: "no_data" });
    }
  });
});

describe("werdykt A/B", () => {
  it("kształt z bazy: A 81/120 vs B 30/120, z = 6,603 -> A lepsze o 42,5 pp (99 %)", () => {
    const stats = parseJourneyStats(clone(RPC_SHAPES.statsAb));
    const verdict = journeyAbVerdict(stats.variants);
    expect(verdict).toMatchObject({ kind: "result", metric: "goal", leader: "A", confidence: 99 });
    if (verdict.kind !== "result") throw new Error("werdykt");
    expect(verdict.diffPp).toBeCloseTo(42.5);
    expect(verdict.z).toBeCloseTo(6.603);
    expect(translateSummary(pl, journeyAbSummary(verdict, formatPp))).toBe(
      "A lepsze o 42,5 pp (99 %)",
    );
  });

  it("poniżej 100 wejść na ramię - „za mało danych (n < 100)”, nawet przy dużej różnicy", () => {
    const verdict = journeyAbVerdict([
      variant("A", JOURNEY_AB_MIN_N - 1, 10, null),
      variant("B", 400, 300, null),
    ]);
    expect(verdict).toMatchObject({ kind: "insufficient", minN: 100 });
    expect(translateSummary(pl, journeyAbSummary(verdict, formatPp))).toBe(
      "Za mało danych (n < 100)",
    );
    expect(translateSummary(en, journeyAbSummary(verdict, formatPp))).toBe(
      "Not enough data (n < 100)",
    );
  });

  it("ufność z |z|: 1,96 -> 95 %, 2,58 -> 99 %, poniżej - różnica nieistotna", () => {
    const at = (z: number) =>
      journeyAbVerdict([variant("A", 1000, 100, -z), variant("B", 1000, 131, z)]);
    const v95 = at(1.96);
    expect(v95).toMatchObject({ leader: "B", confidence: 95 });
    if (v95.kind !== "result") throw new Error("werdykt");
    expect(v95.diffPp).toBeCloseTo(3.1);
    expect(translateSummary(pl, journeyAbSummary(v95, formatPp))).toBe("B lepsze o 3,1 pp (95 %)");
    expect(at(2.58)).toMatchObject({ confidence: 99 });
    const weak = at(1.5);
    expect(weak).toMatchObject({ leader: "B", confidence: null });
    expect(translateSummary(pl, journeyAbSummary(weak, formatPp))).toBe(
      "B lepsze o 3,1 pp - różnica nieistotna statystycznie",
    );
  });

  it("miara kliknięć liczy kliknięcia, nie cele; remis bez zwycięzcy", () => {
    const clicks = journeyAbVerdict([
      variant("A", 200, 150, -3, "click", 20),
      variant("B", 200, 10, 3, "click", 60),
    ]);
    expect(clicks).toMatchObject({ kind: "result", leader: "B", confidence: 99 });
    if (clicks.kind !== "result") throw new Error("werdykt");
    expect(clicks.b.conversions).toBe(60);
    expect(clicks.diffPp).toBeCloseTo(20);
    const tie = journeyAbVerdict([variant("A", 200, 50, 0), variant("B", 200, 50, 0)]);
    expect(tie).toMatchObject({ leader: null, confidence: null });
    expect(translateSummary(pl, journeyAbSummary(tie, formatPp))).toBe(
      "Brak różnicy między wariantami",
    );
  });

  it("brak ramienia = brak danych; `z` z ramienia A, gdy B go nie ma", () => {
    expect(journeyAbVerdict([variant("A", 300, 30, null)])).toEqual({ kind: "no_data" });
    const fromA = journeyAbVerdict([variant("A", 300, 30, -2.7), variant("B", 300, 60, null)]);
    expect(fromA).toMatchObject({ leader: "B", confidence: 99 });
  });

  it("podziały: krok `ab_split` grafu z wariantami ze statystyk", () => {
    const nodes = journeyAbNodes(GRAPH, graphStats());
    expect(nodes.map((node) => [node.nodeId, node.number, node.variants.length])).toEqual([
      ["ab", "4", 2],
    ]);
  });
});

describe("wyniki kroku, retencja, stronicowanie", () => {
  it("wyniki w kolejności słownika S5; obcy kod surowo na końcu", () => {
    const stats = parseJourneyStats(clone(RPC_SHAPES.statsAb));
    const node = { ...stats.nodes[0], outcomes: { B: 120, mystery: 2, A: 120, capped: 0 } };
    expect(journeyOutcomeRows(node).map((row) => [row.code, row.known])).toEqual([
      ["A", true],
      ["B", true],
      ["mystery", false],
    ]);
  });

  it("dzień po zapieczętowaniu (data kalendarzowa, bez strefy)", () => {
    expect(journeyFullDataFrom("2026-03-31")).toBe("2026-04-01");
    expect(journeyFullDataFrom("2026-12-31")).toBe("2027-01-01");
    expect(journeyFullDataFrom(null)).toBeNull();
    expect(journeyFullDataFrom("31.03.2026")).toBeNull();
  });

  it("okno z zestawienia dziennego jest oznaczone jako niepełne", () => {
    const raw = clone(RPC_SHAPES.statsEmail) as RawStats;
    raw.source = "rollup";
    expect(isJourneyStatsPartial(parseJourneyStats(raw))).toBe(true);
    expect(isJourneyStatsPartial(parseJourneyStats(clone(RPC_SHAPES.statsEmail)))).toBe(false);
  });

  it("seria: dni sprzed pełnych danych to przerwa (`null`), nie zero", () => {
    const raw = clone(RPC_SHAPES.series) as Record<string, unknown>[];
    raw[3].enrolled = 4;
    const chart = journeySeriesChart(parseJourneySeries(raw), "2026-10-19");
    expect(chart.categories).toEqual(["2026-10-17", "2026-10-18", "2026-10-19", "2026-10-20"]);
    expect(chart.enrolled).toEqual([null, null, 0, 4]);
    expect(chart.gapBefore).toBe("2026-10-19");
    expect(chart.hasData).toBe(true);
    const flat = journeySeriesChart(parseJourneySeries(clone(RPC_SHAPES.series)), null);
    expect(flat).toMatchObject({ gapBefore: null, hasData: false });
  });

  it("liczba stron: co najmniej jedna", () => {
    expect(journeyPageCount(0, 50)).toBe(1);
    expect(journeyPageCount(50, 50)).toBe(1);
    expect(journeyPageCount(51, 50)).toBe(2);
  });
});

describe("tekst liczb kroku (nazwa węzła na kanwie)", () => {
  const stats = graphStats();
  const byId = new Map(stats.nodes.map((node) => [node.nodeId, node]));
  const fmt = (value: number) => value.toLocaleString("pl-PL");

  it("mail - wysłane z liczebnikiem; inny krok - wejścia; czekanie - czekający", () => {
    const sent = journeyNodeStatsSummary(byId.get("m"), fmt);
    expect(sent?.labelKey).toBe(JOURNEY_STATS_ARIA_KEY.sent);
    expect(translateSummary(pl, sent!)).toBe("1 wysłany");
    expect(translateSummary(pl, journeyNodeStatsSummary(byId.get("g"), fmt)!)).toBe("90 wejść");
    expect(translateSummary(pl, journeyNodeStatsSummary(byId.get("w"), fmt)!)).toBe(
      "400 wejść, czeka: 12",
    );
    expect(translateSummary(en, journeyNodeStatsSummary(byId.get("w"), fmt)!)).toBe(
      "400 entries, waiting: 12",
    );
    expect(journeyNodeStatsSummary(undefined, fmt)).toBeNull();
  });

  it("PL: 380 wysłanych (forma „many”)", () => {
    const node = { ...byId.get("m")!, email: { ...byId.get("m")!.email!, sent: 380 } };
    expect(translateSummary(pl, journeyNodeStatsSummary(node, fmt)!)).toBe("380 wysłanych");
  });
});

// ── Słownik S8-B ────────────────────────────────────────────────────────────

type Tree = { [key: string]: string | Tree };

function leaves(tree: Tree, prefix = ""): string[] {
  return Object.entries(tree).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : leaves(value, `${prefix}${key}.`),
  );
}

const PLURAL = /_(zero|one|two|few|many|other)$/;

function productionSources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "__tests__" ? [] : productionSources(path);
    return /\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry) ? [readFileSync(path, "utf8")] : [];
  });
}

describe("słownik `i18n-admin-journeys-results` (S8-B)", () => {
  const plTree = journeysResultsDictionaries.pl as unknown as Tree;
  const enTree = journeysResultsDictionaries.en as unknown as Tree;
  const plKeys = leaves(plTree);

  it("parytet PL/EN: te same klucze, EN niepusty", () => {
    expect(leaves(enTree)).toEqual(plKeys);
    for (const key of plKeys) {
      const value = key.split(".").reduce<unknown>((node, part) => (node as Tree)[part], enTree);
      expect(typeof value === "string" && value.trim() !== "", key).toBe(true);
    }
  });

  it("liczebniki: każda grupa ma formy _one/_few/_many/_other", () => {
    const bases = new Set(plKeys.filter((k) => PLURAL.test(k)).map((k) => k.replace(PLURAL, "")));
    expect(bases.size).toBeGreaterThan(0);
    for (const base of bases) {
      for (const form of ["one", "few", "many", "other"])
        expect(plKeys, base).toContain(`${base}_${form}`);
    }
  });

  it("zero kolizji z S5 (`i18n-admin-journeys`) i S8-A (`i18n-admin-journeys-list`)", () => {
    const others = [journeysDictionaries.pl, journeysListDictionaries.pl].map((tree) =>
      leaves(tree as unknown as Tree),
    );
    const branchOf = (key: string) => key.split(".").slice(0, 2).join(".");
    const mine = new Set(plKeys.map(branchOf));
    for (const theirs of others) {
      const keys = new Set(theirs);
      expect(plKeys.filter((key) => keys.has(key))).toEqual([]);
      const branches = new Set(theirs.map(branchOf));
      expect([...mine].filter((branch) => branches.has(branch))).toEqual([]);
    }
    expect([...mine].sort()).toEqual([
      "adminJourneys.enrollments",
      "adminJourneys.lead",
      "adminJourneys.nodeResults",
      "adminJourneys.results",
      "adminJourneys.statsOverlay",
    ]);
  });

  it("bez liczb z badań: żadnego procentu ani progu benchmarku w napisach", () => {
    // Liczby benchmarków przychodzą wyłącznie z rejestru S6 - w słowniku
    // wolno mieć tylko placeholdery i liczby z interpolacji.
    const values = [...leaves(plTree), ...leaves(enTree)].length;
    expect(values).toBeGreaterThan(0);
    const text = JSON.stringify(journeysResultsDictionaries);
    expect(text).not.toMatch(/\d+([.,]\d+)?\s?%/);
  });

  it("każdy klucz ma czytelnika w kodzie produkcyjnym S8-B", () => {
    const sources = [
      ...productionSources("src/components/admin/journeys/results"),
      ...productionSources("src/components/admin/journeys/lead"),
      readFileSync("src/components/admin/journeys/editor/JourneyStatsOverlay.tsx", "utf8"),
      readFileSync("src/lib/admin/journeys/results.ts", "utf8"),
    ].join("\n");
    const unread = plKeys
      .map((key) => key.replace(PLURAL, ""))
      .filter((key, index, all) => all.indexOf(key) === index)
      .filter((key) => !sources.includes(`"${key}"`));
    expect(unread).toEqual([]);
  });
});
