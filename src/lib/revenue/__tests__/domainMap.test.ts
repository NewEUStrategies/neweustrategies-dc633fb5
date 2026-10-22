// MAPA DZIEDZIN HUBA → `queryOptions` (karta I9, SPEC §5.3-5.4).
//
// `RevenueDomain` (`lib/revenue/keys.ts`) to prefiks inwalidacji
// `["admin-revenue", dziedzina, najemca]`: reguła szyny trafia w KAŻDE
// zapamiętane okno dziedziny. Ta obietnica działa tylko wtedy, gdy każda
// dziedzina ma odczyt, który naprawdę żyje pod tym prefiksem - dziedzina bez
// `queryOptions` to reguła szyny strzelająca w próżnię, a odczyt spod innego
// prefiksu to karta, której zdarzenie nigdy nie odświeży.
//
// CO TEN PLIK DOWODZI:
//   1. KOMPLET: tabela `Record<RevenueDomain, …>` (kompilator wymaga wpisu
//      dla nowej dziedziny) i ta sama lista co `REVENUE_DOMAINS`, łącznie
//      z `diagnostics` (fakty i wyciszenia S7).
//   2. KLUCZ: `[0] = "admin-revenue"`, `[1] = dziedzina`, `[2] = najemca`.
//   3. WSPÓLNE (§5.4): `retry: 1`, `gcTime` 10 min, bez `refetchInterval`,
//      bez najemcy zapytanie wyłączone; `staleTime` wg klasy dziedziny -
//      okno otwarte 60 s / zamknięte 30 min, wolny pas 5 min, stan bieżący 30 s.
//
// Nic tu nie woła sieci: `queryOptions` to czyste obiekty, a server fn są
// atrapami (`serverFnStubModule`) - test nie zależy od Supabase.
import type { QueryKey } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

import { revenueSnapshotQueryOptions } from "@/lib/analytics/semantic/revenueSnapshot.functions";
import { revenueAccessInventoryQueryOptions } from "@/lib/revenue/access/queries";
import {
  revenueClubsSummaryQueryOptions,
  revenueEventsSummaryQueryOptions,
} from "@/lib/revenue/community/queries";
import {
  revenueFactsQueryOptions,
  revenueSnoozesQueryOptions,
} from "@/lib/revenue/diagnostics/queries";
import { revenueEmailHealthQueryOptions } from "@/lib/revenue/email/queries";
import {
  revenueChurnQueryOptions,
  revenueCohortsQueryOptions,
  revenueDunningQueryOptions,
  revenueEconomicsQueryOptions,
  revenueInputsQueryOptions,
  revenueMrrBridgeQueryOptions,
  revenueMrrSeriesQueryOptions,
  revenueOfferMatrixQueryOptions,
  revenueRealizedQueryOptions,
  revenueRetentionOffersQueryOptions,
} from "@/lib/revenue/finance/queries";
import { revenueFunnelQueryOptions } from "@/lib/revenue/funnel/queries";
import { REVENUE_DOMAINS, type RevenueDomain } from "@/lib/revenue/keys";
import { resolveRevenueRange, type RevenueRange } from "@/lib/revenue/window";

const TENANT = "11111111-1111-4111-a111-111111111111";
/** „Teraz" podawane jawnie - okno bieżącego miesiąca jest otwarte, poprzedniego zamknięte. */
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);
const OPEN = resolveRevenueRange("month", NOW);
const CLOSED = resolveRevenueRange("prev-month", NOW);

/** Pola `queryOptions`, które sprawdza ta mapa (wspólny kontrakt §5.4). */
interface DomainRead {
  queryKey: QueryKey;
  staleTime?: unknown;
  gcTime?: number;
  retry?: unknown;
  enabled?: unknown;
  refetchInterval?: unknown;
}

/** Klasa świeżości dziedziny (SPEC §5.4). */
type StaleClass = "window" | "slow" | "current";

/** Odczyty dziedziny dla okna, najemcy (albo jego braku). */
type DomainReads = (range: RevenueRange, tenantId: string | null) => readonly DomainRead[];

