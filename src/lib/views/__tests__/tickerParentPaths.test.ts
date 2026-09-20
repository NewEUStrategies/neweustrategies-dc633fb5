// Pasek nagłówka: ile POŁĄCZEŃ kosztuje rozwiązanie adresów wpisów.
//
// PO CO TEN PLIK ISTNIEJE. `getTrendingPosts` / `getTickerPosts` liczą się na
// zimnym otwarciu podwójnie: pasek jest częścią chrome, więc leci w t0 fali 1
// razem z menu i ustawieniami, a Worker ma tylko sześć równoległych gniazd
// wychodzących. Do 20.09.2026 `resolveParentPaths` wołało `page_full_path`
// OSOBNO DLA KAŻDEGO unikalnego rodzica - deduplikacja zbijała N wpisów do
// liczby rodziców, ale to nadal był N+1 i nadal N gniazd. Batch
// `page_full_paths(uuid[])` (ten sam wzorzec co `lib/queries/archives.ts`)
// zamyka to w jednym wywołaniu.
//
// CO JEST TU DOWODZONE:
//   1. LICZBA WYWOŁAŃ. Lista o kilku różnych rodzicach płaci JEDNO wywołanie
//      batcha, a stara funkcja pojedyncza nie jest wołana ani raz. To jedyna
//      forma, w jakiej „koniec N+1" da się w ogóle dowieść.
//   2. KSZTAŁT ADRESU SIĘ NIE ZMIENIŁ - ani przy sukcesie, ani przy awarii
//      (adres zapasowy `/post/<slug>`), ani dla wpisu bez rodzica.
//   3. CACHE ZOSTAŁ. Zmiana dotyczy liczby round-tripów, nie okna świeżości:
//      klucz nadal rozróżnia warianty paska, a TTL to nadal 60 s.
//
// CZEGO NIE UDAJE: RLS i treści funkcji SQL (to pgTAP), renderu paska (to
// testy komponentów) oraz tożsamości klienta anon - to `postViewsClientReuse`.
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { SupabaseFromStub } from "@/test/supabaseChain";
import type { SupabaseRpcStub } from "@/test/supabase/rpc";

const h = vi.hoisted(() => ({
  from: null as SupabaseFromStub | null,
  rpc: null as SupabaseRpcStub | null,
  /** Klucze i TTL przekazane do `edgeTtlCache` - kontrakt cache'u paska. */
  cache: [] as Array<{ key: string; ttl: number }>,
}));

vi.mock("@supabase/supabase-js", async () => {
  const { supabaseFromStub } = await import("@/test/supabase/chain");
  const { supabaseRpcStub } = await import("@/test/supabase/rpc");
  const from = supabaseFromStub();
  const rpc = supabaseRpcStub();
  h.from = from;
  h.rpc = rpc;
  return { createClient: () => ({ from: from.from, rpc: rpc.rpc }) };
});

// Cache przechodzi na wylot, ale ZAPISUJE, o co go poproszono. W środowisku
// happy-dom prawdziwy `edgeTtlCache` i tak degraduje do wywołania fetchera
// (`typeof window !== "undefined"`), więc atrapa niczego nie zasłania - dokłada
// tylko możliwość asercji na kluczu i oknie świeżości.
vi.mock("@/lib/ssrCache", () => ({
  edgeTtlCache: <T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> => {
    h.cache.push({ key, ttl });
    return fetcher();
  },
}));

vi.mock("@tanstack/react-start", async () => {
  const { serverFnStubModule } = await import("@/test/serverFnHarness");
  return serverFnStubModule();
});

const { ok, fail } = await import("@/test/supabaseChain");
const { getTickerPosts, getTrendingPosts } = await import("../postViews.functions");
const { callServerFn } = await import("@/test/serverFnHarness");
import type { TrendingPost } from "../postViews.functions";

function baza(): SupabaseFromStub {
  if (!h.from) throw new Error("test: atrapa łańcucha Supabase nie została podpięta");
  return h.from;
}

function funkcje(): SupabaseRpcStub {
  if (!h.rpc) throw new Error("test: atrapa RPC Supabase nie została podpięta");
  return h.rpc;
}

const STRONA_A = "aaaaaaaa-0000-0000-0000-000000000001";
const STRONA_B = "bbbbbbbb-0000-0000-0000-000000000002";

function wpis(id: string, rodzic: string): Record<string, unknown> {
  return {
    id,
    slug: `slug-${id}`,
    title_pl: `Tytuł ${id}`,
    title_en: `Title ${id}`,
    cover_image_url: null,
    published_at: "2026-09-01T00:00:00.000Z",
    parent_page_id: rodzic,
    views_count: 7,
  };
}

/** Wiersze batcha wyprowadzone z przekazanych `_page_ids` - atrapa odpowiada
 *  na to, o co kod naprawdę zapytał, a nie na sztywną listę. */
function planujSciezki(sciezka: (id: string) => string | null): void {
  funkcje().setResponse("page_full_paths", (call) => {
    const ids = call.arg("_page_ids");
    if (!Array.isArray(ids)) throw new Error("test: batch ścieżek dostał argument bez tablicy id");
    return ok(ids.map((id) => ({ page_id: String(id), full_path: sciezka(String(id)) })));
  });
}

function trending(days = 7, limit = 10): Promise<TrendingPost[]> {
  return callServerFn<TrendingPost[]>(getTrendingPosts, {
    data: { days, limit },
    context: { supabase: null },
  });
}

