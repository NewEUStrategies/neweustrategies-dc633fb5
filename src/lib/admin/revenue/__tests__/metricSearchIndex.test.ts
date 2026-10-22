// Skróty wskaźników w wyszukiwarce panelu (⌘K) - `metricSearchIndex.ts`.
//
// CO TEN PLIK DOWODZI.
//   1. ZGODNOŚĆ Z REJESTREM. Lista statyczna (lekka - jedzie w powłoce
//      panelu) to DOKŁADNIE wskaźniki huba, których skrót w rejestrze
//      benchmarków S6 zaczyna się kodem („NRR (NDR)" → „NRR"), w kolejności
//      rejestru - zmiana skrótu w S6 albo nowy wskaźnik z kodem zapala test.
//   2. Unikalność kodów i wskaźników; rozmiar listy i brak importów runtime
//      rejestru (koszt chunku powłoki).
//   3. Wpis prowadzi na zakładkę Wskaźniki z `?metric=`, który walidator
//      układu przepuszcza bez zmian, a trasa istnieje w `routeTree.gen.ts`.
//   4. Role: administrator i redaktor - tak; autor i sam `super_admin` - nie.
//   5. Wyszukiwarka panelu znajduje „NRR · Wskaźniki" po kodzie i po nazwie.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";

import "@/test/i18nReal";
import i18n from "@/lib/i18n";
import "@/lib/i18n-admin-core";
import { searchAdminNav, type AdminNavGroup } from "@/lib/admin/adminNav";
import {
  METRICS_TAB_PATH,
  METRIC_SHORTCUTS,
  metricSearchEntries,
  type MetricSearchEntry,
} from "@/lib/admin/revenue/metricSearchIndex";
import { primaryBenchmarkFor } from "@/lib/analytics/semantic/benchmarks/index";
import { HUB_METRIC_IDS, type MetricId } from "@/lib/analytics/semantic/metrics";
import { parseRevenueHubSearch } from "@/lib/revenue/search";
import type { AdminNavSearchEntry } from "@/lib/admin/adminNav";

/** Kod wskaźnika: 2-8 wielkich liter, cyfr albo „/" (MRR, V2R, LTV/CAC, DAU/MAU). */
const CODE = /^[A-Z0-9/]{2,8}$/;

/** Wiodący token skrótu z rejestru - tak, jak go pokazuje wiersz słownika. */
function leadingCode(abbr: string | undefined): string | null {
  if (!abbr) return null;
  const lead = abbr.split(/\s[(/]/)[0]?.trim() ?? "";
  return CODE.test(lead) ? lead : null;
}

const ROUTE_PATHS: ReadonlySet<string> = new Set(
  [...readFileSync("src/routeTree.gen.ts", "utf8").matchAll(/fullPath: '([^']+)'/g)].map((m) =>
    m[1] === "/" ? "/" : m[1].replace(/\/$/, ""),
  ),
);

describe("METRIC_SHORTCUTS - zgodność z rejestrem S6", () => {
  it("dokładnie wskaźniki huba z kodem w skrócie rejestru, w kolejności rejestru", () => {
    const expected = HUB_METRIC_IDS.flatMap((metricId) => {
      const abbr = leadingCode(primaryBenchmarkFor(metricId)?.abbr);
      return abbr ? [{ metricId, abbr }] : [];
    });
    expect(METRIC_SHORTCUTS).toEqual(expected);
  });

  it("przykład z karty: NRR → net_revenue_retention", () => {
    expect(METRIC_SHORTCUTS).toContainEqual({ metricId: "net_revenue_retention", abbr: "NRR" });
  });

  it("kody i wskaźniki są unikalne (także bez wielkości liter)", () => {
    const codes = METRIC_SHORTCUTS.map((s) => s.abbr.toLowerCase());
    expect(new Set(codes).size).toBe(codes.length);
    const ids = METRIC_SHORTCUTS.map((s) => s.metricId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("lekka lista: rozmiar ograniczony, rejestr i benchmarki tylko jako typy", () => {
    expect(METRIC_SHORTCUTS.length).toBeLessThanOrEqual(HUB_METRIC_IDS.length);
    expect(JSON.stringify(METRIC_SHORTCUTS).length).toBeLessThanOrEqual(3 * 1024);
    const source = readFileSync("src/lib/admin/revenue/metricSearchIndex.ts", "utf8");
    const runtimeImports = [...source.matchAll(/^import (?!type )[^;]+;/gm)].map((m) => m[0]);
    for (const line of runtimeImports) {
      expect(line).not.toMatch(/analytics\/semantic/);
    }
  });
});

describe("metricSearchEntries - wpisy ⌘K", () => {
  const entries = metricSearchEntries("Wskaźniki", ["admin"]);

  it("„NRR · Wskaźniki” → /admin/revenue/metrics?metric=net_revenue_retention", () => {
    expect(entries).toContainEqual({
      to: "/admin/revenue/metrics",
      search: { metric: "net_revenue_retention" },
      label: "NRR · Wskaźniki",
      keywords: ["nrr", "net revenue retention"],
    });
  });

  it("każdy wpis: trasa z routeTree, `?metric=` przechodzi walidator układu bez zmian", () => {
    expect(METRICS_TAB_PATH).toBe("/admin/revenue/metrics");
    expect(ROUTE_PATHS.has("/admin/revenue/$tab")).toBe(true);
    for (const entry of entries) {
      expect(entry.to).toBe(METRICS_TAB_PATH);
      expect(parseRevenueHubSearch({ ...entry.search })).toEqual(entry.search);
      expect(HUB_METRIC_IDS).toContain(entry.search.metric as MetricId);
    }
  });

  it("kształt wpisu = AdminNavSearchEntry (wpięcie w adminNav bez adaptera)", () => {
    const asNav: AdminNavSearchEntry[] = entries satisfies MetricSearchEntry[];
    expect(asNav).toHaveLength(METRIC_SHORTCUTS.length);
  });

  it.each([
    [["admin"], true],
    [["editor"], true],
    [["author"], false],
    [["super_admin"], false],
  ])("role %j - skróty: %s", (roles, visible) => {
    expect(metricSearchEntries("Wskaźniki", roles).length > 0).toBe(visible);
  });
});

describe("wyszukiwarka panelu znajduje skrót", () => {
  function groups(): AdminNavGroup[] {
    const t = i18n.getFixedT("pl") as TFunction;
    return [
      {
        id: "monetization",
        items: [
          {
            to: "/admin/revenue",
            icon: () => null,
            label: "Przychód i lejek",
            searchEntries: metricSearchEntries(t("admin.nav.revenueTabs.metrics"), ["admin"]),
          },
        ],
      },
    ];
  }

  it("po kodzie („nrr”) - pierwsze trafienie to arkusz NRR", async () => {
    await i18n.changeLanguage("pl");
    const [first] = searchAdminNav(groups(), "nrr");
    expect(first.item.label).toBe("NRR · Wskaźniki");
    expect("search" in first.item ? first.item.search : null).toEqual({
      metric: "net_revenue_retention",
    });
    expect(first.groupLabel).toBe("Przychód i lejek");
  });

  it("po nazwie z rejestru („revenue retention”)", () => {
    const labels = searchAdminNav(groups(), "revenue retention").map((hit) => hit.item.label);
    expect(labels).toEqual(expect.arrayContaining(["NRR · Wskaźniki", "GRR · Wskaźniki"]));
  });
});
