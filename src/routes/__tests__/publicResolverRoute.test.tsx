// Sklejenie uniwersalnego resolvera adresów (`src/routes/$.tsx`).
//
// CO TO DOWODZI. Tabela gramatyki
// (`src/lib/routing/__tests__/resolvePublicPath.test.ts`) dowodzi, jaką DECYZJĘ
// niesie adres. Ten plik dowodzi drugiej połowy: że loader trasy tę gramatykę
// FAKTYCZNIE woła i że zamienia deskryptor na to, co robi framework -
// `notFound()`, `redirect()` z właściwym kodem i parametrami, oraz nagłówek
// cache. Bez tego refaktor mógłby zostawić gramatykę idealną i nieużywaną.
//
// DRUGA RZECZ, KTÓREJ TABELA NIE WIDZI: LICZBA FAL ZAPYTAŃ. Gdy treści nie ma,
// loader pyta o taksonomię i o stary adres wpisu JEDNĄ falą - do 2026-11-14
// szły szeregowo i każde 404 płaciło o jedną falę round-tripów więcej przed
// pierwszym bajtem. Pierwszeństwo taksonomii zostaje (rozstrzyga je gramatyka,
// nie kolejność zapytań), a dowodem fali jest atrapa: stary adres wpisu jest
// pytany, ZANIM taksonomia odpowie.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
//   * gramatyki adresów - jest w tabeli obok, tu sprawdzamy tylko sklejenie;
//   * renderu treści (`ResolvedPage` i całe drzewo widgetów) - to 900 linii
//     kompozycji, której ścieżkę użytkownika dowodzą e2e i bramki SSR;
//     tu interesuje nas loader i `head()`;
//   * rozstrzygnięcia „strona czy wpis" - robi je funkcja SQL `resolve_path`,
//     nie TypeScript (dowód należy do pgTAP-a).
import { QueryClient } from "@tanstack/react-query";
import { isNotFound, isRedirect } from "@tanstack/react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ok, supabaseFromStub } from "@/test/supabaseChain";

const harness = vi.hoisted(() => ({
  legacyPath: null as string | null,
  cacheControl: [] as string[],
  requestUrl: "",
  /**
   * Gdy ustawione, odpowiedzi tabel taksonomii czekają na tę obietnicę - tak
   * widać, co loader zdążył zapytać, ZANIM taksonomia odpowiedziała.
   */
  taxonomyGate: null as Promise<void> | null,
}));

const stub = supabaseFromStub();

type MaybeSingle = (...args: unknown[]) => Promise<unknown>;

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const builder = stub.from(table);
      const gate = harness.taxonomyGate;
      if (
        gate &&
        (table === "categories" || table === "tags") &&
        typeof builder === "object" &&
        builder !== null &&
        "maybeSingle" in builder &&
        typeof builder.maybeSingle === "function"
      ) {
        // Ogniwa łańcucha oddają TEN SAM obiekt, więc podmiana końcówki tutaj
        // obejmuje `from(...).select(...).eq(...).maybeSingle()`.
        const settle: MaybeSingle = builder.maybeSingle.bind(builder);
        builder.maybeSingle = (...args: unknown[]) => gate.then(() => settle(...args));
      }
      return builder;
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}));

vi.mock("@/lib/routing/legacyPostPath", () => ({
  fetchLegacyPostPath: vi.fn(async () => harness.legacyPath),
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => harness.cacheControl.push(value),
  appendLinkHeader: () => undefined,
}));

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => harness.requestUrl,
}));

import { fetchLegacyPostPath } from "@/lib/routing/legacyPostPath";
import { Route } from "@/routes/$";

/** Loader trasy jako funkcja - framework wywoła dokładnie ten kod. */
type Loader = (args: {
  params: { _splat?: string };
  context: { queryClient: QueryClient };
}) => Promise<unknown>;

