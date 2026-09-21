// CO TEN PLIK DOWODZI
// -------------------
// Kontrakt trasy /organization/$slug jako FUNKCJI, bez montowania drzewa:
//   1. `validateSearch` - ta sama gramatyka adresu co archiwum taksonomii
//      (domyślne wartości zostają niejawne, śmieci wypadają),
//   2. `head()` - kanoniczny adres BEZ `page`/`sort`, `noindex, follow` od
//      strony drugiej, JSON-LD `Organization` i `BreadcrumbList`, oraz kontrakt
//      „brak danej = brak pola": bez logo nie ma `logo`, bez opisu nie ma
//      `description` z termu, bez WWW nie ma `sameAs`,
//   3. `head()` po nieudanym loaderze (brak `loaderData`) nadal buduje tytuł -
//      zdegradowany render nie może dać pustej karty w wynikach wyszukiwania,
//   4. KANONIKALIZACJA STAREJ TRASY: `/category/<slug-organizacji>` wskazuje
//      `canonical` na profil organizacji, a zwykła kategoria zostaje przy sobie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE
// ---------------------------
// Renderu profilu (to `src/components/organizations/__tests__`), warstwy
// zapytań (`lib/queries/organization.ts` ma własny plik) ani paginacji archiwum
// - `PaginatedPortGrid` i `ArchivePagination` mają swoje testy.
import { beforeEach, describe, expect, it, vi } from "vitest";

/** Adres żądania „widziany" przez trasę. W SSR `getRequestUrl()` oddaje adres
 *  ABSOLUTNY, w kliencie - pusty napis; oba warianty muszą dać ten sam wynik. */
const state = vi.hoisted(() => ({ requestUrl: "" }));
vi.mock("@/lib/seo/request", () => ({ getRequestUrl: () => state.requestUrl }));

import { SITE_CANONICAL_ORIGIN } from "@/lib/seo/meta";
import { Route as OrganizationRoute } from "@/routes/organization.$slug";
import { Route as CategoryRoute } from "@/routes/category.$slug";

type SearchValidator = (input: Record<string, unknown>) => Record<string, unknown>;
type HeadFn = (ctx: Record<string, unknown>) => {
  meta?: Record<string, unknown>[];
  links?: Record<string, unknown>[];
  scripts?: { children?: string }[];
};

beforeEach(() => {
  state.requestUrl = "";
});

function validate(route: unknown, input: Record<string, unknown>): Record<string, unknown> {
  const fn = (route as { options: { validateSearch: SearchValidator } }).options.validateSearch;
  return fn(input);
}

function head(route: unknown, ctx: Record<string, unknown> = {}) {
  const fn = (route as { options: { head: HeadFn } }).options.head;
  return fn(ctx);
}

function title(result: ReturnType<HeadFn>): string {
  return String(result.meta?.find((m) => "title" in m)?.title ?? "");
}

function metaByName(result: ReturnType<HeadFn>, name: string): string | undefined {
  const entry = result.meta?.find((m) => m.name === name);
  return entry ? String(entry.content) : undefined;
}

function linkByRel(result: ReturnType<HeadFn>, rel: string) {
  return result.links?.filter((l) => l.rel === rel) ?? [];
}

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

const TERM = {
  id: "org-1",
  slug: "nato",
  name_pl: "NATO",
  name_en: "NATO",
  description_pl: "<p>Sojusz Północnoatlantycki</p>",
  description_en: null,
  logo_url: "https://cdn.example/nato.svg",
  color: null,
};

const BRAND = {
  name: "NATO",
  logoUrl: "https://cdn.example/crm-nato.svg",
  website: "https://www.nato.int",
  branch: "Bezpieczeństwo",
};

function orgHead(over: Record<string, unknown> = {}) {
  return head(OrganizationRoute, {
    params: { slug: "nato" },
    loaderData: {
      org: { term: TERM, brand: BRAND },
      degraded: false,
      total: 7,
      page: 1,
      lang: "pl",
      ...over,
    },
  });
}

