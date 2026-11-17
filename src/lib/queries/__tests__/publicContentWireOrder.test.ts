// Kolejność żądań rezolucji treści NA DRUCIE (przegląd B2, 2026-11-15).
//
// Atrapy `rpc`/`from` z pozostałych testów zapisują wywołanie w chwili
// zbudowania zapytania, a prawdziwy klient PostgREST wysyła je dopiero przy
// pierwszym `.then`. O tym, które żądanie zajmie wcześniejsze miejsce
// w kolejce sześciu połączeń Workera, decyduje więc wyłącznie prawdziwy
// klient - stąd ten plik używa `@supabase/supabase-js` z podglądanym `fetch`.
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const wire = vi.hoisted(() => ({ requests: [] as string[] }));

vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const recordingFetch: typeof fetch = (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    wire.requests.push(`${init?.method ?? "GET"} ${new URL(url).pathname}`);
    return Promise.resolve(
      new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
    );
  };
  return {
    supabase: createClient("https://db.test", "anon-key", {
      global: { fetch: recordingFetch },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
});

// Pamięć izolatu przezroczysta: test dotyczy fetchera, nie cache'u.
vi.mock("@/lib/ssrCache", async (o) => ({
  ...(await o<typeof import("@/lib/ssrCache")>()),
  edgeTtlCache: (_key: string, _ttlMs: number, fetcher: () => Promise<unknown>) => fetcher(),
}));

import { resolvedContentQueryOptions } from "@/lib/queries/public";

function klient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
  wire.requests = [];
});

describe("rezolucja treści - kolejność żądań na drucie", () => {
  it("`resolve_path` jest zgłaszane PRZED podpowiedzią wiersza wpisu", async () => {
    // Rezolucja bramkuje całą resztę treści, podpowiedź niczego. Gdy sufit
    // połączeń wiąże (zimny izolat: 8 podżądań na 6 połączeń), wcześniejsze
    // miejsce w kolejce musi należeć do rezolucji.
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["blog", "wpis"])),
    ).resolves.toBeNull();
    expect(wire.requests).toEqual(["POST /rest/v1/rpc/resolve_path", "GET /rest/v1/posts"]);
  });

  it("adres skanera wysyła samą rezolucję", async () => {
    await expect(
      klient().fetchQuery(resolvedContentQueryOptions(["wp-content", "readme.txt"])),
    ).resolves.toBeNull();
    expect(wire.requests).toEqual(["POST /rest/v1/rpc/resolve_path"]);
  });

  it("adres jednosegmentowy wysyła samą rezolucję", async () => {
    await expect(klient().fetchQuery(resolvedContentQueryOptions(["o-nas"]))).resolves.toBeNull();
    expect(wire.requests).toEqual(["POST /rest/v1/rpc/resolve_path"]);
  });
});
