// TRZY NARZĘDZIA PUBLICZNEGO /mcp: `search_posts`, `get_post`, `list_recent_posts`.
//
// PO CO TEN PLIK ISTNIEJE. To PUBLICZNE API do przeglądania treści witryny.
// Do 04.09.2026 trzy pliki narzędzi nie miały ANI JEDNEGO testu:
// `get-post.ts` 0/15 linii i 0/20 gałęzi, `search-posts.ts` 0/11 linii i 0/10
// gałęzi, `list-recent-posts.ts` 0/8 linii i 0/10 gałęzi. Razem z nimi na zerze
// stał `supabaseClient.ts`, czyli izolacja najemcy - więc ani jedna ścieżka
// odpowiedzi tego API nie wykonała się w CI ani raz.
//
// CO JEST PRZEDMIOTEM DOWODU. Kontrakt wyniku, który klient MCP odczytuje jako
// TRZY RÓŻNE światy - i pomylenie ich jest defektem widocznym dla modelu:
//   1. TRAFIENIE  -> treść + `structuredContent`, bez `isError`,
//   2. PUSTKA     -> komunikat `No published post with slug "..."` BEZ `isError`
//                    (`get-post.ts`:31-33). „Nie ma takiego wpisu" to POPRAWNA
//                    odpowiedź, nie awaria; oznaczenie jej `isError: true`
//                    kazałoby modelowi ponawiać albo eskalować,
//   3. BŁĄD       -> `isError: true` (backend nieskonfigurowany albo błąd
//                    PostgREST) i komunikat, po którym rozpoznaje się przyczynę.
//
// CIAŁO TREŚCI IDZIE WYŁĄCZNIE PRZEZ RPC `get_entity_content` i to jest
// osobny, przypięty tu kontrakt (`get-post.ts`:35-42). Kolumny treści są
// odebrane rolom anonimowym, a bramkowana funkcja SECURITY DEFINER przelicza
// najemcę, publikację i dostęp - i dla wpisu PŁATNEGO oddaje `null`. Wynik
// `body: null` przy poprawnych metadanych jest POPRAWNY dla wołającego
// anonimowego. Ten plik przypina to jawnie, żeby nikt nie „naprawił" pustego
// ciała, dokładając `content_pl`/`content_en` do `select` - taka „naprawa"
// obeszłaby całą bramkę treści płatnej.
//
// FILTR RLS NIE JEST DUBLOWANY I TO JEST ZAMIERZONE. Narzędzia filtrują
// wyłącznie `published_at` (nie null, `<=` teraz). Brak filtra `status`
// i `deleted_at` WYGLĄDA na dziurę, ale nie jest: polityka RLS dla roli `anon`
// na `public.posts` (migracja `20260625160054`) brzmi
// `status = 'published' AND deleted_at IS NULL AND tenant_id =
// public.public_tenant_id()`. Filtr po stronie klienta byłby obroną
// NADMIAROWĄ - i, co ważniejsze, przeniósłby regułę widoczności do warstwy,
// która może ją pominąć. Dlatego brak tych filtrów jest tu ASERTOWANY WPROST:
// jeżeli ktoś je dołoży, ma najpierw przeczytać ten komentarz.
//
// GRANICE, KTÓRE ATRAPUJEMY, I DLACZEGO:
//   * `@supabase/supabase-js` - `createClient` oddaje atrapę łańcucha PostgREST
//     (`@/test/supabaseChain`) plus szpiega `rpc`. Bez sieci i bez bazy,
//     a łańcuch ZAPISUJE ogniwa, więc filtry są przedmiotem asercji,
//   * `@/lib/http/requestHost` - sąsiedni moduł z własnym zleceniem; atrapa
//     podaje host najemcy.
// PRAWDZIWE zostają: `@lovable.dev/mcp-js`, wszystkie trzy narzędzia
// i `mcpSupabase()`.
//
// DLACZEGO PRAWDZIWY `@lovable.dev/mcp-js`, A NIE ATRAPA `defineTool`.
// SPRAWDZONE W PAKIECIE (`dist/index.js`): `defineTool` jest funkcją
// TOŻSAMOŚCIOWĄ - `function defineTool(def) { return def; }`. Nie rejestruje
// nic, nie owija handlera, nie waliduje schematu. Wniosek jest jednoznaczny:
// atrapa `defineTool` NIE JEST POTRZEBNA, a byłaby wręcz szkodliwa, bo eksport
// narzędzia przestałby nieść prawdziwy `handler` i plik zmierzyłby wyłącznie
// wywołanie atrapy - czyli powtórzyłby przyczynę zera z `require-staff`.
// Z prawdziwym pakietem `export default` narzędzia JEST jego definicją, więc
// `tool.handler(...)` wykonuje PRODUKCYJNE ciało. `ToolContext` też jest
// prawdziwy: handlery nie sięgają do kontekstu (narzędzia są tylko do czytania
// i publiczne), ale sygnatura wymaga drugiego argumentu, a `new
// ToolContext(undefined)` wiernie odwzorowuje wołającego BEZ tokenu.
//
// Bez sieci i bez prawdziwych sekretów: adresy w `example.com`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolContext, type ToolHandlerResult } from "@lovable.dev/mcp-js";
import type { SupabaseFromStub, RecordedChain } from "@/test/supabaseChain";
import { TENANT_HOST_HEADER } from "@/lib/http/host";