describe("kontrakt adresu /organization/$slug", () => {
  it("przepuszcza numer strony i znany porządek", () => {
    expect(validate(OrganizationRoute, { page: "2", sort: "popular" })).toEqual({
      page: 2,
      sort: "popular",
    });
  });

  it("śmieciowe wejście ZNIKA z adresu zamiast mnożyć warianty cache", () => {
    for (const page of ["abc", -5, 0, Number.NaN, [], {}, null]) {
      expect(validate(OrganizationRoute, { page })).toEqual({});
    }
    expect(validate(OrganizationRoute, { sort: "po-mojemu" })).toEqual({});
  });

  it("ma DOKŁADNIE tę samą gramatykę adresu co archiwum kategorii", () => {
    // Lista publikacji to ten sam pivot i ta sama paginacja - druga, niezgodna
    // gramatyka URL-a rozjechałaby linkowanie między oboma widokami.
    for (const input of [{}, { page: "2" }, { page: "0" }, { sort: "oldest" }, { sort: "x" }]) {
      expect(validate(OrganizationRoute, input)).toEqual(validate(CategoryRoute, input));
    }
  });

  it("zależności loadera niosą stronę i porządek", () => {
    const deps = (
      OrganizationRoute as unknown as {
        options: { loaderDeps: (ctx: { search: Record<string, unknown> }) => unknown };
      }
    ).options.loaderDeps;
    expect(deps({ search: {} })).toEqual({ page: 1, sort: "newest" });
    expect(deps({ search: { page: 4, sort: "popular" } })).toEqual({ page: 4, sort: "popular" });
  });

  it("ma szkielet ładowania, komponent 404 i obsługę błędu", () => {
    expect(typeof OrganizationRoute.options.pendingComponent).toBe("function");
    expect(OrganizationRoute.options.notFoundComponent).toBeTruthy();
    expect(typeof OrganizationRoute.options.errorComponent).toBe("function");
  });
});

describe("nagłówek profilu organizacji", () => {
  it("niesie nazwę termu i opis oczyszczony z HTML-a", () => {
    const result = orgHead();
    expect(title(result)).toContain("NATO");
    expect(metaByName(result, "description")).toBe("Sojusz Północnoatlantycki");
  });

  it("strona pierwsza jest indeksowalna i ma kanoniczny adres bez parametrów", () => {
    const result = orgHead();
    expect(metaByName(result, "robots")).toBeUndefined();
    const canonical = String(linkByRel(result, "canonical")[0]?.href ?? "");
    expect(canonical).toContain("/organization/nato");
    expect(canonical).not.toContain("page=");
    expect(canonical).not.toContain("sort=");
  });

  it("strona druga i dalsze są NOINDEX, FOLLOW i mają numer w tytule", () => {
    const result = orgHead({ page: 3 });
    expect(metaByName(result, "robots")).toBe("noindex, follow");
    expect(title(result)).toContain("3");
    // Kanoniczny adres NIE zmienia się razem z numerem strony - ranking
    // konsoliduje się na wizytówce, nie rozprasza po stronach listy.
    expect(String(linkByRel(result, "canonical")[0]?.href ?? "")).not.toContain("3");
  });

  it("wypisuje węzeł Organization z logo, opisem i adresem WWW jako sameAs", () => {
    const nodes = jsonLd(orgHead());
    const org = nodes.find((n) => n["@type"] === "Organization")!;
    expect(org.name).toBe("NATO");
    // Logo z kartoteki CRM ma pierwszeństwo przed grafiką termu.
    expect(org.logo).toBe(BRAND.logoUrl);
    expect(org.sameAs).toEqual([BRAND.website]);
    expect(nodes.some((n) => n["@type"] === "BreadcrumbList")).toBe(true);
  });

  it("bez marki CRM logo schodzi do grafiki termu, a sameAs znika", () => {
    // Kartoteka nie jest rejestrem organizacji - brak trafienia to normalny
    // stan, nie awaria, i nie wolno mu wyprodukować pustego pola w JSON-LD.
    const org = jsonLd(orgHead({ org: { term: TERM, brand: null } })).find(
      (n) => n["@type"] === "Organization",
    )!;
    expect(org.logo).toBe(TERM.logo_url);
    expect(org.sameAs).toBeUndefined();
  });

  it("bez logo w ogóle nie deklaruje pola logo", () => {
    const org = jsonLd(orgHead({ org: { term: { ...TERM, logo_url: null }, brand: null } })).find(
      (n) => n["@type"] === "Organization",
    )!;
    expect(org.logo).toBeUndefined();
  });

  it("bez opisu wchodzi zdanie zastępcze, ale węzeł nie kłamie o opisie termu", () => {
    const result = orgHead({
      org: { term: { ...TERM, description_pl: null, description_en: null }, brand: BRAND },
    });
    expect(metaByName(result, "description")).toContain("NATO");
    const org = jsonLd(result).find((n) => n["@type"] === "Organization")!;
    expect(org.description).toBeUndefined();
  });

  it("zero publikacji nie deklaruje kolekcji", () => {
    // Zero to nie „nie wiem": deklarowanie dorobku przy zdegradowanej liście
    // byłoby twierdzeniem o pustej organizacji.
    const org = jsonLd(orgHead({ total: 0 })).find((n) => n["@type"] === "Organization")!;
    expect(org.subjectOf).toBeUndefined();
  });

  it("bez danych loadera nagłówek nadal ma tytuł", () => {
    const result = head(OrganizationRoute, { params: { slug: "nie-ma" }, loaderData: undefined });
    expect(title(result).length).toBeGreaterThan(0);
  });
});

