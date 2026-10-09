// LINIA ŻĄDANIA WIDŻETÓW BUILDERA NIE ROŚNIE RAZEM Z KATEGORIĄ.
//
// DEFEKT (naprawiony 03.10.2026). Slider (`sliderPostsQuery`), lista wpisów
// (`postListQuery`), lista oceniana (`ratedListQuery`) i pasek newsów
// (`newsTickerQuery`) czytały tabelę pośrednią (`post_categories` /
// `post_tags`) bez `.limit()` i wkładały WSZYSTKIE pobrane identyfikatory
// wpisów do `.in("id", ...)` albo `.not("id", "in", ...)`. Identyfikator to 36
// znaków plus separator, więc kategoria z kilkuset wpisami dawała linię
// żądania rzędu kilkunastu kilobajtów - powyżej limitów proxy - i widżet na
// publicznej stronie buildera przestawał się renderować. Ten sam mechanizm,
// co S2/S3 opisane w `lib/queries/taxonomyPivot.ts`.
//
// DLACZEGO PRAWDZIWY KLIENT, A NIE REJESTRATOR ŁAŃCUCHÓW. Defekt dotyczył
// DŁUGOŚCI ADRESU URL, a tę zna dopiero postgrest-js. Ten plik montuje
// prawdziwy `createClient` z `@supabase/supabase-js` z podstawionym `fetch`:
// zero sieci, a w ręku jest dokładnie ten adres, który poszedłby do PostgREST.
// Dzięki temu test sprawdza też SKŁADNIĘ, którą parsuje PostgREST (puste
// osadzenie `!inner()`, filtr `alias.kolumna=in.(...)`, anty-złączenie
// `alias=is.null`) - a nie tylko to, że kod coś wywołał.
//
// DLACZEGO ROZMIAR SIEDZI W ODPOWIEDZI TABELI POŚREDNIEJ. Atrapa sieci oddaje
// tabelę pośrednią o 1 albo 3000 wierszach. Kod sprzed naprawy przeczytałby ją
// i przewiózł identyfikatory w adresie zapytania o wpisy, więc oba przebiegi
// dałyby różne adresy (a drugi - długi na ponad 100 KB). Kod po naprawie o tę
// tabelę w ogóle nie pyta. Rozmiar w odpowiedzi `posts` niczego by nie
// dowodził: jest konsumowany PO wysłaniu żądania.
//
// Bez sekretów: adres w `example.com`, klucz to oczywisty ciąg testowy.
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Atrapa sieci: zapisane adresy i rozmiar tabeli pośredniej do oddania. */
const net = vi.hoisted(() => ({ requests: [] as URL[], pivotSize: 1 }));

const CAT_IN = "11111111-1111-4111-8111-111111111111";
const CAT_OUT = "22222222-2222-4222-8222-222222222222";
const TAG_IN = "33333333-3333-4333-8333-333333333333";
const TAG_OUT = "44444444-4444-4444-8444-444444444444";