// --- atrapy granic ----------------------------------------------------------

/** Opcje `createClient`, o które toczy się dowód o izolacji najemcy. */
interface McpClientOptions {
  readonly global?: { readonly headers?: Record<string, string> };
}

/** Zapisane wywołanie RPC - `get_entity_content` jest jedyną drogą do ciała wpisu. */
interface RpcCall {
  readonly fn: string;
  readonly args: unknown;
}

const h = vi.hoisted(() => ({
  db: null as SupabaseFromStub | null,
  rpcCalls: [] as RpcCall[],
  rpcResult: { data: null as unknown, error: null as unknown },
  clientOptions: [] as unknown[],
  host: "pl.example.com" as string | null,
}));

vi.mock("@supabase/supabase-js", async () => {
  const { supabaseFromStub } = await import("@/test/supabaseChain");
  h.db = supabaseFromStub();
  return {
    createClient: (_url: string, _key: string, options: McpClientOptions) => {
      h.clientOptions.push(options);
      return {
        from: (table: string) => h.db!.from(table),
        rpc: (fn: string, args: unknown) => {
          h.rpcCalls.push({ fn, args });
          return Promise.resolve(h.rpcResult);
        },
      };
    },
  };
});

vi.mock("@/lib/http/requestHost", () => ({
  currentTenantHost: () => Promise.resolve(h.host),
}));

import searchPosts from "@/lib/mcp/tools/search-posts";
import getPost from "@/lib/mcp/tools/get-post";
import listRecentPosts from "@/lib/mcp/tools/list-recent-posts";
import { ok, fail } from "@/test/supabaseChain";

// --- pomocnicy --------------------------------------------------------------

/** Wołający BEZ tokenu - dokładnie tak, jak anonimowy klient publicznego /mcp. */
const anon = new ToolContext(undefined);

/** Zegar zamrożony: `.lte("published_at", ...)` liczy się od „teraz". */
const NOW = new Date("2026-09-04T12:00:00.000Z");

/**
 * Blok tekstowy wyniku. STRAŻNIK, nie rzutowanie: `ContentBlock` jest unią
 * pięciu kształtów, a warunek sprawdza w runtime, że dostaliśmy tekst.
 * Wyjątek zamiast `undefined`, bo test „przechodzący" na braku treści nie
 * dowodziłby niczego o odpowiedzi narzędzia.
 */
function textOf(result: ToolHandlerResult): string {
  const block = result.content?.[0];
  if (!block || block.type !== "text") {
    throw new Error("test: wynik narzędzia nie ma bloku tekstowego na pierwszej pozycji");
  }
  return block.text;
}

/** Wynik narzędzia sparsowany z bloku tekstowego - dowód, że tekst i dane się zgadzają. */
function jsonOf(result: ToolHandlerResult): unknown {
  return JSON.parse(textOf(result));
}

/** Ostatni łańcuch na tabeli `posts`, z twardym błędem, gdy zapytania nie było. */
function postsChain(): RecordedChain {
  const chain = h.db!.lastChain("posts");
  if (!chain) throw new Error("test: narzędzie nie zapytało tabeli `posts`");
  return chain;
}

/** Lista kolumn z `select(...)` jako pojedynczy ciąg - do asercji o kolumnie językowej. */
function selectedColumns(): string {
  const args = postsChain().argsOf("select");
  if (typeof args?.[0] !== "string") throw new Error("test: brak `select(...)` w łańcuchu");
  return args[0];
}

/** Pierwszy argument ogniwa jako ciąg - zawężenie w jednym miejscu, bez rzutowań. */
function stringArg(chain: RecordedChain, method: string, index = 0): string {
  const value = chain.argsOf(method)?.[index];
  if (typeof value !== "string") {
    throw new Error(`test: ogniwo \`${method}\` nie dostało ciągu na pozycji ${index}`);
  }
  return value;
}

function postRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    slug: "traktat-o-cle",
    title_pl: "Traktat o cle",
    title_en: "Treaty on tariffs",
    excerpt_pl: "Skrót po polsku",
    excerpt_en: "Excerpt in English",
    cover_image_url: "https://cdn.example.com/cover.jpg",
    published_at: "2026-08-01T10:00:00.000Z",
    post_format: "standard",
    ...over,
  };
}