function loader(): Loader {
  // `unknown` W DEKLARACJI, NIE `as unknown as` W ZWROCIE. Wygenerowane typy
  // trasy opisują loader pełnym kontekstem routera, którego test nie stawia -
  // ale zejście przez `unknown` z JAWNYM strażnikiem `typeof` jest zwykłym
  // zawężeniem, a nie przepchnięciem typu obok kontroli.
  const fn: unknown = Route.options.loader;
  if (typeof fn !== "function") throw new Error("test: trasa `/$` nie ma loadera");
  return fn as Loader;
}

/** Uruchamia loader i zwraca to, CO RZUCIŁ - decyzje resolvera są wyjątkami. */
async function runLoader(splat: string): Promise<unknown> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    return await loader()({ params: { _splat: splat }, context: { queryClient } });
  } catch (thrown) {
    return thrown;
  }
}

/**
 * Deskryptor przekierowania. `redirect()` w tej wersji routera zwraca obiekt
 * ODPOWIEDZI (`Response`) z opisem nawigacji pod `options` - asercja wprost na
 * rzuconej wartości porównywałaby się z nagłówkami HTTP, nie z celem.
 * STRAŻNIK, nie rzutowanie: warunek sprawdza kształt w runtime.
 */
function redirectTarget(thrown: unknown): Record<string, unknown> {
  if (typeof thrown !== "object" || thrown === null || !("options" in thrown)) {
    throw new Error("test: rzucona wartość nie jest przekierowaniem routera");
  }
  const { options } = thrown;
  if (typeof options !== "object" || options === null) {
    throw new Error("test: przekierowanie bez opisu nawigacji");
  }
  return { ...options };
}

beforeEach(() => {
  stub.reset();
  harness.legacyPath = null;
  harness.cacheControl = [];
  harness.requestUrl = "";
  harness.taxonomyGate = null;
  vi.mocked(fetchLegacyPostPath).mockClear();
  // Brak treści dla wszystkich zapytań - domyślny stan „adres nie rozwiązany".
  stub.setResponse("categories", ok(null));
  stub.setResponse("tags", ok(null));
});

