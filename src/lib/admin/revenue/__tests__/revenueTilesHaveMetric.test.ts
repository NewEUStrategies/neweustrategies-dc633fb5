// Kafle KPI huba (S7, SPEC §6.2; `overviewTiles.ts`).
//
// CO TEN PLIK DOWODZI.
//   1. Każdy kafel każdego zestawu ma `metricId` z rejestru S6 (wskaźnik huba,
//      nie ruchu) - kafel bez definicji nie miałby objaśnienia ani oceny.
//   2. Każdy `drillHref` trafia w ISTNIEJĄCĄ trasę z `routeTree.gen.ts`:
//      `/admin/revenue/$tab` z identyfikatorem z `REVENUE_TABS` (nie Kokpit,
//      który jest indeksem) - kafel nie prowadzi na 404.
//   3. Zakładka szczegółów jest widoczna dla KAŻDEJ roli kafla - redaktor nie
//      dostaje odnośnika do zakładki, na której zobaczy bramkę roli.
//   4. Zestawy Kokpitu: administrator 6 z kwotami, redaktor 6 bez żadnej kwoty
//      i bez kafla tylko-dla-administratora; wybór po DOKŁADNYCH rolach.
//   5. Przychód zrealizowany z migawki: klucz Kokpitu bez filtrów = klucz BI.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { snapshotFiltersOf } from "@/components/admin/revenue/overview/hubWindow";
import { canSeeTab } from "@/lib/admin/revenue/hubTabs";
import {
  MRR_KPI_TILES,
  OVERVIEW_ADMIN_TILES,
  OVERVIEW_EDITOR_TILES,
  RETENTION_KPI_TILES,
  REVENUE_TILE_SETS,
  canSeeTile,
  overviewTilesFor,
  type RevenueTileSpec,
} from "@/lib/admin/revenue/overviewTiles";
import { HUB_METRIC_IDS, metricById } from "@/lib/analytics/semantic/metrics";
import { revenueSnapshotQueryOptions } from "@/lib/analytics/semantic/revenueSnapshot.functions";
import { isRevenueTab } from "@/lib/revenue/search";
import { resolveRevenueRange } from "@/lib/revenue/window";

const ROUTE_PATHS: readonly string[] = [
  ...readFileSync("src/routeTree.gen.ts", "utf8").matchAll(/fullPath: '([^']+)'/g),
].map((m) => (m[1] === "/" ? "/" : m[1].replace(/\/$/, "")));

/** Trasa z drzewa pasująca do adresu - segmenty `$param` pasują do dowolnej wartości. */
function matchRoute(href: string): { route: string; params: Record<string, string> } | null {
  const segments = href.split("/");
  for (const route of ROUTE_PATHS) {
    const pattern = route.split("/");
    if (pattern.length !== segments.length) continue;
    const params: Record<string, string> = {};
    const ok = pattern.every((part, i) => {
      if (part.startsWith("$")) {
        params[part.slice(1)] = segments[i] as string;
        return true;
      }
      return part === segments[i];
    });
    if (ok) return { route, params };
  }
  return null;
}

const ALL_TILES: readonly [string, RevenueTileSpec][] = Object.entries(REVENUE_TILE_SETS).flatMap(
  ([set, tiles]) => tiles.map((tile): [string, RevenueTileSpec] => [set, tile]),
);