/** Backend skonfigurowany - punkt wyjścia każdej ścieżki poza „Backend not configured". */
function configureBackend(): void {
  vi.stubEnv("SUPABASE_URL", "https://db.example.com");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "publishable-key-testowy");
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  h.db!.reset();
  h.rpcCalls.length = 0;
  h.rpcResult = { data: null, error: null };
  h.clientOptions.length = 0;
  h.host = "pl.example.com";
  vi.unstubAllEnvs();
  configureBackend();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

// ============================================================================
// get_post
// ============================================================================

describe("get_post - trafienie", () => {
  it("oddaje metadane wpisu razem z ciałem z RPC", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResult = { data: [{ content_pl: "Ciało PL", content_en: "Body EN" }], error: null };

    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      post: {
        slug: "traktat-o-cle",
        title: "Traktat o cle",
        excerpt: "Skrót po polsku",
        cover_image_url: "https://cdn.example.com/cover.jpg",
        published_at: "2026-08-01T10:00:00.000Z",
        post_format: "standard",
        body: "Ciało PL",
      },
    });
  });

  // Blok tekstowy i `structuredContent` to DWIE reprezentacje tej samej
  // odpowiedzi: część klientów MCP czyta wyłącznie tekst. Rozjazd między nimi
  // byłby niewidoczny w teście patrzącym tylko na jedną z nich.
  it("blok tekstowy niesie DOKŁADNIE ten sam wpis co structuredContent", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResult = { data: [{ content_pl: "Ciało PL", content_en: null }], error: null };

    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(jsonOf(result)).toEqual(result.structuredContent?.post);
  });

  it("nie ustawia identyfikatora wpisu w odpowiedzi - `id` jest wewnętrzny", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResult = { data: [{ content_pl: "Ciało PL", content_en: null }], error: null };

    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(Object.keys(jsonOf(result) as Record<string, unknown>).sort()).toEqual([
      "body",
      "cover_image_url",
      "excerpt",
      "post_format",
      "published_at",
      "slug",
      "title",
    ]);
  });
});

describe("get_post - wybór kolumny językowej", () => {
  it("lang 'en' czyta title_en i excerpt_en", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResult = { data: [{ content_pl: "Ciało PL", content_en: "Body EN" }], error: null };

    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "en" }, anon);

    expect(result.structuredContent?.post).toMatchObject({
      title: "Treaty on tariffs",
      excerpt: "Excerpt in English",
      body: "Body EN",
    });
  });

  it("lang 'pl' czyta title_pl i excerpt_pl", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResult = { data: [{ content_pl: "Ciało PL", content_en: "Body EN" }], error: null };

    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(result.structuredContent?.post).toMatchObject({
      title: "Traktat o cle",
      excerpt: "Skrót po polsku",
      body: "Ciało PL",
    });
  });

  // Kolumna językowa wchodzi do `select` przez interpolację ciągu, więc dowód
  // musi patrzeć na WYSŁANE zapytanie, nie tylko na zmapowany wynik: zły
  // `select` oddałby `undefined` w tytule, a nie błąd.
  it("prosi bazę o kolumny w wybranym języku, i tylko o nie", async () => {
    h.db!.setResponse("posts", ok(postRow()));

    await getPost.handler({ slug: "traktat-o-cle", lang: "en" }, anon);
    const en = selectedColumns();
    h.db!.reset();
    h.db!.setResponse("posts", ok(postRow()));
    await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);
    const pl = selectedColumns();

    expect(en).toContain("title_en");
    expect(en).toContain("excerpt_en");
    expect(en).not.toContain("title_pl");
    expect(pl).toContain("title_pl");
    expect(pl).toContain("excerpt_pl");
    expect(pl).not.toContain("title_en");
  });

  // `en` z brakującym tłumaczeniem MA oddać wersję polską, a nie pustkę:
  // wpis jest opublikowany, więc odpowiedź „brak treści" byłaby regresją
  // widoczną dla czytelnika, nie błędem technicznym.
  it("brak ciała EN spada na ciało PL", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResult = { data: [{ content_pl: "Ciało PL", content_en: null }], error: null };

    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "en" }, anon);

    expect(result.structuredContent?.post).toMatchObject({ body: "Ciało PL" });
  });

  it("brak ciała PL spada na ciało EN", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResult = { data: [{ content_pl: null, content_en: "Body EN" }], error: null };

    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(result.structuredContent?.post).toMatchObject({ body: "Body EN" });
  });
});

