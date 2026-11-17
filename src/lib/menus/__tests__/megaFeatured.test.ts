// Wyróżniony wpis mega menu - warstwa danych kolumny „featured".
//
// Do 18.08.2026: 15% instrukcji, 0 z 6 funkcji. To zapytanie idzie z NAGŁÓWKA
// KAŻDEJ STRONY, więc jego ścieżka błędu jest ścieżką produkcyjną, nie
// teoretyczną: wskazany wpis mógł zostać cofnięty do szkicu albo skasowany,
// a nagłówek musi wtedy pokazać cokolwiek sensownego zamiast pustej kolumny.
//
// ADRES KARTY (15.11.2026). Oba odczyty niosą stronę-rodzica osadzeniem w tym
// samym `select`, żeby panel linkował adresem kanonicznym zamiast płaskiego
// `/<slug>` (404 trasy `/$` -> 301). Osadzenie jest nową zależnością odczytu,
// więc jego błąd NIE może zmienić tego, co widzi czytelnik: leci to samo
// zapytanie bez osadzenia i dopiero jego wynik rozstrzyga jak dotąd.
import { afterEach, describe, expect, it, beforeEach, vi } from "vitest";
import { fail, ok, type RecordedChain, type SupabaseResult } from "@/test/supabaseChain";
import { resetPostParentPageRead } from "@/lib/routing/postParentPageRead";

const stubs = vi.hoisted(() => ({
  from: null as ReturnType<typeof import("@/test/supabaseChain").supabaseFromStub> | null,
}));

vi.mock("@/integrations/supabase/client", async () => {
  const helpers = await import("@/test/supabaseChain");
  const from = helpers.supabaseFromStub();
  stubs.from = from;
  return { supabase: { from: from.from } };
});

const { fetchMegaFeatured, megaFeaturedPostQueryOptions } = await import("../megaFeatured");

function stub() {
  if (!stubs.from) throw new Error("atrapa Supabase nie została podpięta");
  return stubs.from;
}

const POST_ID = "11111111-1111-1111-1111-111111111111";

function postRow(over: Record<string, unknown> = {}) {
  return {
    id: POST_ID,
    slug: "analiza-ue",
    title_pl: "Analiza UE",
    title_en: "EU analysis",
    excerpt_pl: "Skrót",
    excerpt_en: "Summary",
    cover_image_url: "https://example.com/cover.jpg",
    published_at: "2026-08-01T10:00:00Z",
    post_format: "standard",
    author_id: null,
    ...over,
  };
}

/** Odpowiedzi kolejnych zapytań do `posts` w kolejności wywołań. */
function postsSequence(...results: SupabaseResult[]) {
  let i = 0;
  stub().setResponse("posts", () => results[Math.min(i++, results.length - 1)]);
}

/** `select` obu odczytów Z osadzeniem strony-rodzica - dosłownie, znak po znaku. */
const SELECT_WITH_PARENT =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format, author_id, parent_page:pages!posts_parent_page_id_fkey(slug, parent_id)";
/** Ten sam `select` bez osadzenia: odczyt zapasowy i kształt sprzed zmiany. */
const SELECT_PLAIN =
  "id, slug, title_pl, title_en, excerpt_pl, excerpt_en, cover_image_url, published_at, post_format, author_id";

function selectOf(chain: RecordedChain | undefined): string {
  return String(chain?.argsOf("select")?.[0]);
}

function withParentPage(chain: RecordedChain): boolean {
  return selectOf(chain).includes("parent_page:");
}

