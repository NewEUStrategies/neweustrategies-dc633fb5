// Wyróżniony wpis mega menu - warstwa danych kolumny „featured".
//
// Do 18.08.2026: 15% instrukcji, 0 z 6 funkcji. To zapytanie idzie z NAGŁÓWKA
// KAŻDEJ STRONY, więc jego ścieżka błędu jest ścieżką produkcyjną, nie
// teoretyczną: wskazany wpis mógł zostać cofnięty do szkicu albo skasowany,
// a nagłówek musi wtedy pokazać cokolwiek sensownego zamiast pustej kolumny.
import { describe, expect, it, beforeEach, vi } from "vitest";
import { fail, ok, type SupabaseResult } from "@/test/supabaseChain";

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

beforeEach(() => {
  stub().reset();
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
    postsSequence(fail("permission denied", "42501"), ok(postRow({ slug: "najnowszy" })));
    expect((await fetchMegaFeatured(POST_ID))?.slug).toBe("najnowszy");
  });

  it("bez wskazania administratora od razu bierze najnowszy", async () => {
    postsSequence(ok(postRow({ slug: "najnowszy" })));
    expect((await fetchMegaFeatured(null))?.slug).toBe("najnowszy");
    expect(stub().chainsFor("posts")).toHaveLength(1);
  });

  it("błąd zapytania o najnowszy daje `null` - nagłówek nie może się wywalić", async () => {
    postsSequence(fail("timeout"));
    expect(await fetchMegaFeatured(null)).toBeNull();
  });

  it("brak opublikowanych wpisów z okładką daje `null`, nie wyjątek", async () => {
    postsSequence(ok(null));
    expect(await fetchMegaFeatured(null)).toBeNull();
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