describe("get_post - ciało treści WYŁĄCZNIE przez bramkowane RPC", () => {
  // Kolumny treści są odebrane rolom anonimowym. Gdyby ktoś dołożył je do
  // `select`, obszedłby bramkę treści płatnej - dlatego to jest asercja
  // NEGATYWNA na wysłanym zapytaniu, nie tylko na wyniku.
  it("nie prosi bazy o kolumny treści w zapytaniu metadanych", async () => {
    h.db!.setResponse("posts", ok(postRow()));

    await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(selectedColumns()).not.toContain("content_pl");
    expect(selectedColumns()).not.toContain("content_en");
  });

  it("woła DOKŁADNIE jedno RPC get_entity_content z typem i identyfikatorem wpisu", async () => {
    const row = postRow();
    h.db!.setResponse("posts", ok(row));

    await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(h.rpcCalls).toHaveLength(1);
    expect(h.rpcCalls[0]).toEqual({
      fn: "get_entity_content",
      args: { _entity_type: "post", _entity_id: row.id },
    });
  });

  // TO JEST KONTRAKT WPISU PŁATNEGO, nie defekt. RPC (SECURITY DEFINER)
  // przelicza najemcę, publikację i dostęp; dla wołającego anonimowego oddaje
  // ciało `null`. Poprawną odpowiedzią są metadane BEZ ciała i BEZ `isError` -
  // model dostaje tytuł i skrót, a treść zostaje za bramką.
  it("wpis płatny: ciało null, metadane obecne, BEZ isError", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResult = { data: [{ content_pl: null, content_en: null }], error: null };

    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.post).toMatchObject({
      slug: "traktat-o-cle",
      title: "Traktat o cle",
      body: null,
    });
  });

  // Ten sam wpis płatny pytany po ANGIELSKU. Nie jest to powtórzenie
  // przypadku wyżej: gałąź językowa ma WŁASNY łańcuch awaryjny
  // (`content_en ?? content_pl ?? null`, :48), więc bramka treści płatnej musi
  // domknąć się w OBU językach. Gdyby zamykała się tylko po polsku, wersja
  // angielska wypuszczałaby treść zza bramki.
  it("wpis płatny pytany po angielsku: ciało też null", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResult = { data: [{ content_pl: null, content_en: null }], error: null };

    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "en" }, anon);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.post).toMatchObject({
      slug: "traktat-o-cle",
      title: "Treaty on tariffs",
      body: null,
    });
  });

  it("RPC bez wierszy: ciało null, odpowiedź nadal poprawna", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResult = { data: [], error: null };

    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.post).toMatchObject({ body: null });
  });

  // Gałąź `Array.isArray(bodyRows)` (:43): RPC potrafi oddać `null` zamiast
  // tablicy. Bez tego strażnika handler poleciałby na `bodyRows[0]`.
  it("RPC oddające null zamiast tablicy: ciało null, bez wyjątku", async () => {
    h.db!.setResponse("posts", ok(postRow()));
    h.rpcResult = { data: null, error: null };

    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent?.post).toMatchObject({ body: null });
  });
});

describe("get_post - pustka nie jest błędem", () => {
  // NAJWAŻNIEJSZE ROZRÓŻNIENIE W KONTRAKCIE WYNIKU. `isError: true` na braku
  // wpisu kazałoby modelowi traktować odpowiedź jako awarię - ponawiać,
  // eskalować albo zgłaszać użytkownikowi błąd systemu zamiast „nie ma takiego
  // artykułu".
  it("brak wpisu oddaje komunikat BEZ isError", async () => {
    h.db!.setResponse("posts", ok(null));

    const result = await getPost.handler({ slug: "nie-ma-takiego", lang: "pl" }, anon);

    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toBe('No published post with slug "nie-ma-takiego"');
  });

  it("brak wpisu nie oddaje structuredContent", async () => {
    h.db!.setResponse("posts", ok(null));

    const result = await getPost.handler({ slug: "nie-ma-takiego", lang: "pl" }, anon);

    expect(result.structuredContent).toBeUndefined();
  });

  // Bez wiersza nie ma identyfikatora, więc RPC nie ma czego pytać. Wywołanie
  // z `undefined` przeszłoby przez atrapę cicho, a w produkcji byłoby błędem
  // typu argumentu po stronie Postgresa.
  it("brak wpisu NIE woła RPC o ciało", async () => {
    h.db!.setResponse("posts", ok(null));

    await getPost.handler({ slug: "nie-ma-takiego", lang: "pl" }, anon);

    expect(h.rpcCalls).toHaveLength(0);
  });

  it("komunikat pustki niesie pytany slug, nie ogólnik", async () => {
    h.db!.setResponse("posts", ok(null));

    const result = await getPost.handler({ slug: "inny-slug-2026", lang: "en" }, anon);

    expect(textOf(result)).toContain("inny-slug-2026");
  });
});

