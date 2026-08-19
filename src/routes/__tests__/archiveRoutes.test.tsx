// Kontrakt tras archiwum: /blog, /category/$slug, /tag/$slug, /publications.
//
// Audyt świadomie NIE kazał gonić tu pokrycia renderu - trasy są cienką
// kompozycją loaderów, a ich ścieżkę użytkownika dowodzą e2e i bramki SSR.
// Ale dwie warstwy tych plików to CZYSTY KONTRAKT, którego e2e nie dotyka
// punktowo, a którego złamanie widać dopiero w wynikach wyszukiwarki:
//
//   1. `validateSearch` - co robi adres ze śmieciowym `?page=`; wartości
//      domyślne muszą zostać NIEJAWNE, inaczej `/blog` i `/blog?page=1` to dwa
//      adresy tej samej treści,
//   2. `head()` - kanoniczny adres BEZ parametrów stronicowania, `noindex`
//      od strony drugiej (konsolidacja rankingu na pierwszej), tytuł z numerem
//      strony i JSON-LD `CollectionPage`.
//
// Testujemy je jako funkcje, bez montowania tras - to ten sam kod, który
// wykona framework, tylko bez kosztu całego drzewa.
import { describe, expect, it } from "vitest";
import { Route as BlogRoute } from "@/routes/blog.index";
import { Route as CategoryRoute } from "@/routes/category.$slug";
import { Route as TagRoute } from "@/routes/tag.$slug";
import { Route as PublicationsRoute } from "@/routes/publications";

type SearchValidator = (input: Record<string, unknown>) => Record<string, unknown>;
type HeadFn = (ctx: Record<string, unknown>) => {
  meta?: Record<string, unknown>[];
  links?: Record<string, unknown>[];
  scripts?: { children?: string }[];
};

function validate(route: unknown, input: Record<string, unknown>): Record<string, unknown> {
  const fn = (route as { options: { validateSearch: SearchValidator } }).options.validateSearch;
  return fn(input);
}

function head(route: unknown, ctx: Record<string, unknown> = {}) {
  const fn = (route as { options: { head: HeadFn } }).options.head;
  return fn(ctx);
}

/** Wartość `<title>` z opisu nagłówka trasy. */
function title(result: ReturnType<HeadFn>): string {
  return String(result.meta?.find((m) => "title" in m)?.title ?? "");
}

/** Zawartość `<meta name="...">`. */
function metaByName(result: ReturnType<HeadFn>, name: string): string | undefined {
  const entry = result.meta?.find((m) => m.name === name);
  return entry ? String(entry.content) : undefined;
}

function metaByProperty(result: ReturnType<HeadFn>, property: string): string | undefined {
  const entry = result.meta?.find((m) => m.property === property);
  return entry ? String(entry.content) : undefined;
}

function linkByRel(result: ReturnType<HeadFn>, rel: string) {
  return result.links?.filter((l) => l.rel === rel) ?? [];
}

/** Węzły JSON-LD wypisane przez trasę. */
function jsonLd(result: ReturnType<HeadFn>): Record<string, unknown>[] {
  return (result.scripts ?? [])
    .map((s) => {
      try {
        return JSON.parse(String(s.children ?? "{}")) as Record<string, unknown>;
      } catch {
        return {};
      }
    })
    .filter((node) => Object.keys(node).length > 0);
}

describe("kontrakt adresu: ?page", () => {
  it("strona pierwsza zostaje NIEJAWNA - bez duplikatu ?page=1", () => {
    expect(validate(BlogRoute, {})).toEqual({});
    expect(validate(BlogRoute, { page: 1 })).toEqual({});
    expect(validate(BlogRoute, { page: "1" })).toEqual({});
  });

  it("kolejne strony zostają w adresie jako liczba", () => {
    expect(validate(BlogRoute, { page: "3" })).toEqual({ page: 3 });
    // Ułamek z ręcznie sklejonego adresu obcinamy do pełnej strony.
    expect(validate(BlogRoute, { page: 3.9 })).toEqual({ page: 3 });
  });

  it("śmieciowe wejście ZNIKA z adresu, zamiast mnożyć warianty cache", () => {
    for (const page of ["abc", -5, 0, Number.NaN, [], {}, null]) {
      expect(validate(BlogRoute, { page })).toEqual({});
    }
  });
});

