// Kontrakt zakładek, obszarów i powiązań huba (`hubTabs.ts`) oraz komplet
// kluczy słownika powłoki dla unii, którymi posługują się S6, S7 i T4.
//
// CO TEN PLIK DOWODZI.
//   1. Zakładki = `REVENUE_TABS` (ta sama kolejność), role, grupy i okresy =
//      tabela SPEC §2.2 przepisana TU jawnie - zmiana w kodzie bez zmiany
//      w specyfikacji ma się zapalić, a nie przejść po cichu.
//   2. Widoczność liczy DOKŁADNE role: sam `super_admin` nie dostaje zakładek
//      (UI = bramka SQL, SPEC §2.5), redaktor nie widzi kwot.
//   3. Każdy odnośnik (zakładki, obszary, powiązane moduły) prowadzi na trasę,
//      która ISTNIEJE w `routeTree.gen.ts` (czytanym jako tekst - ten sam
//      plik, z którego router buduje drzewo), z parametrami z kontraktu
//      deep linków SPEC §2.6.
//   4. Skala kondycji to skala `brandAuditScore`.
//   5. Każda wartość unii (poziom, okno, wielkość, obszar, waga, powód braku
//      oceny…) ma napis w PL i EN, a listy w teście są WYCZERPUJĄCE względem
//      typów - nowa wartość unii bez napisu nie skompiluje się w tym pliku.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-revenue";
import "@/lib/i18n-admin-revenue-shell";
import {
  AREA_HEALTH_PENALTY,
  AREA_OWNER_LINK,
  HUB_TABS,
  RELATED_MODULES,
  REVENUE_AREAS,
  REVENUE_SEVERITIES,
  REVENUE_TAB_GROUPS,
  areaHealthScore,
  canSeeTab,
  defaultPeriodOf,
  hubTabSpec,
  hubTabsFor,
  type RevenueArea,
  type RevenueSeverity,
  type RevenueTabGroup,
} from "@/lib/admin/revenue/hubTabs";
import type {
  BenchmarkNoneReason,
  BenchDirection,
} from "@/lib/analytics/semantic/benchmarks/evaluate";
import type {
  BenchGroup,
  BenchWindow,
  Measure,
  Tier,
} from "@/lib/analytics/semantic/benchmarks/types";
import type { MetricGroup } from "@/lib/analytics/semantic/metrics";
import { brandAuditScore, type BrandFinding } from "@/lib/seo/brandAudit";
import {
  REVENUE_TABS,
  REVENUE_VIEWS,
  isRevenueTab,
  parseRevenueHubSearch,
  type RevenuePeriod,
  type RevenueTabId,
} from "@/lib/revenue/search";

// ---------------------------------------------------------------------------
// Pomocnicze
// ---------------------------------------------------------------------------

/** Pełne ścieżki tras z wygenerowanego drzewa - tekst, nie import (bez kosztu modułów). */
const ROUTE_PATHS: ReadonlySet<string> = new Set(
  [...readFileSync("src/routeTree.gen.ts", "utf8").matchAll(/fullPath: '([^']+)'/g)].map((m) =>
    m[1] === "/" ? "/" : m[1].replace(/\/$/, ""),
  ),
);

/**
 * Czy konkretny adres trafia w trasę drzewa: dosłownie albo przez szablon
 * z parametrem (`/admin/revenue/$tab` dla `/admin/revenue/journeys`). Dla
 * `$tab` huba wartość musi być zakładką z `REVENUE_TABS` - inaczej trasa
 * odrzuca adres (`beforeLoad` → 404) mimo zgodnego szablonu.
 */
function resolvesToRoute(path: string): boolean {
  const clean = path === "/" ? "/" : path.replace(/\/$/, "");
  if (ROUTE_PATHS.has(clean)) return true;
  const segments = clean.split("/");
  return [...ROUTE_PATHS].some((template) => {
    const parts = template.split("/");
    if (parts.length !== segments.length) return false;
    return parts.every((part, i) => {
      if (!part.startsWith("$")) return part === segments[i];
      if (template === "/admin/revenue/$tab") {
        return isRevenueTab(segments[i]) && segments[i] !== "overview";
      }
      return segments[i].length > 0;
    });
  });
}