describe("get_post - ścieżki błędu", () => {
  it("błąd PostgREST oddaje isError i komunikat bazy", async () => {
    h.db!.setResponse("posts", fail("permission denied for table posts", "42501"));

    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("permission denied for table posts");
  });

  it("błąd metadanych NIE idzie dalej po ciało", async () => {
    h.db!.setResponse("posts", fail("permission denied for table posts", "42501"));

    await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(h.rpcCalls).toHaveLength(0);
  });

  // Brak konfiguracji backendu MUSI dać czytelną odmowę PRZED zapytaniem:
  // klient zbudowany bez klucza oddałby surowy błąd PostgREST, po którym nie da
  // się rozpoznać, że to wdrożenie jest niedokonfigurowane.
  it("brak konfiguracji backendu: Backend not configured z isError", async () => {
    vi.stubEnv("SUPABASE_URL", undefined);

    const result = await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Backend not configured");
  });

  it("brak konfiguracji backendu nie dotyka bazy ani RPC", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", undefined);

    await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(h.db!.chains).toHaveLength(0);
    expect(h.rpcCalls).toHaveLength(0);
  });
});

describe("get_post - filtry zapytania", () => {
  it("szuka po slug i zamyka wynik na jednym wierszu", async () => {
    h.db!.setResponse("posts", ok(postRow()));

    await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(postsChain().argsOf("eq")).toEqual(["slug", "traktat-o-cle"]);
    expect(postsChain().has("maybeSingle")).toBe(true);
  });

  // Dwa warunki publikacji, nie jeden: wpis z `published_at` w PRZYSZŁOŚCI jest
  // zaplanowany, nie opublikowany. Bez ogniwa `.lte` publiczne API wyciekałoby
  // embarga wydawnicze.
  it("wymaga published_at niepustego i nie z przyszłości", async () => {
    h.db!.setResponse("posts", ok(postRow()));

    await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(postsChain().argsOf("not")).toEqual(["published_at", "is", null]);
    expect(postsChain().argsOf("lte")).toEqual(["published_at", NOW.toISOString()]);
  });

  it("czyta tylko tabelę posts", async () => {
    h.db!.setResponse("posts", ok(postRow()));

    await getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon);

    expect(h.db!.chains.map((c) => c.table)).toEqual(["posts"]);
  });
});

// ============================================================================
// search_posts
// ============================================================================

describe("search_posts - trafienie i kształt wyniku", () => {
  it("mapuje wiersze na slug, tytuł, skrót, okładkę i datę", async () => {
    h.db!.setResponse("posts", ok([postRow(), postRow({ slug: "drugi", title_pl: "Drugi" })]));

    const result = await searchPosts.handler({ query: "cło", lang: "pl", limit: 10 }, anon);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      results: [
        {
          slug: "traktat-o-cle",
          title: "Traktat o cle",
          excerpt: "Skrót po polsku",
          cover_image_url: "https://cdn.example.com/cover.jpg",
          published_at: "2026-08-01T10:00:00.000Z",
        },
        {
          slug: "drugi",
          title: "Drugi",
          excerpt: "Skrót po polsku",
          cover_image_url: "https://cdn.example.com/cover.jpg",
          published_at: "2026-08-01T10:00:00.000Z",
        },
      ],
    });
  });

  // Wyszukiwanie pobiera `id`, żeby zapytanie było spójne z `get_post`, ale
  // identyfikatora NIE wypuszcza. Mapowanie jest jawnym filtrem pól i jego
  // zniknięcie (np. „uproszczenie" do `data`) wypuściłoby `id` na zewnątrz.
  it("nie wypuszcza identyfikatora wpisu", async () => {
    h.db!.setResponse("posts", ok([postRow()]));

    const result = await searchPosts.handler({ query: "cło", lang: "pl", limit: 10 }, anon);

    expect(Object.keys((jsonOf(result) as Record<string, unknown>[])[0]).sort()).toEqual([
      "cover_image_url",
      "excerpt",
      "published_at",
      "slug",
      "title",
    ]);
  });

  it("blok tekstowy niesie te same wiersze co structuredContent", async () => {
    h.db!.setResponse("posts", ok([postRow()]));

    const result = await searchPosts.handler({ query: "cło", lang: "pl", limit: 10 }, anon);

    expect(jsonOf(result)).toEqual(result.structuredContent?.results);
  });

  it("brak wyników to pusta lista, nie błąd", async () => {
    h.db!.setResponse("posts", ok([]));

    const result = await searchPosts.handler({ query: "nic", lang: "pl", limit: 10 }, anon);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ results: [] });
  });

  // Gałąź `data ?? []` (:38): PostgREST potrafi oddać `null` zamiast tablicy.
  // Bez tego strażnika handler poleciałby na `.map` po `null`.
  it("data null to pusta lista, nie wyjątek", async () => {
    h.db!.setResponse("posts", ok(null));

    const result = await searchPosts.handler({ query: "nic", lang: "pl", limit: 10 }, anon);

    expect(result.structuredContent).toEqual({ results: [] });
    expect(textOf(result)).toBe("[]");
  });
});