describe("kafle KPI huba - rejestr wskaźników i trasy", () => {
  it("skan widzi trasy huba (pusty skan byłby cicho zielony)", () => {
    expect(ROUTE_PATHS).toContain("/admin/revenue/$tab");
    expect(ALL_TILES.length).toBeGreaterThanOrEqual(12);
  });

  it.each(ALL_TILES)("%s: %o ma metricId z rejestru S6 i wskaźnik huba", (_set, tile) => {
    expect(() => metricById(tile.metricId)).not.toThrow();
    expect(HUB_METRIC_IDS).toContain(tile.metricId);
  });

  it.each(ALL_TILES)("%s: %o prowadzi na istniejącą trasę zakładki", (_set, tile) => {
    const match = matchRoute(tile.drillHref);
    expect(match, tile.drillHref).not.toBeNull();
    expect(match?.route).toBe("/admin/revenue/$tab");
    const tab = match?.params.tab;
    expect(isRevenueTab(tab), `${tab}`).toBe(true);
    // Kokpit ma jeden adres (indeks) - `/admin/revenue/overview` to 404.
    expect(tab).not.toBe("overview");
  });

  it.each(ALL_TILES)("%s: %o - zakładka szczegółów jest widoczna dla ról kafla", (_set, tile) => {
    const tab = tile.drillHref.split("/").pop() as Parameters<typeof canSeeTab>[0];
    for (const role of tile.roles) expect(canSeeTab(tab, [role]), `${role} → ${tab}`).toBe(true);
  });

  it("kafel kwoty jest metryką pieniężną rejestru (i odwrotnie w zestawach Kokpitu)", () => {
    for (const [, tile] of ALL_TILES) {
      expect(Boolean(metricById(tile.metricId).currencyBound), tile.metricId).toBe(tile.money);
    }
  });

  it("w zestawie nie ma powtórzonego wskaźnika", () => {
    for (const tiles of Object.values(REVENUE_TILE_SETS)) {
      const ids = tiles.map((tile) => tile.metricId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe("zestawy Kokpitu", () => {
  it("administrator: 6 kafli, w tym kwoty (MRR, przychód zrealizowany)", () => {
    expect(OVERVIEW_ADMIN_TILES).toHaveLength(6);
    const ids = OVERVIEW_ADMIN_TILES.map((tile) => tile.metricId);
    expect(ids).toEqual(expect.arrayContaining(["mrr", "revenue_realized"]));
    expect(OVERVIEW_ADMIN_TILES.some((tile) => tile.money)).toBe(true);
  });

  it("redaktor: 6 kafli bez żadnej kwoty i bez kafla tylko-dla-administratora", () => {
    expect(OVERVIEW_EDITOR_TILES).toHaveLength(6);
    for (const tile of OVERVIEW_EDITOR_TILES) {
      expect(tile.money, tile.metricId).toBe(false);
      expect(metricById(tile.metricId).currencyBound, tile.metricId).toBeUndefined();
      expect(canSeeTile(tile, ["editor"]), tile.metricId).toBe(true);
    }
  });

  it("wybór zestawu po DOKŁADNYCH rolach - sam super_admin nie dostaje nic", () => {
    expect(overviewTilesFor(["admin"])).toBe(OVERVIEW_ADMIN_TILES);
    expect(overviewTilesFor(["editor", "admin"])).toBe(OVERVIEW_ADMIN_TILES);
    expect(overviewTilesFor(["editor"])).toBe(OVERVIEW_EDITOR_TILES);
    expect(overviewTilesFor(["super_admin"])).toEqual([]);
    expect(overviewTilesFor(["author"])).toEqual([]);
  });

  it("zakładki Przychód i Retencja mają własne wiersze KPI - tylko dla administratora", () => {
    expect(MRR_KPI_TILES.map((tile) => tile.metricId)).toContain("revenue_realized");
    for (const tile of [...MRR_KPI_TILES, ...RETENTION_KPI_TILES]) {
      expect(tile.roles, tile.metricId).toEqual(["admin"]);
    }
  });

  it("każdy kafel czyta migawkę S6 - przychód zrealizowany spod klucza BI", () => {
    for (const [, tile] of ALL_TILES) expect(tile.source).toBe("snapshot");
    const range = resolveRevenueRange("month", Date.UTC(2026, 9, 15, 12));
    const tenant = "11111111-1111-4111-8111-111111111111";
    // BI (`RevenueInsightSection`) woła fabrykę bez filtrów; Kokpit bez
    // wybranej waluty i segmentu ma dać DOKŁADNIE ten sam klucz.
    expect(
      revenueSnapshotQueryOptions(tenant, range, snapshotFiltersOf(null, "all")).queryKey,
    ).toEqual(revenueSnapshotQueryOptions(tenant, range).queryKey);
    expect(
      revenueSnapshotQueryOptions(tenant, range, snapshotFiltersOf("EUR", "b2b_institution"))
        .queryKey,
    ).not.toEqual(revenueSnapshotQueryOptions(tenant, range).queryKey);
  });
});