/** Wartości parametrów `search` z kontraktu deep linków SPEC §2.6 (ekrany modułów). */
const MODULE_SEARCH_CONTRACT: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  "/admin/paywall": { tab: ["plans", "metering", "checkout", "overrides"] },
  "/admin/pricing": { tab: ["audiences", "tiers", "faq", "retention"] },
  "/admin/billing": { tab: ["subscriptions", "orders", "events"] },
  "/admin/workflows": { tab: ["definitions"] },
};

function exists(key: string, lng: "pl" | "en"): boolean {
  return i18n.exists(key, { lng, fallbackLng: false });
}

function text(key: string, lng: "pl" | "en"): string {
  return i18n.getFixedT(lng)(key);
}

// ---------------------------------------------------------------------------
// 1. Zakładki = SPEC §2.2
// ---------------------------------------------------------------------------

type HubRoleSet = "admin" | "admin+editor";

/** Tabela SPEC §2.2 przepisana jawnie: grupa, role, domyślne okno. */
const SPEC_TABLE: Readonly<
  Record<RevenueTabId, { group: RevenueTabGroup; roles: HubRoleSet; w: RevenuePeriod | null }>
> = {
  overview: { group: "monitor", roles: "admin+editor", w: "month" },
  mrr: { group: "monitor", roles: "admin", w: "prev-month" },
  funnel: { group: "monitor", roles: "admin+editor", w: "month" },
  retention: { group: "monitor", roles: "admin", w: "prev-month" },
  community: { group: "monitor", roles: "admin+editor", w: "quarter" },
  diagnostics: { group: "fix", roles: "admin+editor", w: null },
  offer: { group: "fix", roles: "admin+editor", w: null },
  access: { group: "fix", roles: "admin+editor", w: "month" },
  journeys: { group: "automate", roles: "admin+editor", w: "month" },
  metrics: { group: "understand", roles: "admin+editor", w: "prev-month" },
  inputs: { group: "understand", roles: "admin", w: null },
};

