// Kontrakt trybu strony głównej (ustawienia czytania -> trasa "/"):
//  - homepageModeQueryOptions normalizuje surowe ustawienie do zamkniętej unii,
//  - w trybie "najnowsze wpisy" homePageQueryOptions zwraca null BEZ rezolucji
//    jakiejkolwiek strony (zero selectów po pages, zero gated RPC) - to na tym
//    opiera się i head() (defaulty marki zamiast SEO ukrytej strony), i brak
//    zbędnych round-tripów w loaderze,
//  - tryb strony statycznej i historyczny fallback slug="home" działają jak
//    dotąd (regresja wstecz).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  fromTables: [] as string[],
  rpcNames: [] as string[],
  reading: {} as Record<string, unknown>,
  pageRow: null as Record<string, unknown> | null,
}));

vi.mock("@/integrations/supabase/client", () => {
  interface Chain {
    select: (cols?: string) => Chain;
    eq: (col: string, v: unknown) => Chain;
    is: (col: string, v: unknown) => Chain;
    order: (col: string, opts?: unknown) => Chain;
    limit: (n: number) => Chain;
    in: (col: string, v: readonly unknown[]) => Chain;
    maybeSingle: () => Promise<{ data: unknown; error: null }>;
  }
  const makeChain = (resolve: () => unknown): Chain => {
    const chain: Chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      order: () => chain,
      limit: () => chain,
      in: () => chain,
      maybeSingle: async () => ({ data: resolve(), error: null }),
    };
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => {
        state.fromTables.push(table);
        if (table === "site_settings") return makeChain(() => ({ value: state.reading }));
        if (table === "pages") return makeChain(() => state.pageRow);
        return makeChain(() => null);
      },
      rpc: async (name: string) => {
        state.rpcNames.push(name);
        return { data: [], error: null };
      },
    },
  };
});

import {
  homePageQueryOptions,
  homepageModeQueryOptions,
  normalizeHomepageMode,
} from "@/lib/queries/public";

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  state.fromTables.length = 0;
  state.rpcNames.length = 0;
  state.reading = {};
  state.pageRow = null;
});

describe("normalizeHomepageMode", () => {
  it("przepuszcza wyłącznie znane tryby", () => {
    expect(normalizeHomepageMode("latest_posts")).toBe("latest_posts");
    expect(normalizeHomepageMode("static_page")).toBe("static_page");
  });

  it("nieznane i uszkodzone wartości spadają do pustego trybu", () => {
    expect(normalizeHomepageMode("")).toBe("");
    expect(normalizeHomepageMode(undefined)).toBe("");
    expect(normalizeHomepageMode("LATEST_POSTS")).toBe("");
    expect(normalizeHomepageMode(42)).toBe("");
    expect(normalizeHomepageMode({})).toBe("");
  });
});

describe("homepageModeQueryOptions", () => {
  it("zwraca znormalizowany tryb z ustawień czytania", async () => {
    state.reading = { homepage_mode: "latest_posts" };
    await expect(freshClient().fetchQuery(homepageModeQueryOptions())).resolves.toBe(
      "latest_posts",
    );
  });

  it("nieznana wartość ustawienia spada do pustego trybu", async () => {
    state.reading = { homepage_mode: "carousel" };
    await expect(freshClient().fetchQuery(homepageModeQueryOptions())).resolves.toBe("");
  });
});

describe("homePageQueryOptions - tryb najnowszych wpisów", () => {
  it("zwraca null bez rezolucji strony i bez gated RPC", async () => {
    state.reading = { homepage_mode: "latest_posts" };
    // Nawet gdy strona "home" istnieje - nie wolno jej dotykać: jej SEO
    // (title/canonical/seo_noindex) nie może opisywać listy wpisów.
    state.pageRow = { id: "home-1", slug: "home", editor: "builder" };

    await expect(freshClient().fetchQuery(homePageQueryOptions())).resolves.toBeNull();
    expect(state.fromTables).not.toContain("pages");
    expect(state.rpcNames).toHaveLength(0);
  });
});

describe("homePageQueryOptions - tryb strony statycznej", () => {
  it("rezolwuje wskazaną stronę i dokleja gated body przez RPC", async () => {
    state.reading = { homepage_mode: "static_page", homepage_page_slug: "o-nas" };
    state.pageRow = { id: "p-1", slug: "o-nas", editor: "builder" };

    const res = await freshClient().fetchQuery(homePageQueryOptions());
    expect(res?.id).toBe("p-1");
    expect(state.fromTables).toContain("pages");
    expect(state.rpcNames).toContain("get_entity_content");
  });

  it("bez decyzji w ustawieniach zachowuje historyczny fallback slug=home", async () => {
    state.reading = {};
    state.pageRow = { id: "home-1", slug: "home", editor: "richtext" };

    const res = await freshClient().fetchQuery(homePageQueryOptions());
    expect(res?.id).toBe("home-1");
    expect(state.fromTables).toContain("pages");
  });
});