/** Odczyt WSKAZANEGO wpisu (ma `.eq("id", ...)`), w odróżnieniu od najnowszego. */
function readsSpecificPost(chain: RecordedChain): boolean {
  return chain.calls.some((c) => c.method === "eq" && c.args[0] === "id");
}

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stub().reset();
  // Wyłączenie osadzenia po błędzie jest stanem MODUŁU - przypadki z odmową
  // zmieniałyby `select` w kolejnych.
  resetPostParentPageRead();
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fetchMegaFeatured", () => {
  it("zwraca WSKAZANY wpis, gdy administrator go wybrał", async () => {
    postsSequence(ok(postRow()));
    const post = await fetchMegaFeatured(POST_ID);
    expect(post?.slug).toBe("analiza-ue");

    // Filtry są częścią kontraktu: nagłówek nie może pokazać szkicu ani
    // wpisu w koszu, nawet jeśli administrator wskazał go, zanim zniknął.
    const chain = stub().lastChain("posts")!;
    expect(chain.argsOf("eq")).toEqual(["id", POST_ID]);
    expect(chain.calls.filter((c) => c.method === "eq").map((c) => c.args)).toContainEqual([
      "status",
      "published",
    ]);
    expect(chain.argsOf("is")).toEqual(["deleted_at", null]);
  });

  it("wskazany wpis ZNIKNĄŁ - wchodzi najnowszy, a nie pusta kolumna", async () => {
    // Wpis cofnięty do szkicu albo skasowany. Bez tego fallbacku kolumna
    // wyróżniona po prostu przestawała się pokazywać, bez śladu w interfejsie.
    postsSequence(ok(null), ok(postRow({ id: "inny", slug: "najnowszy" })));
    const post = await fetchMegaFeatured(POST_ID);
    expect(post?.slug).toBe("najnowszy");

    const latest = stub().lastChain("posts")!;
    expect(latest.argsOf("order")).toEqual(["published_at", { ascending: false }]);
    expect(latest.argsOf("limit")).toEqual([1]);
    // Kandydat na wyróżnienie MUSI mieć okładkę - karta bez obrazu wygląda
    // w panelu jak błąd renderu.
    expect(latest.argsOf("not")).toEqual(["cover_image_url", "is", null]);
  });

  it("błąd zapytania o wskazany wpis też schodzi na najnowszy", async () => {
    // Odmowa dotyczy odczytu wskazanego wpisu w OBU wariantach kolumn
    // (z osadzeniem rodzica i bez) - to awaria odczytu, nie osadzenia.
    stub().setResponse("posts", (chain) =>
      readsSpecificPost(chain)
        ? fail("permission denied", "42501")
        : ok(postRow({ slug: "najnowszy" })),
    );
    expect((await fetchMegaFeatured(POST_ID))?.slug).toBe("najnowszy");

    const chains = stub().chainsFor("posts");
    expect(chains.map(readsSpecificPost)).toEqual([true, true, false]);
  });

  it("bez wskazania administratora od razu bierze najnowszy", async () => {
    postsSequence(ok(postRow({ slug: "najnowszy" })));
    expect((await fetchMegaFeatured(null))?.slug).toBe("najnowszy");
    expect(stub().chainsFor("posts")).toHaveLength(1);
  });

  it("błąd zapytania o najnowszy daje `null` - nagłówek nie może się wywalić", async () => {
    postsSequence(fail("timeout"));
    expect(await fetchMegaFeatured(null)).toBeNull();
    // Dwa odczyty, nie pętla: z osadzeniem i - po jego błędzie - bez.
    expect(stub().chainsFor("posts").map(selectOf)).toEqual([SELECT_WITH_PARENT, SELECT_PLAIN]);
  });

  it("brak opublikowanych wpisów z okładką daje `null`, nie wyjątek", async () => {
    postsSequence(ok(null));
    expect(await fetchMegaFeatured(null)).toBeNull();
  });
});