describe("kontrakt adresu archiwum taksonomii", () => {
  it("archiwum kategorii przepuszcza numer strony i znany porządek", () => {
    expect(validate(CategoryRoute, { page: "2", sort: "popular" })).toEqual({
      page: 2,
      sort: "popular",
    });
  });

  it("porządek DOMYŚLNY zostaje niejawny, a nieznany jest odrzucany", () => {
    // Bez tego router przepisywałby adres tam i z powrotem między
    // `?sort=newest` a wersją kanoniczną.
    expect(validate(CategoryRoute, { sort: "newest" })).toEqual({ sort: "newest" });
    expect(validate(CategoryRoute, { sort: "po-mojemu" })).toEqual({});
    expect(validate(CategoryRoute, {})).toEqual({});
  });

  it("archiwum tagu ma DOKŁADNIE ten sam kontrakt adresu", () => {
    for (const input of [{}, { page: "2" }, { page: "0" }, { sort: "oldest" }, { sort: "x" }]) {
      expect(validate(TagRoute, input)).toEqual(validate(CategoryRoute, input));
    }
  });

  it("strona pierwsza kategorii nie zostawia `?page=1`", () => {
    expect(validate(CategoryRoute, { page: 1 })).toEqual({ page: 1 });
    expect(validate(CategoryRoute, { page: "abc" })).toEqual({});
  });
});

describe("nagłówek /blog", () => {
  it("strona pierwsza jest indeksowalna i ma kanoniczny adres bez parametrów", () => {
    const result = head(BlogRoute, { loaderData: { page: 1, total: 42, coverPreload: null } });
    expect(title(result)).toContain("Blog");
    expect(metaByName(result, "robots")).toBeUndefined();
    const canonical = linkByRel(result, "canonical")[0];
    expect(String(canonical?.href)).not.toContain("page=");
  });

  it("strona druga i dalsze są NOINDEX, FOLLOW", () => {
    // Konsolidacja rankingu na stronie pierwszej: crawler ma iść za linkami
    // do wpisów, ale nie budować indeksu z kolejnych stron listy.
    const result = head(BlogRoute, { loaderData: { page: 3, total: 42, coverPreload: null } });
    expect(metaByName(result, "robots")).toBe("noindex, follow");
    expect(title(result)).toContain("3");
  });

  it("wypisuje okruszki i CollectionPage z liczbą wyników", () => {
    const nodes = jsonLd(
      head(BlogRoute, { loaderData: { page: 1, total: 42, coverPreload: null } }),
    );
    const collection = nodes.find((n) => n["@type"] === "CollectionPage");
    expect(collection).toMatchObject({ numberOfItems: 42 });
    expect(nodes.some((n) => n["@type"] === "BreadcrumbList")).toBe(true);
  });

  it("bez wyników nie deklaruje liczby elementów kolekcji", () => {
    // Zero to nie „nie wiem" - deklarowanie `numberOfItems: 0` byłoby
    // twierdzeniem o pustym archiwum przy zdegradowanym renderze.
    const nodes = jsonLd(
      head(BlogRoute, { loaderData: { page: 1, total: 0, coverPreload: null } }),
    );
    const collection = nodes.find((n) => n["@type"] === "CollectionPage")!;
    expect(collection.numberOfItems).toBeUndefined();
  });

  it("deskryptor okładki zamienia się w preload LCP", () => {
    const withCover = head(BlogRoute, {
      loaderData: {
        page: 1,
        total: 3,
        coverPreload: { href: "https://cdn.example/cover.avif", imageSrcSet: "", imageSizes: "" },
      },
    });
    expect(linkByRel(withCover, "preload").length).toBe(1);

    const withoutCover = head(BlogRoute, {
      loaderData: { page: 1, total: 3, coverPreload: null },
    });
    expect(linkByRel(withoutCover, "preload").length).toBe(0);
  });

  it("bez danych loadera nagłówek nadal się buduje", () => {
    // SSR może wejść w `head()` po zdegradowanym loaderze - brak tytułu byłby
    // wtedy pustą kartą w wynikach wyszukiwania.
    const result = head(BlogRoute, {});
    expect(title(result)).toContain("Blog");
  });
});