describe("search_posts - kolumna językowa w zapytaniu i w wyniku", () => {
  it("lang 'en' szuka w title_en i excerpt_en", async () => {
    h.db!.setResponse("posts", ok([postRow()]));

    const result = await searchPosts.handler({ query: "tariff", lang: "en", limit: 10 }, anon);

    expect(stringArg(postsChain(), "or")).toBe("title_en.ilike.%tariff%,excerpt_en.ilike.%tariff%");
    expect(result.structuredContent).toEqual({
      results: [
        expect.objectContaining({ title: "Treaty on tariffs", excerpt: "Excerpt in English" }),
      ],
    });
  });

  it("lang 'pl' szuka w title_pl i excerpt_pl", async () => {
    h.db!.setResponse("posts", ok([postRow()]));

    await searchPosts.handler({ query: "cło", lang: "pl", limit: 10 }, anon);

    expect(stringArg(postsChain(), "or")).toBe("title_pl.ilike.%cło%,excerpt_pl.ilike.%cło%");
  });

  it("szuka w kolumnie, którą też oddaje - bez rozjazdu języka", async () => {
    h.db!.setResponse("posts", ok([postRow()]));

    await searchPosts.handler({ query: "tariff", lang: "en", limit: 10 }, anon);

    expect(selectedColumns()).toContain("title_en");
    expect(stringArg(postsChain(), "or")).toContain("title_en");
  });
});

describe("search_posts - odkażanie frazy przed wejściem do .or()", () => {
  // FRAZA JEST WEJŚCIEM WOŁAJĄCEGO i wchodzi do `.or()`, gdzie PRZECINEK
  // rozdziela filtry, NAWIASY grupują, a CUDZYSŁÓW cytuje. Bez usunięcia tych
  // znaków wołający dopisałby własny warunek do zapytania - dlatego to jest
  // dowód o BEZPIECZEŃSTWIE zapytania, nie o wygodzie szukania.
  it("usuwa metaznaki .or() i wieloznaczniki LIKE", async () => {
    h.db!.setResponse("posts", ok([]));

    await searchPosts.handler({ query: 'cło,50%_(x)"y\\z', lang: "pl", limit: 10 }, anon);

    expect(stringArg(postsChain(), "or")).toBe(
      "title_pl.ilike.%cło50xyz%,excerpt_pl.ilike.%cło50xyz%",
    );
  });

  it("fraza próbująca dopisać własny filtr nie tworzy trzeciego warunku", async () => {
    h.db!.setResponse("posts", ok([]));

    await searchPosts.handler({ query: "cło,status.eq.draft", lang: "pl", limit: 10 }, anon);

    // Dwa warunki = jeden przecinek rozdzielający. Trzeci warunek oznaczałby
    // udane wstrzyknięcie.
    const or = stringArg(postsChain(), "or");
    expect(or.split(",")).toHaveLength(2);
    expect(or).toBe("title_pl.ilike.%cłostatus.eq.draft%,excerpt_pl.ilike.%cłostatus.eq.draft%");
  });

  it("fraza z samych metaznaków daje wzorzec dopasowujący wszystko, a nie błąd", async () => {
    h.db!.setResponse("posts", ok([]));

    const result = await searchPosts.handler({ query: '%_,()"', lang: "pl", limit: 10 }, anon);

    expect(result.isError).toBeUndefined();
    expect(stringArg(postsChain(), "or")).toBe("title_pl.ilike.%%,excerpt_pl.ilike.%%");
  });

  it("zostawia znaki diakrytyczne i spacje - odkażanie nie kaleczy fraz polskich", async () => {
    h.db!.setResponse("posts", ok([]));

    await searchPosts.handler({ query: "unia celna żółć", lang: "pl", limit: 10 }, anon);

    expect(stringArg(postsChain(), "or")).toContain("%unia celna żółć%");
  });
});

describe("search_posts - filtry, kolejność i limit", () => {
  it("wymaga published_at niepustego i nie z przyszłości", async () => {
    h.db!.setResponse("posts", ok([]));

    await searchPosts.handler({ query: "cło", lang: "pl", limit: 10 }, anon);

    expect(postsChain().argsOf("not")).toEqual(["published_at", "is", null]);
    expect(postsChain().argsOf("lte")).toEqual(["published_at", NOW.toISOString()]);
  });

  it("sortuje od najnowszych", async () => {
    h.db!.setResponse("posts", ok([]));

    await searchPosts.handler({ query: "cło", lang: "pl", limit: 10 }, anon);

    expect(postsChain().argsOf("order")).toEqual(["published_at", { ascending: false }]);
  });

  it("przekazuje limit wołającego do zapytania", async () => {
    h.db!.setResponse("posts", ok([]));

    await searchPosts.handler({ query: "cło", lang: "pl", limit: 3 }, anon);

    expect(postsChain().argsOf("limit")).toEqual([3]);
  });
});