describe("loader trasy `/$` - decyzje", () => {
  it("adres pusty daje notFound bez ani jednego zapytania", async () => {
    const thrown = await runLoader("");
    expect(isNotFound(thrown)).toBe(true);
    // Pusty adres nie może kosztować round-tripu: rozstrzyga sam kształt adresu.
    expect(stub.chains).toEqual([]);
    expect(vi.mocked(fetchLegacyPostPath)).not.toHaveBeenCalled();
  });

  it("stary hierarchiczny adres kategorii daje redirect na formę płaską", async () => {
    const thrown = await runLoader("category/region/afryka");
    expect(isRedirect(thrown)).toBe(true);
    expect(redirectTarget(thrown)).toMatchObject({
      to: "/category/$slug",
      params: { slug: "afryka" },
      replace: true,
    });
    // Zwinięcie adresu wynika z jego kształtu - baza nie jest pytana.
    expect(stub.chains).toEqual([]);
  });

  it("stary hierarchiczny adres tagu daje redirect na formę płaską", async () => {
    const thrown = await runLoader("tag/foo/bar");
    expect(isRedirect(thrown)).toBe(true);
    expect(redirectTarget(thrown)).toMatchObject({
      to: "/tag/$slug",
      params: { slug: "bar" },
      replace: true,
    });
  });

  it("goły slug trafiający w archiwum kategorii daje redirect - także gdy stary adres wpisu TEŻ by trafił", async () => {
    stub.setResponse("categories", ok({ slug: "afryka" }));
    // Oba odczyty zapasowe trafiają: wygrać ma archiwum, a wynik zapytania
    // o wpis ma zostać odrzucony.
    harness.legacyPath = "analizy/afryka";
    const thrown = await runLoader("afryka");
    expect(isRedirect(thrown)).toBe(true);
    expect(redirectTarget(thrown)).toMatchObject({
      to: "/category/$slug",
      params: { slug: "afryka" },
    });
    // Cena jednej fali, zapisana wprost: trafione archiwum płaci jedno
    // RÓWNOLEGŁE zapytanie o wpis (rzadki przypadek), za to każde 404 i każde
    // 301 ze starego adresu ma o jedną szeregową falę mniej.
    expect(vi.mocked(fetchLegacyPostPath)).toHaveBeenCalledTimes(1);
  });

  it("odczyty zapasowe idą JEDNĄ falą: stary adres wpisu jest pytany, zanim taksonomia odpowie", async () => {
    let openTaxonomy: () => void = () => {};
    harness.taxonomyGate = new Promise<void>((resolve) => {
      openTaxonomy = resolve;
    });
    const pending = runLoader("nie-ma-takiej-strony");
    // Taksonomia WISI. Przy dwóch szeregowych falach zapytanie o wpis nie
    // wystartowałoby, dopóki nie odpowie - i ten warunek nigdy by nie zaszedł.
    await vi.waitFor(() => {
      expect(vi.mocked(fetchLegacyPostPath)).toHaveBeenCalledWith("nie-ma-takiej-strony");
    });
    expect(stub.chainsFor("categories")).toHaveLength(1);
    expect(stub.chainsFor("tags")).toHaveLength(1);
    openTaxonomy();
    expect(isNotFound(await pending)).toBe(true);
  });

  it("goły slug trafiający w archiwum tagu daje redirect", async () => {
    stub.setResponse("tags", ok({ slug: "atom" }));
    const thrown = await runLoader("atom");
    expect(isRedirect(thrown)).toBe(true);
    expect(redirectTarget(thrown)).toMatchObject({ to: "/tag/$slug", params: { slug: "atom" } });
  });

  it("stary płaski adres wpisu daje 301 na ścieżkę kanoniczną", async () => {
    harness.legacyPath = "analizy/slug-wpisu";
    const thrown = await runLoader("slug-wpisu");
    expect(isRedirect(thrown)).toBe(true);
    expect(redirectTarget(thrown)).toMatchObject({
      to: "/$",
      params: { _splat: "analizy/slug-wpisu" },
      statusCode: 301,
    });
  });

  it("adres wielosegmentowy NIE pyta o taksonomię, ale pyta o stary adres wpisu", async () => {
    harness.legacyPath = "analizy/atom";
    const thrown = await runLoader("stara-sekcja/atom");
    expect(isRedirect(thrown)).toBe(true);
    expect(stub.chainsFor("categories")).toEqual([]);
    expect(stub.chainsFor("tags")).toEqual([]);
    // Slug wpisu jest globalnie unikalny - pytamy o OSTATNI segment.
    expect(vi.mocked(fetchLegacyPostPath)).toHaveBeenCalledWith("atom");
  });

  it("ścieżka kanoniczna równa żądanej daje notFound, nie pętlę przekierowań", async () => {
    harness.legacyPath = "analizy/atom";
    const thrown = await runLoader("analizy/atom");
    expect(isNotFound(thrown)).toBe(true);
    expect(isRedirect(thrown)).toBe(false);
  });

  it("nierozwiązywalny adres daje notFound po wyczerpaniu wszystkich prób", async () => {
    const thrown = await runLoader("nie-ma-takiej-strony");
    expect(isNotFound(thrown)).toBe(true);
    // Goły slug: oba archiwa i stary adres wpisu - jedną falą.
    expect(stub.chainsFor("categories")).toHaveLength(1);
    expect(stub.chainsFor("tags")).toHaveLength(1);
    expect(vi.mocked(fetchLegacyPostPath)).toHaveBeenCalledWith("nie-ma-takiej-strony");
  });

  it("adres skanera daje notFound bez pytania o taksonomię i o stary adres wpisu", async () => {
    // `wp-login.php` nie może być slugiem archiwum ani wpisu, więc 404
    // rozstrzyga sama rezolucja treści - bez drugiej fali round-tripów.
    for (const splat of ["wp-login.php", ".env", "vendor/phpunit/eval-stdin.php"]) {
      const thrown = await runLoader(splat);
      expect(isNotFound(thrown)).toBe(true);
    }
    expect(stub.chainsFor("categories")).toEqual([]);
    expect(stub.chainsFor("tags")).toEqual([]);
    expect(vi.mocked(fetchLegacyPostPath)).not.toHaveBeenCalled();
  });

  it("zapytanie o taksonomię filtruje po slugu i bierze co najwyżej jeden wiersz", async () => {
    await runLoader("afryka");
    const chain = stub.lastChain("categories");
    expect(chain?.argsOf("eq")).toEqual(["slug", "afryka"]);
    // `maybeSingle` - brak wiersza to poprawny wynik, nie błąd.
    expect(chain?.has("maybeSingle")).toBe(true);
  });

  it("każda decyzja resolvera ustawia nagłówek `no-store`", async () => {
    // Odpowiedzi 404 i 301 nie mogą być cache'owane na brzegu: adres zaczyna
    // działać w chwili publikacji treści, a nie po wygaśnięciu TTL.
    for (const splat of ["", "category/a/b", "nie-ma"]) {
      harness.cacheControl = [];
      await runLoader(splat);
      expect(harness.cacheControl).not.toEqual([]);
      expect(harness.cacheControl.every((v) => v.includes("no-store"))).toBe(true);
    }
  });
});