describe("kanonikalizacja starej trasy /category/<slug>", () => {
  const taxonomy = {
    id: "tax-1",
    slug: "nato",
    kind: "organization",
    name_pl: "NATO",
    name_en: "NATO",
    description_pl: null,
    description_en: null,
  };

  function categoryHead(over: Record<string, unknown> = {}) {
    return head(CategoryRoute, {
      params: { slug: "nato" },
      loaderData: { taxonomy, total: 4, page: 1, ...over },
    });
  }

  it("archiwum organizacji wskazuje canonical na jej profil", () => {
    const canonical = String(linkByRel(categoryHead(), "canonical")[0]?.href ?? "");
    expect(canonical).toContain("/organization/nato");
    expect(canonical).not.toContain("/category/");
  });

  it("strona z canonicalem gdzie indziej nie deklaruje własnych alternatyw językowych", () => {
    // Sprzeczny klaster hreflang (canonical tam, alternates tu) crawler
    // traktuje jako błąd konfiguracji całej pary językowej.
    expect(linkByRel(categoryHead(), "alternate").filter((l) => "hrefLang" in l)).toHaveLength(0);
  });

  it("zwykła kategoria zostaje przy swoim adresie", () => {
    const canonical = String(
      linkByRel(categoryHead({ taxonomy: { ...taxonomy, kind: "category" } }), "canonical")[0]
        ?.href ?? "",
    );
    expect(canonical).toContain("/category/nato");
  });

  it("stara trasa DALEJ renderuje - kanonikalizacja nie jest zdjęciem strony", () => {
    // Zastane linki (newslettery, cytowania, wpisy w mediach) nie mogą paść:
    // canonical przenosi sygnał rankingowy, ale dokument zostaje.
    expect(typeof CategoryRoute.options.component).toBe("function");
    expect(title(categoryHead()).length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Dane strukturalne przy renderze serwerowym
// ---------------------------------------------------------------------------

describe("trasa /organization/$slug - adresy w danych strukturalnych", () => {
  const ORIGIN = "https://neweuropeanstrategies.eu";

  function ldFor(requestUrl: string): Record<string, unknown>[] {
    state.requestUrl = requestUrl;
    return jsonLd(
      head(OrganizationRoute, {
        params: { slug: "nato" },
        loaderData: {
          org: {
            term: {
              id: "t1",
              slug: "nato",
              name_pl: "NATO",
              name_en: "NATO",
              description_pl: null,
              description_en: null,
              logo_url: null,
              color: null,
            },
            brand: null,
          },
          degraded: false,
          total: 3,
          page: 1,
          lang: "pl",
        },
      }),
    );
  }

  function orgNode(nodes: Record<string, unknown>[]): Record<string, unknown> {
    const found = nodes.find((n) => n["@type"] === "Organization");
    if (!found) throw new Error("test: brak węzła Organization");
    return found;
  }

  it("ABSOLUTNY adres żądania nie zostaje sklejony z originem po raz drugi", () => {
    // W SSR `getRequestUrl()` oddaje pełny adres. Doklejenie do niego originu
    // dawało `https://host/https://host/...` - adres, którego robot nie pobierze.
    const nodes = ldFor(`${ORIGIN}/organization/nato`);

    expect(orgNode(nodes).url).toBe(`${ORIGIN}/organization/nato`);
    expect(String(orgNode(nodes).url)).not.toContain(`${ORIGIN}${ORIGIN}`);
  });

  it("`subjectOf` niesie ten sam, poprawny adres co węzeł organizacji", () => {
    const nodes = ldFor(`${ORIGIN}/organization/nato`);
    const subject = orgNode(nodes).subjectOf as Record<string, unknown>;

    expect(subject.url).toBe(`${ORIGIN}/organization/nato`);
  });

  it("identyfikator okruszków też jest pojedynczym adresem", () => {
    const nodes = ldFor(`${ORIGIN}/organization/nato`);
    const crumbs = nodes.find((n) => n["@type"] === "BreadcrumbList");

    expect(crumbs?.["@id"]).toBe(`${ORIGIN}/organization/nato#breadcrumbs`);
  });

  it("adres WZGLĘDNY (render kliencki) schodzi na origin kanoniczny", () => {
    // Bez originu w żądaniu nie zgadujemy hosta - bierzemy ten, pod którym
    // serwis jest indeksowany.
    const nodes = ldFor("/organization/nato");

    expect(orgNode(nodes).url).toBe(`${SITE_CANONICAL_ORIGIN}/organization/nato`);
  });

  it("parametry listy nie wchodzą do danych strukturalnych", () => {
    const nodes = ldFor(`${ORIGIN}/organization/nato?page=3&sort=oldest`);

    expect(orgNode(nodes).url).toBe(`${ORIGIN}/organization/nato`);
  });
});