const DOMAIN_MAP = {
  snapshot: {
    stale: "window",
    reads: (range, tenant) => [revenueSnapshotQueryOptions(tenant, range)],
  },
  mrr: {
    stale: "window",
    reads: (range, tenant) => [
      revenueMrrBridgeQueryOptions(tenant, range),
      revenueMrrSeriesQueryOptions(tenant, range, "day", "Europe/Warsaw"),
    ],
  },
  realized: {
    stale: "window",
    reads: (range, tenant) => [revenueRealizedQueryOptions(tenant, range)],
  },
  retention: {
    stale: "window",
    reads: (range, tenant) => [revenueRetentionOffersQueryOptions(tenant, range)],
  },
  funnel: { stale: "window", reads: (range, tenant) => [revenueFunnelQueryOptions(tenant, range)] },
  events: {
    stale: "window",
    reads: (range, tenant) => [revenueEventsSummaryQueryOptions(tenant, range)],
  },
  clubs: {
    stale: "window",
    reads: (range, tenant) => [revenueClubsSummaryQueryOptions(tenant, range)],
  },
  email: {
    stale: "window",
    reads: (range, tenant) => [revenueEmailHealthQueryOptions(tenant, range)],
  },
  churn: { stale: "slow", reads: (range, tenant) => [revenueChurnQueryOptions(tenant, range)] },
  dunning: { stale: "slow", reads: (range, tenant) => [revenueDunningQueryOptions(tenant, range)] },
  cohorts: {
    stale: "slow",
    reads: (_range, tenant) => [revenueCohortsQueryOptions(tenant, "2026-01", "2026-09")],
  },
  inputs: {
    stale: "slow",
    reads: (_range, tenant) => [revenueInputsQueryOptions(tenant, "2026-01", "2026-09")],
  },
  economics: {
    stale: "slow",
    reads: (_range, tenant) => [
      revenueEconomicsQueryOptions(tenant, "2026-01", "2026-09", "Europe/Warsaw"),
    ],
  },
  offer: { stale: "current", reads: (_range, tenant) => [revenueOfferMatrixQueryOptions(tenant)] },
  access: {
    stale: "current",
    reads: (_range, tenant) => [revenueAccessInventoryQueryOptions(tenant)],
  },
  diagnostics: {
    stale: "current",
    reads: (_range, tenant) => [
      revenueFactsQueryOptions(tenant),
      revenueSnoozesQueryOptions(tenant),
    ],
  },
} as const satisfies Readonly<Record<RevenueDomain, { stale: StaleClass; reads: DomainReads }>>;

const ENTRIES = REVENUE_DOMAINS.map((domain) => [domain, DOMAIN_MAP[domain]] as const);

const MINUTE = 60_000;

describe("mapa dziedzin huba → queryOptions", () => {
  it("komplet: każda `RevenueDomain` (także `diagnostics`) ma odczyt i nic ponad listę", () => {
    expect(Object.keys(DOMAIN_MAP).sort()).toEqual([...REVENUE_DOMAINS].sort());
    for (const [domain, entry] of ENTRIES) {
      expect(entry.reads(OPEN, TENANT).length, domain).toBeGreaterThan(0);
    }
  });

  it.each(ENTRIES)(
    "%s: klucz pod prefiksem inwalidacji [admin-revenue, dziedzina, najemca]",
    (domain, entry) => {
      for (const read of entry.reads(OPEN, TENANT)) {
        expect(read.queryKey.slice(0, 3)).toEqual(["admin-revenue", domain, TENANT]);
      }
    },
  );

  it.each(ENTRIES)("%s: retry 1, gcTime 10 min, bez odpytywania w tle", (domain, entry) => {
    for (const read of entry.reads(OPEN, TENANT)) {
      expect(read.retry, domain).toBe(1);
      expect(read.gcTime, domain).toBe(10 * MINUTE);
      expect(read.refetchInterval, domain).toBeUndefined();
    }
  });

  it.each(ENTRIES)("%s: bez najemcy zapytanie jest wyłączone", (domain, entry) => {
    for (const read of entry.reads(OPEN, null)) {
      expect(read.enabled, domain).toBe(false);
    }
  });

  it.each(ENTRIES)("%s: staleTime według klasy dziedziny (SPEC §5.4)", (domain, entry) => {
    const open = entry.reads(OPEN, TENANT).map((read) => read.staleTime);
    const closed = entry.reads(CLOSED, TENANT).map((read) => read.staleTime);
    if (entry.stale === "window") {
      expect([OPEN.complete, CLOSED.complete], "fikstura okien").toEqual([false, true]);
      expect(
        open.every((ms) => ms === MINUTE),
        domain,
      ).toBe(true);
      expect(
        closed.every((ms) => ms === 30 * MINUTE),
        domain,
      ).toBe(true);
    } else if (entry.stale === "slow") {
      expect(
        [...open, ...closed].every((ms) => ms === 5 * MINUTE),
        domain,
      ).toBe(true);
    } else {
      expect(
        [...open, ...closed].every((ms) => ms === 30_000),
        domain,
      ).toBe(true);
    }
  });
});