describe("head() trasy `/$`", () => {
  type HeadFn = (ctx: { loaderData?: unknown; params: { _splat?: string } }) => {
    meta?: Record<string, unknown>[];
    links?: Record<string, unknown>[];
  };

  function head(ctx: Parameters<HeadFn>[0]): ReturnType<HeadFn> {
    // To samo zejście przez `unknown` co przy loaderze - patrz komentarz wyżej.
    const fn: unknown = Route.options.head;
    if (typeof fn !== "function") throw new Error("test: trasa `/$` nie ma head()");
    return (fn as HeadFn)(ctx);
  }

  it("bez danych loadera nie emituje żadnych metadanych", async () => {
    // Ta gałąź biegnie przy 404 i przy przerwanym loaderze: `head()` nie może
    // rzucić, bo wywaliłoby całą stronę błędu.
    expect(head({ loaderData: undefined, params: {} })).toEqual({ meta: [] });
    expect(head({ loaderData: { item: null }, params: {} }).meta).toEqual([]);
  });

  it("emituje kanoniczny adres zgodny z adresem żądania", async () => {
    harness.requestUrl = "https://przyklad.test/analizy/atom";
    const result = head({
      loaderData: {
        kind: "page",
        item: {
          id: "p1",
          slug: "atom",
          title_pl: "Atom",
          title_en: "Atom",
          excerpt_pl: "Opis",
          excerpt_en: "Description",
          cover_image_url: null,
          published_at: "2026-01-01T00:00:00.000Z",
          updated_at: "2026-01-02T00:00:00.000Z",
        },
        crumbs: [],
      },
      params: { _splat: "analizy/atom" },
    });
    const canonical = result.links?.find((l) => l.rel === "canonical");
    expect(canonical?.href).toBe("https://przyklad.test/analizy/atom");
  });

  it("bez adresu żądania składa adres ze splatu - render po hydracji", async () => {
    harness.requestUrl = "";
    const result = head({
      loaderData: {
        kind: "page",
        item: {
          id: "p1",
          slug: "atom",
          title_pl: "Atom",
          title_en: "Atom",
          excerpt_pl: null,
          excerpt_en: null,
          cover_image_url: null,
          published_at: null,
          updated_at: null,
        },
        crumbs: [],
      },
      params: { _splat: "analizy/atom" },
    });
    const canonical = result.links?.find((l) => l.rel === "canonical");
    expect(String(canonical?.href)).toContain("/analizy/atom");
  });
});