/** Identyfikator wpisu w kształcie UUID - 36 znaków, jak w produkcji. */
function postId(i: number): string {
  return `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
}

vi.mock("@/integrations/supabase/client", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const supabase = createClient("https://db.example.com", "test-anon-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input: RequestInfo | URL) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        net.requests.push(url);
        const table = url.pathname.replace("/rest/v1/", "");
        switch (table) {
          case "categories":
            return json([
              { id: CAT_IN, slug: "analizy" },
              { id: CAT_OUT, slug: "sponsorowane" },
            ]);
          case "tags":
            return json([
              { id: TAG_IN, slug: "ue" },
              { id: TAG_OUT, slug: "archiwum" },
            ]);
          case "post_categories":
          case "post_tags":
            // Kształt pasujący do KAŻDEGO z dawnych odczytów (także osadzenia
            // `categories!inner(slug)` slidera) - żeby kod sprzed naprawy
            // naprawdę dostał listę do przewiezienia.
            return json(
              Array.from({ length: net.pivotSize }, (_, i) => ({
                post_id: postId(i),
                categories: { slug: "analizy" },
                tags: { slug: "ue" },
              })),
            );
          default:
            return json([]);
        }
      },
    },
  });
  return { supabase };
});

import type { WidgetContent } from "@/lib/builder/types";
import { sliderPostsQueryOptions } from "@/lib/builder/sliderPostsQuery";
import { postListQueryOptions } from "@/lib/builder/postListQuery";
import { ratedListQueryOptions } from "@/lib/builder/ratedListQuery";
import { newsTickerQueryOptions } from "@/lib/builder/newsTickerQuery";

interface WidgetCase {
  readonly name: string;
  readonly run: () => Promise<unknown>;
}

function queryFnOf(options: { queryFn?: unknown }): () => Promise<unknown> {
  return options.queryFn as () => Promise<unknown>;
}

/** Każdy widżet z filtrem kategorii i (gdzie widżet go ma) tagu oraz wykluczeniami. */
const WIDGETS: readonly WidgetCase[] = [
  {
    name: "slider z wpisów",
    run: () =>
      queryFnOf(
        sliderPostsQueryOptions(
          { source: "posts", categorySlugs: "analizy", tagSlugs: "ue" } as WidgetContent,
          "pl",
        ),
      )(),
  },
  {
    name: "lista wpisów",
    run: () =>
      queryFnOf(
        postListQueryOptions(
          {
            categoriesCsv: "analizy",
            tagsCsv: "ue",
            excludeCategoriesCsv: "sponsorowane",
            excludeTagsCsv: "archiwum",
          },
          "pl",
          "list",
        ),
      )(),
  },
  {
    name: "lista oceniana",
    run: () =>
      queryFnOf(
        ratedListQueryOptions(
          {
            source: "dynamic",
            categoriesFilter: "analizy",
            tagsFilter: "ue",
            excludeCategories: "sponsorowane",
            excludeTags: "archiwum",
          },
          "pl",
        ),
      )(),
  },
  {
    name: "pasek newsów",
    run: () => queryFnOf(newsTickerQueryOptions({ categoriesCsv: "analizy" }, "pl"))(),
  },
];

/** Adres JEDYNEGO żądania o wpisy w przebiegu. */
function postsRequest(): URL {
  const posts = net.requests.filter((u) => u.pathname === "/rest/v1/posts");
  expect(posts).toHaveLength(1);
  return posts[0];
}

/** Linia żądania z rozmiarem tabeli pośredniej `size` - adres żądania o wpisy. */
async function postsUrlWithPivot(widget: WidgetCase, size: number): Promise<string> {
  net.requests = [];
  net.pivotSize = size;
  await widget.run();
  return postsRequest().toString();
}

beforeEach(() => {
  net.requests = [];
  net.pivotSize = 1;
});

describe.each(WIDGETS)("$name: zawężenie taksonomią robi baza", (widget) => {
  it("1 a 3000 przypisań w tabeli pośredniej daje IDENTYCZNY, krótki adres żądania", async () => {
    const small = await postsUrlWithPivot(widget, 1);
    const huge = await postsUrlWithPivot(widget, 3000);

    expect(huge).toBe(small);
    // Rząd wielkości, a nie ozdoba: kod sprzed naprawy dawał tu ponad 100 KB.
    // 2 KB to bezpieczny zapas poniżej limitów linii żądania proxy (8-16 KB).
    expect(huge.length).toBeLessThan(2048);
  });

  it("tabele pośrednie NIE są czytane, a adres nie niesie ani jednego id wpisu", async () => {
    net.pivotSize = 300;
    await widget.run();

    const tables = net.requests.map((u) => u.pathname.replace("/rest/v1/", ""));
    expect(tables).not.toContain("post_categories");
    expect(tables).not.toContain("post_tags");
    const posts = decodeURIComponent(postsRequest().search);
    expect(posts).not.toContain(postId(0));
    // Zawężenie niesie identyfikator TERMINU - stała długość, niezależna od
    // tego, ile wpisów ma kategoria.
    expect(posts).toContain(CAT_IN);
    expect(posts).toContain("post_categories!inner()");
  });
});

describe("składnia PostgREST w adresie żądania o wpisy", () => {
  it("lista wpisów: włączenia to puste osadzenia !inner, wykluczenia - anty-złączenia is.null", async () => {
    await WIDGETS[1].run();
    const params = postsRequest().searchParams;

    expect(params.get("select")).toBe(
      "id,slug,title_pl,title_en,excerpt_pl,excerpt_en,cover_image_url,published_at," +
        "post_format,author_id,is_sponsored,sponsored_kind,sponsored_affiliate," +
        "tx_inc_category_0:post_categories!inner(),tx_inc_tag_1:post_tags!inner()," +
        "tx_exc_category_2:post_categories(),tx_exc_tag_3:post_tags()",
    );
    expect(params.get("tx_inc_category_0.category_id")).toBe(`in.(${CAT_IN})`);
    expect(params.get("tx_inc_tag_1.tag_id")).toBe(`in.(${TAG_IN})`);
    expect(params.get("tx_exc_category_2.category_id")).toBe(`in.(${CAT_OUT})`);
    expect(params.get("tx_exc_tag_3.tag_id")).toBe(`in.(${TAG_OUT})`);
    expect(params.get("tx_exc_category_2")).toBe("is.null");
    expect(params.get("tx_exc_tag_3")).toBe("is.null");
    // Żadnego filtra po `id` - ani włączającego, ani wykluczającego.
    expect(params.has("id")).toBe(false);
  });

  it("lista oceniana: te same warunki, a jawne wykluczenie id zostaje jedynym .not", async () => {
    await queryFnOf(
      ratedListQueryOptions(
        {
          source: "dynamic",
          excludeCategories: "sponsorowane",
          excludePostIds: "p-1",
        },
        "pl",
      ),
    )();
    const params = postsRequest().searchParams;

    expect(params.get("select")).toContain("tx_exc_category_0:post_categories()");
    expect(params.get("select")).not.toContain("!inner");
    expect(params.get("tx_exc_category_0.category_id")).toBe(`in.(${CAT_OUT})`);
    expect(params.get("tx_exc_category_0")).toBe("is.null");
    expect(params.getAll("id")).toEqual(["not.in.(p-1)"]);
  });

  it("slider: kategoria i tag to DWA osadzenia !inner (koniunkcja) w jednym żądaniu", async () => {
    await WIDGETS[0].run();
    const params = postsRequest().searchParams;

    expect(params.get("select")).toBe(
      "id,slug,title_pl,title_en,excerpt_pl,excerpt_en,cover_image_url,published_at,author_id," +
        "tx_inc_category_0:post_categories!inner(),tx_inc_tag_1:post_tags!inner()",
    );
    expect(params.get("tx_inc_category_0.category_id")).toBe(`in.(${CAT_IN})`);
    expect(params.get("tx_inc_tag_1.tag_id")).toBe(`in.(${TAG_IN})`);
  });

  it("słowniki: slugi włączające i wykluczające jadą JEDNYM żądaniem na rodzaj, w jednej fali", async () => {
    await WIDGETS[1].run();
    const dictionaries = net.requests
      .map((u) => u.pathname.replace("/rest/v1/", ""))
      .filter((t) => t === "categories" || t === "tags");

    expect(dictionaries.sort()).toEqual(["categories", "tags"]);
    const categories = net.requests.find((u) => u.pathname === "/rest/v1/categories");
    expect(categories?.searchParams.get("select")).toBe("id,slug");
    expect(categories?.searchParams.get("slug")).toBe("in.(analizy,sponsorowane)");
  });
});