describe("strona-rodzic w tym samym odczycie (adres kanoniczny karty)", () => {
  const PARENT = { slug: "blog", parent_id: null };

  it("wskazany wpis: JEDNO żądanie o wpisy z osadzeniem rodzica, zero o strony", async () => {
    postsSequence(ok(postRow({ parent_page: PARENT })));
    const post = await fetchMegaFeatured(POST_ID);

    expect(post?.parent_page).toEqual(PARENT);
    expect(stub().chainsFor("posts").map(selectOf)).toEqual([SELECT_WITH_PARENT]);
    expect(stub().chainsFor("pages")).toHaveLength(0);
    expect(warn).not.toHaveBeenCalled();
  });

  it("najnowszy wpis: ten sam literał kolumn z osadzeniem", async () => {
    postsSequence(ok(postRow({ slug: "najnowszy", parent_page: PARENT })));
    const post = await fetchMegaFeatured(null);

    expect(post).toMatchObject({ slug: "najnowszy", parent_page: PARENT });
    expect(stub().chainsFor("posts").map(selectOf)).toEqual([SELECT_WITH_PARENT]);
  });

  it("błąd osadzenia przy WSKAZANYM wpisie: zostaje wskazany wpis, nie najnowszy", async () => {
    // Bez zapasu rozjazd schematu `pages` po cichu podmieniałby wpis wybrany
    // przez administratora na najnowszy - w nagłówku każdej strony.
    stub().setResponse("posts", (chain) =>
      withParentPage(chain)
        ? fail("permission denied for table pages", "42501")
        : ok(readsSpecificPost(chain) ? postRow() : postRow({ slug: "najnowszy" })),
    );
    const post = await fetchMegaFeatured(POST_ID);

    expect(post?.slug).toBe("analiza-ue");
    expect(post?.parent_page).toBeUndefined();
    const [embedded, plain, ...rest] = stub().chainsFor("posts");
    expect(rest).toHaveLength(0);
    expect(selectOf(embedded)).toBe(SELECT_WITH_PARENT);
    expect(selectOf(plain)).toBe(SELECT_PLAIN);
    // Poza `select` zapas to to samo zapytanie: wskazany wpis, filtry publikacji.
    expect(plain?.calls.slice(1)).toEqual(embedded?.calls.slice(1));
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("błąd osadzenia przy NAJNOWSZYM wpisie: karta zostaje, bez rodzica", async () => {
    stub().setResponse("posts", (chain) =>
      withParentPage(chain)
        ? fail("Could not find a relationship between 'posts' and 'pages'", "PGRST200")
        : ok(postRow({ slug: "najnowszy" })),
    );
    const post = await fetchMegaFeatured(null);

    expect(post?.slug).toBe("najnowszy");
    expect(post?.parent_page).toBeUndefined();
    const [embedded, plain, ...rest] = stub().chainsFor("posts");
    expect(rest).toHaveLength(0);
    expect(selectOf(embedded)).toBe(SELECT_WITH_PARENT);
    expect(selectOf(plain)).toBe(SELECT_PLAIN);
    expect(plain?.calls.slice(1)).toEqual(embedded?.calls.slice(1));
  });

  it("po błędzie osadzenia wskazany wpis znika: najnowszy leci od razu bez osadzenia", async () => {
    // Trzy odczyty, nie cztery: okno wyłączenia osadzenia obejmuje oba odczyty
    // tego modułu, więc awaria nie mnoży żądań z nagłówka.
    stub().setResponse("posts", (chain) => {
      if (withParentPage(chain)) return fail("permission denied for table pages", "42501");
      return readsSpecificPost(chain) ? ok(null) : ok(postRow({ slug: "najnowszy" }));
    });
    const post = await fetchMegaFeatured(POST_ID);

    expect(post?.slug).toBe("najnowszy");
    expect(stub().chainsFor("posts").map(selectOf)).toEqual([
      SELECT_WITH_PARENT,
      SELECT_PLAIN,
      SELECT_PLAIN,
    ]);
  });
});

describe("autor wyróżnionego wpisu", () => {
  it("dokłada dane autora z profilu publicznego", async () => {
    postsSequence(ok(postRow({ author_id: "u1" })));
    stub().setResponse(
      "profiles_public",
      ok({ display_name: "Anna Nowak", slug: "anna-nowak", avatar_url: "https://a/x.png" }),
    );

    const post = await fetchMegaFeatured(POST_ID);
    expect(post).toMatchObject({
      author_display_name: "Anna Nowak",
      author_slug: "anna-nowak",
      author_avatar_url: "https://a/x.png",
    });
    expect(stub().lastChain("profiles_public")?.argsOf("eq")).toEqual(["id", "u1"]);
  });

  it("brak profilu autora zostawia puste pola zamiast wywracać zapytanie", async () => {
    // `profiles_public` jest widokiem z RLS - autor mógł skasować konto albo
    // ukryć profil. Karta ma się wtedy pokazać BEZ autora, nie zniknąć.
    postsSequence(ok(postRow({ author_id: "u1" })));
    stub().setResponse("profiles_public", ok(null));

    const post = await fetchMegaFeatured(POST_ID);
    expect(post).toMatchObject({
      slug: "analiza-ue",
      author_display_name: null,
      author_slug: null,
      author_avatar_url: null,
    });
  });

  it("wpis bez autora NIE PYTA o profil - jedno okrążenie mniej w nagłówku", async () => {
    postsSequence(ok(postRow({ author_id: null })));
    await fetchMegaFeatured(POST_ID);
    expect(stub().chainsFor("profiles_public")).toHaveLength(0);
  });
});

describe("megaFeaturedPostQueryOptions", () => {
  it("cache jest rozdzielony po wskazanym wpisie", () => {
    // Wspólny klucz oznaczałby, że pozycja menu ze wskazanym wpisem i pozycja
    // bez wskazania pokazują ten sam wpis - kto pierwszy, ten w cache.
    expect(megaFeaturedPostQueryOptions(POST_ID).queryKey).toEqual([
      "mega-menu-featured-post",
      POST_ID,
    ]);
    expect(megaFeaturedPostQueryOptions().queryKey).toEqual(["mega-menu-featured-post", null]);
  });

  it("trzyma świeżość minutę - nagłówek nie pyta o to na każdej trasie", () => {
    expect(megaFeaturedPostQueryOptions(null).staleTime).toBe(60_000);
  });

  it("queryFn prowadzi do tego samego pobrania", async () => {
    postsSequence(ok(postRow({ slug: "z-opcji" })));
    const options = megaFeaturedPostQueryOptions(null);
    const result = await options.queryFn!({} as never);
    expect((result as { slug: string } | null)?.slug).toBe("z-opcji");
  });
});