describe("HUB_TABS - zakładki huba zgodne z SPEC §2.2", () => {
  it("lista zakładek to dokładnie REVENUE_TABS, w tej samej kolejności", () => {
    expect(HUB_TABS.map((spec) => spec.id)).toEqual([...REVENUE_TABS]);
  });

  it.each(REVENUE_TABS)("%s: grupa, role i domyślne okno jak w tabeli SPEC", (tab) => {
    const spec = hubTabSpec(tab);
    const expected = SPEC_TABLE[tab];
    expect(spec?.group).toBe(expected.group);
    expect(spec?.roles).toEqual(expected.roles === "admin" ? ["admin"] : ["admin", "editor"]);
    expect(spec?.defaultPeriod).toBe(expected.w);
    expect(defaultPeriodOf(tab)).toBe(expected.w);
  });

  it("grupy paska występują w kolejności REVENUE_TAB_GROUPS (zakładki nie skaczą między grupami)", () => {
    const order = HUB_TABS.map((spec) => REVENUE_TAB_GROUPS.indexOf(spec.group));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("flagi zakładek: Oferta w podglądzie redaktora, Ścieżki z MFA, Dane wejściowe pod Wskaźnikami, liczniki", () => {
    expect(hubTabSpec("offer")?.editorMode).toBe("preview");
    expect(hubTabSpec("journeys")?.requiresMfa).toBe(true);
    expect(hubTabSpec("inputs")?.parent).toBe("metrics");
    expect(hubTabSpec("diagnostics")?.counter).toBe("diagnostics");
    expect(hubTabSpec("journeys")?.counter).toBe("journeys");
    // MFA wymaga WYŁĄCZNIE zakładka Ścieżek - reszta czyta agregaty bez PII.
    expect(HUB_TABS.filter((spec) => spec.requiresMfa).map((spec) => spec.id)).toEqual([
      "journeys",
    ]);
  });

  it("każda zakładka ma trasę w routeTree.gen.ts (Kokpit = indeks huba, reszta = $tab)", () => {
    expect(ROUTE_PATHS.has("/admin/revenue")).toBe(true);
    expect(ROUTE_PATHS.has("/admin/revenue/$tab")).toBe(true);
    for (const spec of HUB_TABS) {
      const path = spec.id === "overview" ? "/admin/revenue" : `/admin/revenue/${spec.id}`;
      expect(resolvesToRoute(path), spec.id).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Widoczność po rolach (UI = bramka SQL)
// ---------------------------------------------------------------------------

describe("hubTabsFor / canSeeTab - dokładne role, bez super_admin", () => {
  const ADMIN_ONLY: readonly RevenueTabId[] = ["mrr", "retention", "inputs"];

  it("administrator widzi wszystkie 11 zakładek", () => {
    expect(hubTabsFor(["admin"]).map((s) => s.id)).toEqual([...REVENUE_TABS]);
  });

  it("redaktor nie widzi zakładek z kwotami (Przychód, Retencja, Dane wejściowe)", () => {
    const ids = hubTabsFor(["editor"]).map((s) => s.id);
    expect(ids).toEqual(REVENUE_TABS.filter((tab) => !ADMIN_ONLY.includes(tab)));
    for (const tab of ADMIN_ONLY) expect(canSeeTab(tab, ["editor"]), tab).toBe(false);
  });

  it.each([[["author"]], [["super_admin"]], [["user"]], [[]]])(
    "%j nie widzi żadnej zakładki - baza i tak oddałaby puste wyniki",
    (roles) => {
      expect(hubTabsFor(roles)).toEqual([]);
      for (const tab of REVENUE_TABS) expect(canSeeTab(tab, roles), tab).toBe(false);
    },
  );

  it("super_admin z wierszem admin oraz redaktor-admin widzą komplet", () => {
    expect(hubTabsFor(["super_admin", "admin"])).toHaveLength(REVENUE_TABS.length);
    expect(hubTabsFor(["editor", "admin"])).toHaveLength(REVENUE_TABS.length);
  });

  it("canSeeTab zgadza się z hubTabsFor dla każdej roli i zakładki", () => {
    for (const roles of [["admin"], ["editor"], ["author"]]) {
      const visible = new Set(hubTabsFor(roles).map((s) => s.id));
      for (const tab of REVENUE_TABS)
        expect(canSeeTab(tab, roles), `${roles}/${tab}`).toBe(visible.has(tab));
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Obszary, wagi i odnośniki do modułów
// ---------------------------------------------------------------------------

describe("REVENUE_AREAS / AREA_OWNER_LINK - kontrakt S7 i deep linki SPEC §2.6", () => {
  it("16 obszarów diagnostyki z SPEC §5.7 i trzy wagi od najpoważniejszej", () => {
    expect(REVENUE_AREAS).toEqual([
      "catalog",
      "paywall",
      "metering",
      "checkout",
      "coupons",
      "retention",
      "dunning",
      "funnel",
      "crm",
      "newsletter",
      "workflows",
      "journeys",
      "events",
      "clubs",
      "sync",
      "data_quality",
    ]);
    expect(REVENUE_SEVERITIES).toEqual(["critical", "warning", "info"]);
  });

  it.each(REVENUE_AREAS)("%s prowadzi na istniejącą trasę z parametrami z kontraktu", (area) => {
    const link = AREA_OWNER_LINK[area];
    expect(resolvesToRoute(link.to), link.to).toBe(true);
    for (const [key, value] of Object.entries(link.search ?? {})) {
      if (link.to.startsWith("/admin/revenue")) {
        // Hub: parametr musi przejść walidator układu bez utraty wartości.
        expect(parseRevenueHubSearch({ [key]: value }), `${area}.${key}`).toEqual({ [key]: value });
      } else {
        expect(MODULE_SEARCH_CONTRACT[link.to]?.[key], `${area}: ${link.to}?${key}`).toContain(
          value,
        );
      }
    }
  });

  it("widok mapy Diagnostyki jest wartością z REVENUE_VIEWS", () => {
    expect(REVENUE_VIEWS).toContain(AREA_OWNER_LINK.sync.search?.view);
  });
});

describe("RELATED_MODULES - pasek powiązanych modułów", () => {
  it.each(RELATED_MODULES.map((m) => [m.to, m] as const))(
    "%s istnieje i ma napis PL/EN",
    (_to, item) => {
      expect(resolvesToRoute(item.to)).toBe(true);
      expect(ROUTE_PATHS.has(item.to), "moduł to stała trasa, nie szablon").toBe(true);
      expect(exists(item.labelKey, "pl")).toBe(true);
      expect(exists(item.labelKey, "en")).toBe(true);
      expect(text(item.labelKey, "pl")).not.toBe(text(item.labelKey, "en"));
    },
  );

  it("każdy moduł występuje raz i nie prowadzi z powrotem do huba", () => {
    const targets = RELATED_MODULES.map((m) => m.to);
    expect(new Set(targets).size).toBe(targets.length);
    expect(targets.some((to) => to.startsWith("/admin/revenue"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Skala kondycji = skala brandAuditScore
// ---------------------------------------------------------------------------

describe("areaHealthScore - skala brandAuditScore (−20 krytyczna, −7 ważna)", () => {
  it.each([
    [{ critical: 0, warning: 0 }, 100],
    [{ critical: 1, warning: 0 }, 80],
    [{ critical: 0, warning: 1 }, 93],
    [{ critical: 2, warning: 3 }, 39],
    [{ critical: 5, warning: 0 }, 0],
    [{ critical: 6, warning: 9 }, 0],
  ])("%j → %i", (counts, score) => {
    expect(areaHealthScore(counts)).toBe(score);
  });

  it("daje to samo co brandAuditScore dla tej samej liczby błędów i ostrzeżeń", () => {
    for (let critical = 0; critical <= 6; critical += 1) {
      for (let warning = 0; warning <= 15; warning += 1) {
        const findings: BrandFinding[] = [
          ...Array.from({ length: critical }, (_, i): BrandFinding => ({
            id: `e${i}`,
            severity: "error",
          })),
          ...Array.from({ length: warning }, (_, i): BrandFinding => ({
            id: `w${i}`,
            severity: "warning",
          })),
        ];
        expect(areaHealthScore({ critical, warning })).toBe(brandAuditScore(findings));
      }
    }
    expect(AREA_HEALTH_PENALTY).toEqual({ critical: 20, warning: 7 });
  });

  it("zepsute liczniki (ujemne, ułamkowe) nie podnoszą wyniku ponad stan zdrowy", () => {
    expect(areaHealthScore({ critical: -3, warning: -1 })).toBe(100);
    expect(areaHealthScore({ critical: 1.9, warning: 0.5 })).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// 5. Unie słownika powłoki - komplet PL/EN
// ---------------------------------------------------------------------------

/** `true` tylko wtedy, gdy lista wyczerpuje unię - brak wartości to błąd kompilacji. */
type Exhaustive<U, L extends readonly U[]> = [U] extends [L[number]] ? true : false;

const TIERS = ["critical", "weak", "normal", "good", "optimal"] as const satisfies readonly Tier[];
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
const MEASURES = [
  "level",
  "change_yoy",
  "change_mom_cmgr",
  "share_of_base",
  "attainment_vs_plan",
  "cohort_survival",
  "ratio_of_flows",
] as const satisfies readonly Measure[];
const NONE_REASONS = [
  "no_value",
  "no_benchmark",
  "no_context",
  "measure_mismatch",
  "currency_mismatch",
  "vat_mismatch",
  "unit_mismatch",
  "small_sample",
  "no_data",
  "incomparable",
] as const satisfies readonly BenchmarkNoneReason[];
const DIRECTIONS = ["higher", "lower", "range"] as const satisfies readonly BenchDirection[];
const BENCH_GROUPS = [
  "revenue",
  "retention",
  "economics",
  "funnel",
  "email",
  "community",
] as const satisfies readonly BenchGroup[];
const METRIC_GROUPS = [
  "traffic",
  "revenue",
  "retention",
  "funnel",
  "economics",
  "email",
  "community",
  "crm",
] as const satisfies readonly MetricGroup[];
const AREAS = [...REVENUE_AREAS] as const satisfies readonly RevenueArea[];
const SEVERITIES = [...REVENUE_SEVERITIES] as const satisfies readonly RevenueSeverity[];

const EXHAUSTIVE: readonly true[] = [
  true satisfies Exhaustive<Tier, typeof TIERS>,
  true satisfies Exhaustive<BenchWindow, typeof WINDOWS>,
  true satisfies Exhaustive<Measure, typeof MEASURES>,
  true satisfies Exhaustive<BenchmarkNoneReason, typeof NONE_REASONS>,
  true satisfies Exhaustive<BenchDirection, typeof DIRECTIONS>,
  true satisfies Exhaustive<BenchGroup, typeof BENCH_GROUPS>,
  true satisfies Exhaustive<MetricGroup, typeof METRIC_GROUPS>,
  true satisfies Exhaustive<RevenueArea, typeof AREAS>,
  true satisfies Exhaustive<RevenueSeverity, typeof SEVERITIES>,
];

const UNION_KEYS: readonly (readonly [string, readonly string[]])[] = [
  ["adminRevenue.benchmark.tier", TIERS],
  ["adminRevenue.benchmark.window", WINDOWS],
  ["adminRevenue.benchmark.measure", MEASURES],
  // `none` to ogólny brak oceny, reszta - powody z `BenchmarkEvaluation`.
  ["adminRevenue.benchmark.state", ["none", ...NONE_REASONS]],
  ["adminRevenue.benchmark.direction", DIRECTIONS],
  ["adminRevenue.benchmark.confidence", ["low", "medium", "high"]],
  ["adminRevenue.benchmark.group", BENCH_GROUPS],
  ["adminRevenue.benchmark.metricGroup", METRIC_GROUPS],
  [
    "adminRevenue.benchmark.source",
    ["snippet", "vendor", "stale", "reliability_A", "reliability_B", "reliability_C", "accessed"],
  ],
  ["adminRevenue.area", AREAS],
  ["adminRevenue.severity", SEVERITIES],
];

describe("słownik powłoki - każda wartość unii ma napis PL i EN", () => {
  it("listy w teście wyczerpują unie typów (sprawdzane przez kompilator)", () => {
    expect(EXHAUSTIVE.every(Boolean)).toBe(true);
  });

  it.each(UNION_KEYS.map(([prefix, values]) => [prefix, values] as const))(
    "%s",
    (prefix, values) => {
      for (const value of values) {
        const key = `${prefix}.${value}`;
        expect(exists(key, "pl"), `${key} (pl)`).toBe(true);
        expect(exists(key, "en"), `${key} (en)`).toBe(true);
        expect(text(key, "en").trim(), key).not.toBe("");
        // Twardy parytet prefiksu `adminRevenue`: identyczny napis dłuższy niż
        // trzy litery to nieprzetłumaczona pozycja.
        if (/\p{L}{4,}/u.test(text(key, "en"))) {
          expect(text(key, "en"), key).not.toBe(text(key, "pl"));
        }
      }
    },
  );

  it("klucze wymagane przez T4 i S7 (PLAN S6 §3.5) istnieją w obu językach", () => {
    const required = [
      "adminRevenue.status.updatedAt",
      "adminRevenue.status.refreshing",
      "adminRevenue.status.stale",
      "adminRevenue.provenance.dataSince",
      "adminRevenue.provenance.fullFrom",
      "adminRevenue.provenance.basisMix",
      "adminRevenue.provenance.computedAt",
      "adminRevenue.provenance.liveOnly",
      "adminRevenue.provenance.catalogBasis",
      "adminRevenue.provenance.range",
      "adminRevenue.locked.admin_only",
      "adminRevenue.locked.mfa_required",
      "adminRevenue.locked.hint",
      "adminRevenue.money.otherCurrencies_one",
      "adminRevenue.money.otherCurrencies_other",
      "adminRevenue.money.neverSummed",
      "adminRevenue.money.noData",
      "adminRevenue.money.perCurrency",
      "adminRevenue.role.admin",
      "adminRevenue.role.adminOrEditor",
      "adminRevenue.role.editorPreview",
      "adminRevenue.role.adminOnlyTab",
      "adminRevenue.mfaTitle",
      "adminRevenue.mfaBody",
      "adminRevenue.mfaAction",
      "adminRevenue.areaHealth.title",
      "adminRevenue.areaHealth.score",
      "adminRevenue.areaHealth.noData",
      "adminRevenue.areaHealth.counts_one",
      "adminRevenue.areaHealth.counts_other",
      "adminRevenue.nav.label",
      "adminRevenue.nav.sections",
      "adminRevenue.nav.groupLabel",
      "adminRevenue.filters.period",
      "adminRevenue.filters.currency",
      "adminRevenue.filters.segment",
      "adminRevenue.filters.from",
      "adminRevenue.filters.to",
      "adminRevenue.filters.apply",
      "adminRevenue.filters.allCurrencies",
      "adminRevenue.source.header",
      "adminRevenue.source.ownedBy",
      "adminRevenue.source.sameChange",
      "adminRevenue.source.columns",
      "adminRevenue.source.openOwner",
      "adminRevenue.benchmark.help.open",
      ...["label", "value", "bandRange", "caption", "basisB", "basisE", "openStart", "openEnd"].map(
        (k) => `adminRevenue.benchmark.scale.${k}`,
      ),
      ...[
        "title",
        "definition",
        "formula",
        "measures",
        "reading",
        "levers",
        "caveats",
        "benchmark",
        "provenance",
        "pairs",
        "sources",
        "confidence",
        "asOf",
        "more",
        "close",
        "context",
        "window",
        "method",
        "noBenchmark",
        "loading",
        "error",
      ].map((k) => `adminRevenue.benchmark.explainer.${k}`),
      ...[
        "colAbbr",
        "colName",
        "colNow",
        "colTier",
        "colConfidence",
        "colAsOf",
        "filterGroup",
        "search",
        "staleOnly",
        "noMetric",
        "all",
      ].map((k) => `adminRevenue.benchmark.dictionary.${k}`),
    ];
    for (const key of required) {
      expect(exists(key, "pl"), `${key} (pl)`).toBe(true);
      expect(exists(key, "en"), `${key} (en)`).toBe(true);
    }
  });

  it("liczebniki: polskie formy _few/_many odmieniają się inaczej niż _one", () => {
    const t = i18n.getFixedT("pl");
    expect(t("adminRevenue.money.otherCurrencies", { count: 1 })).toBe("+1 inna waluta");
    expect(t("adminRevenue.money.otherCurrencies", { count: 3 })).toBe("+3 inne waluty");
    expect(t("adminRevenue.money.otherCurrencies", { count: 5 })).toBe("+5 innych walut");
    const en = i18n.getFixedT("en");
    expect(en("adminRevenue.money.otherCurrencies", { count: 1 })).toBe("+1 other currency");
    expect(en("adminRevenue.money.otherCurrencies", { count: 5 })).toBe("+5 other currencies");
  });
});