describe("search_posts - ścieżki błędu", () => {
  it("błąd PostgREST oddaje isError i komunikat bazy", async () => {
    h.db!.setResponse("posts", fail("statement timeout", "57014"));

    const result = await searchPosts.handler({ query: "cło", lang: "pl", limit: 10 }, anon);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("statement timeout");
  });

  it("brak konfiguracji backendu: Backend not configured z isError i bez zapytania", async () => {
    vi.stubEnv("SUPABASE_URL", undefined);

    const result = await searchPosts.handler({ query: "cło", lang: "pl", limit: 10 }, anon);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Backend not configured");
    expect(h.db!.chains).toHaveLength(0);
  });
});

// ============================================================================
// list_recent_posts
// ============================================================================

describe("list_recent_posts - trafienie i kształt wyniku", () => {
  // To narzędzie oddaje wiersze BEZ mapowania - dlatego `select` jest jedyną
  // bramką pól i asercja o kolumnach niżej jest tu jedynym zabezpieczeniem
  // przed wyciekiem kolumny dołożonej kiedyś do zapytania.
  it("oddaje wiersze bazy w takim kształcie, w jakim je pobrał", async () => {
    const rows = [
      {
        slug: "traktat-o-cle",
        title_pl: "Traktat o cle",
        excerpt_pl: "Skrót po polsku",
        cover_image_url: "https://cdn.example.com/cover.jpg",
        published_at: "2026-08-01T10:00:00.000Z",
      },
    ];
    h.db!.setResponse("posts", ok(rows));

    const result = await listRecentPosts.handler({ lang: "pl", limit: 10 }, anon);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ results: rows });
    expect(jsonOf(result)).toEqual(rows);
  });

  it("pusta tabela to pusta lista, nie błąd", async () => {
    h.db!.setResponse("posts", ok([]));

    const result = await listRecentPosts.handler({ lang: "pl", limit: 10 }, anon);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ results: [] });
  });

  // Gałąź `data ?? []` (:31-32) - dwa razy w jednym wyniku (tekst i dane).
  it("data null to pusta lista w OBU reprezentacjach wyniku", async () => {
    h.db!.setResponse("posts", ok(null));

    const result = await listRecentPosts.handler({ lang: "pl", limit: 10 }, anon);

    expect(textOf(result)).toBe("[]");
    expect(result.structuredContent).toEqual({ results: [] });
  });

  it("nie prosi bazy o kolumny treści", async () => {
    h.db!.setResponse("posts", ok([]));

    await listRecentPosts.handler({ lang: "pl", limit: 10 }, anon);

    expect(selectedColumns()).not.toContain("content_pl");
    expect(selectedColumns()).not.toContain("content_en");
  });
});

describe("list_recent_posts - kolumna językowa, filtry i limit", () => {
  it("lang 'en' pobiera title_en i excerpt_en", async () => {
    h.db!.setResponse("posts", ok([]));

    await listRecentPosts.handler({ lang: "en", limit: 10 }, anon);

    expect(selectedColumns()).toContain("title_en");
    expect(selectedColumns()).toContain("excerpt_en");
    expect(selectedColumns()).not.toContain("title_pl");
  });

  it("lang 'pl' pobiera title_pl i excerpt_pl", async () => {
    h.db!.setResponse("posts", ok([]));

    await listRecentPosts.handler({ lang: "pl", limit: 10 }, anon);

    expect(selectedColumns()).toContain("title_pl");
    expect(selectedColumns()).not.toContain("title_en");
  });

  it("wymaga published_at niepustego i nie z przyszłości", async () => {
    h.db!.setResponse("posts", ok([]));

    await listRecentPosts.handler({ lang: "pl", limit: 10 }, anon);

    expect(postsChain().argsOf("not")).toEqual(["published_at", "is", null]);
    expect(postsChain().argsOf("lte")).toEqual(["published_at", NOW.toISOString()]);
  });

  it("sortuje od najnowszych i przekazuje limit", async () => {
    h.db!.setResponse("posts", ok([]));

    await listRecentPosts.handler({ lang: "pl", limit: 7 }, anon);

    expect(postsChain().argsOf("order")).toEqual(["published_at", { ascending: false }]);
    expect(postsChain().argsOf("limit")).toEqual([7]);
  });
});

