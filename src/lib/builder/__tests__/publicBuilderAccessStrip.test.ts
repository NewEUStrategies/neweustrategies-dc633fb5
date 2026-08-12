// @vitest-environment node
//
// K7: bramki `advanced.access` są egzekwowane PO STRONIE SERWERA.
//
// Renderer filtrował zabramkowane węzły w przeglądarce, ale publiczny loader
// wysyłał całe `builder_data`, więc treść „tylko dla zalogowanych" siedziała w
// źródle strony każdego gościa (i w edge-cache'owanym HTML-u, wspólnym dla
// wszystkich odwiedzających). Środowisko `node` = brak `window`, czyli biegnie
// dokładnie ścieżka SSR-owa: ta sama, którą obejmuje edgeTtlCache.
//
// Projekcja serwerowa jest ZAWSZE gościnna i to jest wymóg, nie uproszczenie:
// wynik trafia do współdzielonego cache'u per host, więc strip zależny od
// tożsamości podałby węzły jednego czytelnika następnemu.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const SECRET = "TRESC-TYLKO-DLA-ZALOGOWANYCH";

const state = vi.hoisted(() => ({
  host: "tenant-a.example" as string | null,
  builderData: null as unknown,
}));

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(state.host),
  currentTenantAssertion: () => Promise.resolve(null),
  requestPublicHost: () => state.host,
}));

vi.mock("@/integrations/supabase/client", () => {
  interface Chain {
    select: () => Chain;
    eq: () => Chain;
    is: () => Chain;
    in: () => Chain;
    order: () => Chain;
    limit: () => Chain;
    maybeSingle: () => Promise<{ data: unknown; error: null }>;
  }
  const makeChain = (resolve: () => unknown): Chain => {
    const chain: Chain = {
      select: () => chain,
      eq: () => chain,
      is: () => chain,
      in: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: resolve(), error: null }),
    };
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => {
        if (table === "pages") {
          return makeChain(() => ({ id: "page-1", slug: "o-nas", editor: "builder" }));
        }
        return makeChain(() => null);
      },
      rpc: async (name: string) => {
        if (name === "resolve_path") {
          return { data: [{ page_id: "page-1", post_id: null }], error: null };
        }
        if (name === "get_entity_content") {
          return {
            data: [
              {
                content_pl: null,
                content_en: null,
                builder_data: state.builderData,
                blocks_data: null,
              },
            ],
            error: null,
          };
        }
        return { data: [], error: null };
      },
    },
  };
});

import { fetchGatedBody, resolvedContentQueryOptions } from "@/lib/queries/public";
import { clearEdgeTtlCache } from "@/lib/ssrCache";

/** Sekcja jawna + sekcja bramkowana „tylko dla zalogowanych". */
function docWithGatedSection(): unknown {
  return {
    version: 1,
    sections: [
      {
        id: "s-public",
        kind: "section",
        children: [
          {
            id: "c1",
            kind: "column",
            children: [
              { id: "w1", kind: "widget", type: "text", content: { text: "tresc publiczna" } },
            ],
          },
        ],
      },
      {
        id: "s-members",
        kind: "section",
        advanced: { access: { auth: "user" } },
        children: [
          {
            id: "c2",
            kind: "column",
            children: [
              { id: "w2", kind: "widget", type: "text", content: { text: SECRET } },
              {
                id: "w3",
                kind: "widget",
                type: "text",
                content: { text: "cennik dla czlonkow" },
              },
            ],
          },
        ],
      },
    ],
  };
}

beforeEach(() => {
  clearEdgeTtlCache();
  state.host = "tenant-a.example";
  state.builderData = docWithGatedSection();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("publiczny loader - strip bramek buildera na serwerze", () => {
  it("payload gościa nie zawiera zabramkowanej sekcji", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const resolved = await client.fetchQuery(resolvedContentQueryOptions(["o-nas"]));

    const serialized = JSON.stringify(resolved);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain("cennik dla czlonkow");
    expect(serialized).not.toContain("s-members");
    // Regresja odwrotna: strip nie może zjeść treści publicznej.
    expect(serialized).toContain("tresc publiczna");
  });

  it("zapis w cache SSR też jest już zestripowany", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await client.fetchQuery(resolvedContentQueryOptions(["o-nas"]));
    // Drugie żądanie tej samej ścieżki jest obsłużone z edgeTtlCache (świeży
    // QueryClient = brak cache'u react-query), więc czyta zapisaną projekcję.
    const cached = await new QueryClient({
      defaultOptions: { queries: { retry: false } },
    }).fetchQuery(resolvedContentQueryOptions(["o-nas"]));
    expect(JSON.stringify(cached)).not.toContain(SECRET);
  });

  it("dokument bez bramek przechodzi bez zmian", async () => {
    state.builderData = { version: 1, sections: [{ id: "s1", kind: "section", children: [] }] };
    const body = await fetchGatedBody("page", "page-1");
    expect(body.builder_data).toBe(state.builderData);
  });

  it("w przeglądarce body zostaje nietknięte - kontekst zna dopiero renderer", async () => {
    // Ta sama funkcja biegnie po hydracji z PRAWDZIWĄ sesją odwiedzającego;
    // strip gościnny odebrałby tam zalogowanemu treść, do której ma prawo.
    vi.stubGlobal("window", {});
    const body = await fetchGatedBody("page", "page-1");
    expect(JSON.stringify(body.builder_data)).toContain(SECRET);
  });
});