describe("nagłówek archiwum taksonomii", () => {
  const taxonomy = {
    id: "tax-1",
    slug: "gospodarka",
    name_pl: "Gospodarka",
    name_en: "Economy",
    description_pl: "<p>Analizy gospodarcze</p>",
    description_en: null,
  };

  function categoryHead(over: Record<string, unknown> = {}) {
    return head(CategoryRoute, {
      params: { slug: "gospodarka" },
      loaderData: { taxonomy, total: 12, page: 1, ...over },
    });
  }

  it("tytuł niesie nazwę kategorii, opis - oczyszczony tekst z HTML-a", () => {
    const result = categoryHead();
    expect(title(result)).toContain("Gospodarka");
    // Opis idzie do `<meta description>`, więc znaczniki muszą wypaść.
    expect(metaByName(result, "description")).toBe("Analizy gospodarcze");
  });

  it("bez opisu wchodzi zdanie zastępcze z liczbą wpisów", () => {
    const result = categoryHead({
      taxonomy: { ...taxonomy, description_pl: null, description_en: null },
    });
    expect(metaByName(result, "description")).toContain("12");
  });

  it("kolejne strony są noindex i mają numer w tytule", () => {
    const result = categoryHead({ page: 4 });
    expect(metaByName(result, "robots")).toBe("noindex, follow");
    expect(title(result)).toContain("4");
  });

  it("dokłada autodiscovery kanału RSS taksonomii", () => {
    // Bez tego czytnik RSS musiałby znać konwencję adresu kanału.
    const rss = linkByRel(categoryHead(), "alternate").filter(
      (l) => l.type === "application/rss+xml",
    );
    expect(rss).toHaveLength(1);
    expect(String(rss[0].href)).toContain("/category/gospodarka/rss.xml");
  });

  it("wypisuje okruszki i CollectionPage z własnym identyfikatorem", () => {
    const nodes = jsonLd(categoryHead());
    expect(nodes.some((n) => n["@type"] === "BreadcrumbList")).toBe(true);
    const collection = nodes.find((n) => n["@type"] === "CollectionPage")!;
    expect(String(collection.name)).toContain("Gospodarka");
    expect(String((collection.breadcrumb as { "@id": string })["@id"])).toContain("#breadcrumbs");
  });

  it("brak taksonomii (404 z loadera) nie zostawia pustego tytułu", () => {
    const result = head(CategoryRoute, { params: { slug: "nie-ma" }, loaderData: undefined });
    expect(title(result).length).toBeGreaterThan(0);
  });

  it("archiwum tagu ma własne nazewnictwo i własny kanał", () => {
    const result = head(TagRoute, {
      params: { slug: "nato" },
      loaderData: { taxonomy: { ...taxonomy, slug: "nato", name_pl: "NATO" }, total: 3, page: 1 },
    });
    expect(title(result)).toContain("NATO");
    const rss = linkByRel(result, "alternate").filter((l) => l.type === "application/rss+xml");
    expect(String(rss[0]?.href)).toContain("/tag/nato/rss.xml");
  });
});

describe("nagłówek /publications", () => {
  it("ma tytuł, opis i węzeł CollectionPage", () => {
    const result = head(PublicationsRoute);
    expect(title(result).length).toBeGreaterThan(0);
    expect(metaByProperty(result, "og:type")).toBe("website");
    const collection = jsonLd(result).find((n) => n["@type"] === "CollectionPage");
    expect(collection).toBeTruthy();
  });

  it("filtry z adresu przechodzą walidację, a nieznany porządek ją oblewa", () => {
    expect(validate(PublicationsRoute, { q: "energia", sort: "popular" })).toMatchObject({
      q: "energia",
      sort: "popular",
    });
    // `q` ma wartość domyślną, więc pusty adres nadal daje poprawny kształt.
    expect(validate(PublicationsRoute, {})).toMatchObject({ q: "" });
    expect(() => validate(PublicationsRoute, { sort: "po-mojemu" })).toThrow();
  });

  it("język publikacji jest ograniczony do obsługiwanych wersji", () => {
    expect(validate(PublicationsRoute, { lang: "en" })).toMatchObject({ lang: "en" });
    expect(() => validate(PublicationsRoute, { lang: "de" })).toThrow();
  });
});

describe("spięcie tras", () => {
  it("każda trasa archiwum ma szkielet ładowania i obsługę błędu", () => {
    for (const route of [BlogRoute, CategoryRoute, TagRoute]) {
      expect(typeof route.options.pendingComponent).toBe("function");
      expect(typeof route.options.errorComponent).toBe("function");
    }
  });

  it("archiwa taksonomii mają własny komponent 404", () => {
    // Nieistniejąca kategoria ma dać stronę „nie znaleziono", a nie pusty
    // layout archiwum z zerem wyników.
    for (const route of [CategoryRoute, TagRoute]) {
      expect(route.options.notFoundComponent).toBeTruthy();
    }
  });

  it("zależności loadera niosą stronę i porządek", () => {
    const deps = (
      CategoryRoute as unknown as {
        options: { loaderDeps: (ctx: { search: Record<string, unknown> }) => unknown };
      }
    ).options.loaderDeps;
    expect(deps({ search: {} })).toEqual({ page: 1, sort: "newest" });
    expect(deps({ search: { page: 4, sort: "popular" } })).toEqual({ page: 4, sort: "popular" });
  });
});
