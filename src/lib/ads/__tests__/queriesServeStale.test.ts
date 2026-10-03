// Rozgrzewka SSR slotów reklamowych (`prefetchAdPlacementQueries`) a okno
// serve-stale cache'u izolatu.
//
// PO CO OSOBNY PLIK. `queries.test.ts` biegnie z PRAWDZIWYM `edgeTtlCache`, który
// w przeglądarce (happy-dom ma `window`) jest przezroczysty: każde wywołanie to
// świeży fetch, więc znacznik czasu pobrania zawsze równa się „teraz" i różnicy
// nie da się tam zobaczyć. W SSR jest inaczej - `edgeTtlCache` po upływie TTL
// (60 s) serwuje wpis nieświeży jeszcze do 5 x TTL i odświeża go w tle. Ten plik
// atrapuje WYŁĄCZNIE ten magazyn (mapa trzymająca wartość bez względu na wiek -
// dokładnie to, co widzi wołający w oknie serve-stale) i klienta Supabase.
//
// CO BYŁO ŹLE. Rozgrzewka zasiewała wiersze z `updatedAt` = chwila zasiewu, więc
// lista pobrana z bazy cztery minuty wcześniej rodziła się w przeglądarce jako
// świeża i trzymała się kolejną minutę - obietnica „60 s" w komentarzach
// rozciągała się do sześciu, a kampania zakończona w tym czasie wracała na stronę.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const stubs = vi.hoisted(() => ({ from: null as unknown }));
const edge = vi.hoisted(() => ({ store: new Map<string, unknown>(), fetches: 0 }));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  const from = supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: async <T>(key: string, _ttlMs: number, fn: () => Promise<T>): Promise<T> => {
    if (edge.store.has(key)) return edge.store.get(key) as T;
    edge.fetches += 1;
    const value = await fn();
    edge.store.set(key, value);
    return value;
  },
}));

import { QueryClient } from "@tanstack/react-query";
import { adPlacementsQueryOptions, prefetchAdPlacementQueries } from "@/lib/ads/queries";
import { ok, type SupabaseFromStub } from "@/test/supabaseChain";
import type { AdPlacementWithSlot } from "@/lib/ads/types";

const from = () => stubs.from as SupabaseFromStub;

const T0 = new Date("2026-10-01T12:00:00.000Z").getTime();

function bannerPlacement(over: Partial<AdPlacementWithSlot> = {}): AdPlacementWithSlot {
  return {
    id: "66666666-7777-8888-9999-000000000001",
    tenant_id: "aaaaaaaa-0000-0000-0000-00000000000a",
    slot_id: "11111111-2222-3333-4444-555555555555",
    position: "header_banner",
    page_type: "all",
    page_id: null,
    config: {},
    sort_order: 0,
    active: true,
    starts_at: null,
    ends_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    slot: {
      id: "11111111-2222-3333-4444-555555555555",
      tenant_id: "aaaaaaaa-0000-0000-0000-00000000000a",
      name: "Baner",
      kind: "image",
      status: "active",
      html: null,
      script: null,
      image_url: "https://cdn.example.com/baner.png",
      image_link: null,
      image_alt: "Baner",
      width: 970,
      height: 90,
      requires_consent: false,
      targeting: {},
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-08-01T00:00:00.000Z",
    },
    ...over,
  };
}

const bannerKey = () => adPlacementsQueryOptions("header_banner", "post").queryKey;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  from().reset();
  edge.store.clear();
  edge.fetches = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rozgrzewka SSR a wpis z okna serve-stale", () => {
  it("wpis z cieplego cache'u (mlodszy niz TTL) rodzi sie swiezy - bez round-tripu po hydratacji", async () => {
    from().setResponse("ad_placements", ok([bannerPlacement()]));
    await prefetchAdPlacementQueries(new QueryClient(), [{ position: "header_banner" }], "post");

    vi.setSystemTime(T0 + 20_000);
    const qc = new QueryClient();
    await prefetchAdPlacementQueries(qc, [{ position: "header_banner" }], "post");

    const state = qc.getQueryState(bannerKey());
    expect(edge.fetches).toBe(1);
    expect(state?.dataUpdatedAt).toBe(T0);
    // `staleTime` = 60 s: wiersze sprzed 20 s są nadal świeże.
    expect(Date.now() - (state?.dataUpdatedAt ?? 0)).toBeLessThan(60_000);
  });

  it("wpis sprzed czterech minut NIE dostaje znacznika `teraz`", async () => {
    from().setResponse("ad_placements", ok([bannerPlacement()]));
    await prefetchAdPlacementQueries(new QueryClient(), [{ position: "header_banner" }], "post");

    vi.setSystemTime(T0 + 4 * 60_000);
    const qc = new QueryClient();
    await prefetchAdPlacementQueries(qc, [{ position: "header_banner" }], "post");

    // Czas pobrania z bazy, nie chwila zasiewu: przeglądarka widzi wpis jako
    // przeterminowany i odświeża go po hydratacji, zamiast trzymać kolejną
    // minutę. Piksele slotu są już zarezerwowane przez SSR - bez skoku układu.
    expect(edge.fetches).toBe(1);
    expect(qc.getQueryState(bannerKey())?.dataUpdatedAt).toBe(T0);
    expect(qc.getQueryData(bannerKey())).toHaveLength(1);
  });

  it("kampania, ktora skonczyla sie miedzy pobraniem a serwowaniem, nie trafia do HTML-a", async () => {
    const endsSoon = bannerPlacement({ ends_at: new Date(T0 + 90_000).toISOString() });
    from().setResponse("ad_placements", ok([endsSoon]));
    await prefetchAdPlacementQueries(new QueryClient(), [{ position: "header_banner" }], "post");

    vi.setSystemTime(T0 + 3 * 60_000);
    const qc = new QueryClient();
    await prefetchAdPlacementQueries(qc, [{ position: "header_banner" }], "post");

    // Baza oddała wiersz zgodnie z prawdą (okno trwało), ale lista leżała
    // w cache'u izolatu dłużej, niż trwała emisja - niezafakturowana emisja.
    expect(qc.getQueryData(bannerKey())).toEqual([]);
  });

  it("zapytanie jednopozycyjne (rozgrzewka korzenia) tez filtruje okno PO cache'u", async () => {
    const endsSoon = bannerPlacement({ ends_at: new Date(T0 + 30_000).toISOString() });
    from().setResponse("ad_placements", ok([endsSoon]));
    const options = adPlacementsQueryOptions("header_banner", "post");

    expect(await new QueryClient().fetchQuery(options)).toEqual([endsSoon]);

    vi.setSystemTime(T0 + 2 * 60_000);
    expect(await new QueryClient().fetchQuery(options)).toEqual([]);
    expect(edge.fetches).toBe(1);
  });
});