describe("list_recent_posts - ścieżki błędu", () => {
  it("błąd PostgREST oddaje isError i komunikat bazy", async () => {
    h.db!.setResponse("posts", fail('relation "posts" does not exist', "42P01"));

    const result = await listRecentPosts.handler({ lang: "pl", limit: 10 }, anon);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe('relation "posts" does not exist');
  });

  it("brak konfiguracji backendu: Backend not configured z isError i bez zapytania", async () => {
    vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", undefined);

    const result = await listRecentPosts.handler({ lang: "pl", limit: 10 }, anon);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe("Backend not configured");
    expect(h.db!.chains).toHaveLength(0);
  });
});

// ============================================================================
// Wspólne dla trzech narzędzi
// ============================================================================

describe("narzędzia NIE dublują filtra RLS - i to jest zamierzone", () => {
  // POLITYKA RLS DLA `anon` NA `public.posts` (migracja 20260625160054) brzmi
  // `status = 'published' AND deleted_at IS NULL AND tenant_id =
  // public.public_tenant_id()`. Narzędzia filtrują WYŁĄCZNIE `published_at`
  // i to nie jest przeoczenie: reguła widoczności mieszka w bazie, a filtr
  // klienta byłby obroną NADMIAROWĄ, która z czasem rozjeżdża się z polityką
  // i sugeruje, że to ona chroni dane. Ten opis jest tu po to, żeby następna
  // osoba nie „naprawiała" braku - i żeby dołożenie filtra było ŚWIADOMĄ
  // zmianą testu, nie cichym dopiskiem.
  const scenariusze: ReadonlyArray<{
    nazwa: string;
    // `defineTool` dopuszcza handler synchroniczny, więc typ zwrotny jest UNIĄ.
    // Zawężenie do samej obietnicy nie kompiluje się - i słusznie: `await`
    // niżej obsługuje oba warianty, a udawanie, że handler jest zawsze
    // asynchroniczny, ukryłoby zmianę kontraktu pakietu.
    run: () => ToolHandlerResult | Promise<ToolHandlerResult>;
  }> = [
    {
      nazwa: "get_post",
      run: () => getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon),
    },
    {
      nazwa: "search_posts",
      run: () => searchPosts.handler({ query: "cło", lang: "pl", limit: 10 }, anon),
    },
    {
      nazwa: "list_recent_posts",
      run: () => listRecentPosts.handler({ lang: "pl", limit: 10 }, anon),
    },
  ];

  for (const { nazwa, run } of scenariusze) {
    it(`${nazwa} nie filtruje po status ani deleted_at`, async () => {
      h.db!.setResponse("posts", ok(nazwa === "get_post" ? postRow() : []));

      await run();

      const wszystkieArgumenty = JSON.stringify(postsChain().calls);
      expect(wszystkieArgumenty).not.toContain("status");
      expect(wszystkieArgumenty).not.toContain("deleted_at");
    });

    it(`${nazwa} nie filtruje po tenant_id - najemcę rozstrzyga nagłówek`, async () => {
      h.db!.setResponse("posts", ok(nazwa === "get_post" ? postRow() : []));

      await run();

      expect(JSON.stringify(postsChain().calls)).not.toContain("tenant_id");
    });
  }
});

describe("każde narzędzie działa na kliencie oznaczonym najemcą", () => {
  // ŁĄCZNIK Z `supabaseClient.ts`: dowód, że narzędzia nie budują własnego
  // klienta obok `mcpSupabase()`. Klient BEZ nagłówka `x-tenant-host` serwuje
  // treść najemcy DOMYŚLNEGO - czyli złej strony - i robi to bez błędu.
  const scenariusze: ReadonlyArray<{
    nazwa: string;
    // `defineTool` dopuszcza handler synchroniczny, więc typ zwrotny jest UNIĄ.
    // Zawężenie do samej obietnicy nie kompiluje się - i słusznie: `await`
    // niżej obsługuje oba warianty, a udawanie, że handler jest zawsze
    // asynchroniczny, ukryłoby zmianę kontraktu pakietu.
    run: () => ToolHandlerResult | Promise<ToolHandlerResult>;
  }> = [
    {
      nazwa: "get_post",
      run: () => getPost.handler({ slug: "traktat-o-cle", lang: "pl" }, anon),
    },
    {
      nazwa: "search_posts",
      run: () => searchPosts.handler({ query: "cło", lang: "pl", limit: 10 }, anon),
    },
    {
      nazwa: "list_recent_posts",
      run: () => listRecentPosts.handler({ lang: "pl", limit: 10 }, anon),
    },
  ];

  for (const { nazwa, run } of scenariusze) {
    it(`${nazwa} niesie x-tenant-host bieżącego żądania`, async () => {
      h.host = "en.example.org";
      h.db!.setResponse("posts", ok(nazwa === "get_post" ? postRow() : []));

      await run();

      expect(h.clientOptions).toHaveLength(1);
      expect(h.clientOptions[0]).toMatchObject({
        global: { headers: { [TENANT_HOST_HEADER]: "en.example.org" } },
      });
    });
  }
});