beforeEach(() => {
  baza().reset();
  funkcje().reset();
  h.cache = [];
  process.env.SUPABASE_URL = "https://db.example.test";
  process.env.SUPABASE_PUBLISHABLE_KEY = "anon-klucz-testowy";
  // Autorzy paska to osobne RPC i osobna sprawa - tutaj mają tylko nie psuć
  // przypadku, więc odpowiadają pustą listą.
  funkcje().setResponse("get_post_refs", ok([]));
});

describe("trending: adresy wpisów jednym wywołaniem batcha", () => {
  it("RÓŻNI rodzice mieszczą się w JEDNYM wywołaniu `page_full_paths`", async () => {
    funkcje().setResponse(
      "trending_posts",
      ok([wpis("w-1", STRONA_A), wpis("w-2", STRONA_B), wpis("w-3", STRONA_A)]),
    );
    planujSciezki((id) => (id === STRONA_A ? "analizy" : "raporty/energia"));

    const lista = await trending();

    expect(funkcje().callsFor("page_full_paths")).toHaveLength(1);
    expect(funkcje().lastCall("page_full_paths")!.keys()).toEqual(["_page_ids"]);
    // Deduplikacja po rodzicu ZOSTAJE - batch dostaje tylko unikaty.
    expect(funkcje().lastCall("page_full_paths")!.arg("_page_ids")).toEqual([STRONA_A, STRONA_B]);
    // Stara funkcja pojedyncza nie może już zostać wywołana ani raz.
    expect(funkcje().callsFor("page_full_path")).toHaveLength(0);
    expect(lista.map((p) => p.href)).toEqual([
      "/analizy/slug-w-1",
      "/raporty/energia/slug-w-2",
      "/analizy/slug-w-3",
    ]);
  });

  it("AWARIA batcha nie wywraca paska - zostaje adres zapasowy `/post/<slug>`", async () => {
    // Pasek jest częścią chrome: wyjątek albo pusty adres to widoczna dziura
    // w nagłówku, a nie „brak jednej ścieżki".
    funkcje().setResponse("trending_posts", ok([wpis("w-1", STRONA_A)]));
    funkcje().setResponse("page_full_paths", fail("permission denied", "42501"));
    const cichy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const lista = await trending();

    expect(lista.map((p) => p.href)).toEqual(["/post/slug-w-1"]);
    expect(cichy).toHaveBeenCalled();
    cichy.mockRestore();
  });

  it("rodzic, którego batch nie rozwiązał, też schodzi na adres zapasowy", async () => {
    // `page_full_paths` pomija id, których nie da się rozwiązać (usunięta
    // strona-rodzic) - to normalna odpowiedź, nie awaria.
    funkcje().setResponse("trending_posts", ok([wpis("w-1", STRONA_A)]));
    funkcje().setResponse("page_full_paths", ok([]));

    expect((await trending()).map((p) => p.href)).toEqual(["/post/slug-w-1"]);
  });

  it("pusta lista wpisów nie woła rezolucji ścieżek w ogóle", async () => {
    funkcje().setResponse("trending_posts", ok([]));
    expect(await trending()).toEqual([]);
    expect(funkcje().callsFor("page_full_paths")).toHaveLength(0);
  });

  it("odmowa `trending_posts` daje pusty pasek i ZERO dalszych round-tripów", async () => {
    funkcje().setResponse("trending_posts", fail("statement timeout"));
    const cichy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await trending()).toEqual([]);
    expect(funkcje().callsFor("page_full_paths")).toHaveLength(0);
    cichy.mockRestore();
  });
});

describe("ticker (źródło `latest`): ten sam batch", () => {
  it("lista najnowszych wpisów płaci JEDNO wywołanie `page_full_paths`", async () => {
    baza().setResponse("posts", ok([wpis("w-1", STRONA_A), wpis("w-2", STRONA_B)]));
    planujSciezki(() => "aktualnosci");

    const lista = await callServerFn<TrendingPost[]>(getTickerPosts, {
      data: { source: "latest", limit: 8 },
      context: { supabase: null },
    });

    expect(funkcje().callsFor("page_full_paths")).toHaveLength(1);
    expect(funkcje().lastCall("page_full_paths")!.arg("_page_ids")).toEqual([STRONA_A, STRONA_B]);
    expect(lista.map((p) => p.href)).toEqual(["/aktualnosci/slug-w-1", "/aktualnosci/slug-w-2"]);
  });
});

describe("cache paska: zmieniła się liczba połączeń, nie okno świeżości", () => {
  it("trending trzyma klucz z wariantem i 60 s świeżości", async () => {
    funkcje().setResponse("trending_posts", ok([]));
    await trending(14, 5);
    expect(h.cache).toEqual([{ key: "trending_posts:14:5", ttl: 60_000 }]);
  });

  it("ticker trzyma WŁASNY klucz - inne źródło to inny wpis w cache", async () => {
    baza().setResponse("posts", ok([]));
    await callServerFn<TrendingPost[]>(getTickerPosts, {
      data: { source: "latest", limit: 8 },
      context: { supabase: null },
    });
    expect(h.cache).toHaveLength(1);
    expect(h.cache[0].key).toMatch(/^ticker_posts:latest:8:/);
    expect(h.cache[0].ttl).toBe(60_000);
  });
});
