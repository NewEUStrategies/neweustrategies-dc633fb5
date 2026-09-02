// Trasa PUBLICZNA `/glossary` - słowniczek pojęć. Do dziś: 0 z 26 linii.
//
// CO DOWODZI TEN PLIK.
//
// Ta strona nie ma żadnej interakcji: jej CAŁA wartość to treść indeksowalna
// (long-tail SEO na hasła polityki europejskiej) plus węzeł `DefinedTermSet`,
// po którym asystenci i wyszukiwarki czytają definicje. Render samego
// komponentu mija dokładnie tę warstwę, w której to się rozstrzyga: `head()`
// biegnie POZA drzewem Reacta i bierze język z ADRESU, a treść w wyjściu
// serwera istnieje wyłącznie dlatego, że loader rozgrzał klucz, który
// `useSuspenseQuery` potem czyta. Dlatego wszystko poniżej idzie albo przez
// `renderRoute` (prawdziwy router pamięciowy), albo przez `renderToString`
// (jedyna metoda, która widzi wyjście serwera).
//
// ── DECYZJA N4 DLA TEJ TRASY: LOADER JEST I MUSI BYĆ ────────────────────────
//
// Audyt modułu 07 wymienił `/glossary` jako trasę BEZ loadera. Na tym HEAD
// loader JUŻ JEST (dodany w `27730ee`, `loadResilient` + `resilientCacheControl`)
// i to jest rozstrzygnięcie POPRAWNE, nie przypadek: bez niego SSR nie zawierał
// ANI JEDNEGO terminu, a węzeł `DefinedTermSet` był z konstrukcji `null`
// (`if (!terms || terms.length === 0) return null`). Powłoka bez terminów
// wchodziła potem do NES Edge Cache na do 24 h.
//
// Ten plik PRZYPINA tamtą naprawę wykonawczo, żeby jej wycofanie było
// czerwonym testem, a nie cichą utratą treści: blok „wyjście serwera" niżej
// mierzy HTML z `renderToString` i ma w sobie KONTROLĘ DODATNIĄ (ten sam
// render bez rozgrzanego klucza oddaje samą powłokę).
//
// BRAK `notFound()` JEST TU ŚWIADOMY I ZOSTAJE: pusty słowniczek to legalny
// stan redakcyjny (hasła są dopisywane), a nie brakujący adres.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - `src/lib/queries/glossary.ts` biegnie tu PRAWDZIWY (atrapowany jest
//   wyłącznie klient PostgREST), więc klucz cache i lista kolumn są tymi
//   z produkcji.
// - IZOLACJI TENANTA NA POZIOMIE NAGŁÓWKA: kontrakt `x-tenant-host` ma własny
//   plik `src/integrations/supabase/__tests__/tenantHostFetch.test.ts`. Tutaj
//   dowodzimy SKUTKU, którego tamten plik nie widzi: wiersz, który nie wrócił
//   z odczytu, zamienia się w dwujęzyczny komunikat pustki, a nie w cudze
//   hasło na tym hoście.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { cleanup, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  /** Wiersze `glossary_terms` ze WSZYSTKICH obszarów roboczych. */
  terms: [] as Record<string, unknown>[],
  /**
   * Tenant PRZEGLĄDANEJ domeny. Atrapa odgrywa rolę polityki
   * `tenant_id = public_tenant_id()`: produkcja wysyła nagłówek
   * `x-tenant-host`, a baza odsiewa wiersze. Trasa własnego porównania
   * tenantów nie ma i mieć nie powinna - modelujemy SKUTEK.
   */
  tenantId: "tenant-a",
  /** `true` = odczyt słowniczka pada (blip backendu). */
  broken: false,
  /** Liczba odczytów tabeli - podstawa pomiaru round-tripów. */
  reads: 0,
  /** Adres żądania widziany przez `head()` - decyduje o języku i kanonicznym. */
  requestUrl: "https://nes.example.org/glossary",
  /** Nagłówki `Cache-Control`, jakie ustawił loader. */
  cacheControl: [] as string[],
}));

vi.mock("@/integrations/supabase/client", async () => {
  const { supabaseFromStub, ok, fail } = await import("@/test/supabase/chain");
  const stub = supabaseFromStub();
  stub.setResponse("glossary_terms", () => {
    h.reads += 1;
    if (h.broken) return fail("test: tabela glossary_terms niedostepna");
    // Polityka publiczna: tylko wiersze tenanta przeglądanej domeny.
    return ok(h.terms.filter((row) => row.tenant_id === h.tenantId));
  });
  return { supabase: { from: stub.from } };
});

vi.mock("@/lib/seo/request", () => ({
  getRequestUrl: () => h.requestUrl,
  getOrigin: () => "https://nes.example.org",
}));

vi.mock("@/lib/http/responseHeaders", () => ({
  setCacheControlHeader: (value: string) => void h.cacheControl.push(value),
  appendLinkHeader: () => {},
  readRouteCacheDirective: () => null,
}));

import "@/test/i18nReal";
import { Suspense } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import i18n from "@/lib/i18n";
import { glossaryTermsQueryOptions } from "@/lib/queries/glossary";
import { renderRoute, routeHead, type RouteHeadResult } from "@/test/routeHarness";
import { axeViolations, summarize } from "@/test/axe";
import { Route as GlossaryRoute } from "@/routes/glossary";

const PATH = "/glossary";

// ── fixtures (RODO: wszystkie hasła i definicje są ZMYŚLONE) ────────────────

function term(patch: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "t1",
    tenant_id: "tenant-a",
    slug: "acquis",
    term_pl: "Acquis wspólnotowe",
    term_en: "Community acquis",
    definition_pl: "Dorobek prawny Unii obowiązujący każde państwo członkowskie.",
    definition_en: "The Union legal corpus binding on every member state.",
    ...patch,
  };
}

async function mount(queryClient?: QueryClient) {
  return renderRoute({
    route: GlossaryRoute,
    path: PATH,
    initialEntry: PATH,
    queryClient,
  });
}

/** Wartość `content` wpisu meta - z twardym błędem, gdy wpisu nie ma
 *  (test „przechodzący" na brakującym meta nie dowodzi niczego). */
// `httpEquiv` w unii kluczy: `head()` tych tras emituje nie tylko
// `name`/`property`, ale też `http-equiv` (np. `content-language`),
// a helper skopiowany z innego testu tego klucza nie znał.
function metaContent(
  head: RouteHeadResult,
  key: "name" | "property" | "httpEquiv" | "httpEquiv",
  value: string,
): string {
  const found = (head.meta ?? []).find((entry) => entry[key] === value);
  const content = found?.content;
  if (typeof content !== "string") throw new Error(`test: brak meta ${key}="${value}"`);
  return content;
}

/** Tytuł dokumentu z `head()` - z twardym błędem, gdy go nie ma. */
function headTitle(head: RouteHeadResult): string {
  const found = (head.meta ?? []).find((entry) => typeof entry.title === "string");
  if (typeof found?.title !== "string") throw new Error("test: head() nie niesie tytulu");
  return found.title;
}

/**
 * Komponent trasy jako funkcja - STRAŻNIK, nie rzutowanie.
 *
 * Typ zwrotny to `ReactElement` z `react`, a NIE globalne `JSX.Element`:
 * globalna przestrzeń nazw `JSX` nie istnieje w tej wersji typów Reacta, więc
 * ta druga forma nie kompiluje się. `tsc --noEmit` to wyłapuje, vitest nie
 * (nie typuje), więc uwaga zostaje tutaj.
 */
function glossaryComponent(): () => ReactElement {
  const component: unknown = GlossaryRoute.options.component;
  if (typeof component !== "function") throw new Error("test: trasa nie ma komponentu");
  return component as () => ReactElement;
}

/** Loader trasy jako funkcja - `renderRoute` woła go sam, ale tu wołamy go
 *  WPROST, żeby zobaczyć granicę między falą serwera i falą klienta. */
type GlossaryLoader = (ctx: {
  context: { queryClient: QueryClient };
}) => Promise<{ degraded: boolean }>;

function glossaryLoader(): GlossaryLoader {
  const loader: unknown = GlossaryRoute.options.loader;
  if (typeof loader !== "function") throw new Error("test: trasa nie ma loadera");
  return loader as GlossaryLoader;
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

/**
 * Wyjście SERWERA dla komponentu trasy. `render()` z testing-library tego nie
 * pokaże: efekty montowania (a więc start fetcha) wykonują się przed powrotem
 * z `render`, więc DOM w teście widzi więcej, niż widzi crawler.
 */
function ssr(queryClient: QueryClient): string {
  const Component = glossaryComponent();
  return renderToString(
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={<p>POWLOKA</p>}>
        <Component />
      </Suspense>
    </QueryClientProvider>,
  );
}

beforeEach(async () => {
  await i18n.changeLanguage("pl");
  h.terms = [term()];
  h.tenantId = "tenant-a";
  h.broken = false;
  h.reads = 0;
  h.requestUrl = "https://nes.example.org/glossary";
  h.cacheControl = [];
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("pl");
  vi.restoreAllMocks();
});

describe("trasa /glossary - treść słowniczka", () => {
  it("pokazuje hasło, definicję i kotwicę po slugu", async () => {
    // Kotwica `#slug` jest tu kontraktem linkowania: przypisy w analizach
    // linkują wprost do hasła, więc cel MUSI istnieć w dokumencie.
    const view = await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Słowniczek pojęć" })).toBeInTheDocument();
    expect(screen.getByText("Acquis wspólnotowe")).toBeInTheDocument();
    expect(
      screen.getByText("Dorobek prawny Unii obowiązujący każde państwo członkowskie."),
    ).toBeInTheDocument();
    expect(view.container.querySelector("#acquis")).not.toBeNull();
  });

  it("grupuje hasła po pierwszej literze, a nie zrzuca ich w jedną listę", async () => {
    // Grupy są jedyną nawigacją tej strony. Bez nich 500 haseł to jedna
    // ściana tekstu, w której czytelnik nie znajdzie niczego.
    h.terms = [
      term(),
      term({
        id: "t2",
        slug: "budzet",
        term_pl: "Budżet wieloletni",
        term_en: "Multiannual budget",
      }),
    ];
    await mount();

    expect(screen.getByRole("heading", { level: 2, name: "A" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "B" })).toBeInTheDocument();
  });

  it("po angielsku bierze angielskie hasło i angielską definicję", async () => {
    await i18n.changeLanguage("en");
    await mount();

    expect(screen.getByRole("heading", { level: 1, name: "Glossary" })).toBeInTheDocument();
    expect(screen.getByText("Community acquis")).toBeInTheDocument();
    expect(
      screen.getByText("The Union legal corpus binding on every member state."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Acquis wspólnotowe")).not.toBeInTheDocument();
  });

  it("hasło bez angielskiej definicji spada na polską, a nie na pustkę", async () => {
    // Redakcja tłumaczy hasła stopniowo. Pusty `<dd>` w wersji angielskiej to
    // hasło bez definicji, czyli dokładnie to, po co ktoś tu wszedł.
    await i18n.changeLanguage("en");
    h.terms = [term({ definition_en: null })];
    await mount();

    expect(
      screen.getByText("Dorobek prawny Unii obowiązujący każde państwo członkowskie."),
    ).toBeInTheDocument();
  });

  it("nie zostawia strony słowniczka z wadami dostępności", async () => {
    const view = await mount();
    await screen.findByRole("heading", { level: 1 });

    const violations = await axeViolations(view.container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("trasa /glossary - stan pusty i degradacja", () => {
  it("pusty słowniczek daje komunikat redakcyjny, nie 404 i nie wywrotkę", async () => {
    // Brak haseł to legalny stan (redakcja dopisuje je stopniowo), więc trasa
    // nie ma prawa ani rzucić 404, ani pokazać pustego `<dl>`.
    h.terms = [];
    await mount();

    expect(screen.getByText("Słowniczek jest w przygotowaniu.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Słowniczek pojęć" })).toBeInTheDocument();
  });

  it("po angielsku komunikat pustki też jest angielski", async () => {
    await i18n.changeLanguage("en");
    h.terms = [];
    await mount();

    expect(screen.getByText("The glossary is being prepared.")).toBeInTheDocument();
  });

  it("awaria odczytu NIE wywraca trasy - strona wychodzi z HTTP 200 i pustką", async () => {
    // To sedno `loadResilient`: gołe `ensureQueryData` zamieniłoby blip bazy
    // w HTTP 500, a wtedy crawler traktuje stronę jak awarię serwera i wypada
    // ona z indeksu. Zdegradowany render woli pustkę niż piątkę.
    h.broken = true;
    await mount();

    expect(screen.getByText("Słowniczek jest w przygotowaniu.")).toBeInTheDocument();
  });

  it("zdegradowany render deklaruje no-store, czysty - politykę treści", async () => {
    // Bez tego rozróżnienia brzeg zapamiętałby pustą stronę na cały okres
    // świeżości i serwowałby ją kolejnym czytelnikom długo po powrocie bazy.
    h.broken = true;
    const degraded = await glossaryLoader()({ context: { queryClient: freshClient() } });
    expect(degraded.degraded).toBe(true);
    expect(h.cacheControl.at(-1)).toContain("no-store");

    h.broken = false;
    h.cacheControl = [];
    const clean = await glossaryLoader()({ context: { queryClient: freshClient() } });
    expect(clean.degraded).toBe(false);
    expect(h.cacheControl.at(-1)).toContain("s-maxage=900");
  });
});

describe("trasa /glossary - izolacja obszarów roboczych", () => {
  it("hasło innego obszaru roboczego nie pojawia się na tym hoście", async () => {
    // Autorytetem jest polityka publiczna (`tenant_id = public_tenant_id()`),
    // więc wiersz obcego tenanta NIE WRACA z odczytu. Ten test pilnuje SKUTKU:
    // trasa robi z tego komunikat pustki, a nie cudze hasło pod naszą domeną.
    h.terms = [term({ tenant_id: "tenant-b", term_pl: "Hasło obcego obszaru" })];
    await mount();

    expect(screen.getByText("Słowniczek jest w przygotowaniu.")).toBeInTheDocument();
    expect(screen.queryByText("Hasło obcego obszaru")).not.toBeInTheDocument();
  });

  it("KONTROLA DODATNIA: te same wiersze na własnym hoście renderują się", async () => {
    // Bez tej pary poprzedni test przechodziłby też wtedy, gdyby trasa nie
    // renderowała NICZEGO - a to nie izolacja, tylko awaria.
    h.terms = [term({ tenant_id: "tenant-b", term_pl: "Hasło obcego obszaru" })];
    h.tenantId = "tenant-b";
    await mount();

    expect(screen.getByText("Hasło obcego obszaru")).toBeInTheDocument();
  });

  it("klucz cache jest WSPÓLNY dla loadera i komponentu i nie niesie hosta", async () => {
    // Świadome ustalenie, nie przeoczenie: `getRouter()` tworzy NOWY
    // `QueryClient` na każde żądanie, więc wpis cache nigdy nie przechodzi
    // między hostami, a rozdzielenie klucza po hoście kosztowałoby dwa razy
    // więcej pamięci bez żadnego zysku. Gdyby klucze loadera i komponentu się
    // rozjechały, treść zeszłaby z serwera i została pobrana PO RAZ DRUGI
    // z przeglądarki - bez żadnego błędu.
    expect(glossaryTermsQueryOptions().queryKey).toEqual(["public", "glossary-terms"]);

    const queryClient = freshClient();
    await glossaryLoader()({ context: { queryClient } });
    const readsAfterLoader = h.reads;
    expect(readsAfterLoader).toBe(1);

    await mount(queryClient);
    await screen.findByText("Acquis wspólnotowe");
    expect(h.reads, "hasła pobrane po raz drugi po hydratacji").toBe(readsAfterLoader);
  });
});

describe("trasa /glossary - nagłówek dokumentu", () => {
  it("po polsku tytuł niesie markę, a opis jest zdaniem o zawartości", async () => {
    const head = routeHead(GlossaryRoute);

    expect(headTitle(head)).toBe("Słowniczek pojęć - New European Strategies");
    expect(metaContent(head, "name", "description")).toBe(
      "Kluczowe terminy polityki europejskiej używane w naszych analizach.",
    );
    expect(metaContent(head, "property", "og:type")).toBe("website");
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("pl");
  });

  it("prefiks /en w ADRESIE daje angielski tytuł i opis", async () => {
    // `head()` biegnie POZA drzewem Reacta (SSR składa metadane przed
    // hydracją), więc o języku rozstrzyga wyłącznie prefiks adresu - nie
    // globalny singleton i18next, wspólny dla współbieżnych żądań SSR.
    h.requestUrl = "https://nes.example.org/en/glossary";
    const head = routeHead(GlossaryRoute);

    expect(headTitle(head)).toBe("Glossary - New European Strategies");
    expect(metaContent(head, "name", "description")).toBe(
      "Key European policy terms used across our analyses.",
    );
    expect(metaContent(head, "httpEquiv", "content-language")).toBe("en");
  });

  it("NIE wyłącza się z indeksu - to strona pozyskania ruchu long-tail", async () => {
    // Sprawdzamy BRAK wpisu: dopisanie tu `robots: noindex` skasowałoby cały
    // sens tej strony i w aplikacji nie byłoby tego widać wcale.
    const head = routeHead(GlossaryRoute);
    expect((head.meta ?? []).filter((entry) => entry.name === "robots")).toEqual([]);
  });

  it("deklaruje adres kanoniczny i klaster hreflang PL/EN", async () => {
    const head = routeHead(GlossaryRoute);
    const canonical = (head.links ?? []).find((link) => link.rel === "canonical");
    const alternates = (head.links ?? []).filter((link) => link.rel === "alternate");

    expect(canonical?.href).toBe("https://nes.example.org/glossary");
    expect(alternates.map((link) => link.hrefLang).sort()).toEqual(["en", "pl", "x-default"]);
  });
});

// ── WYJŚCIE SERWERA: TREŚĆ, NIE POWŁOKA ────────────────────────────────────
//
// Blok mierzy HTML, który naprawdę wychodzi z serwera. Ma parę: przypadek
// dowodzący TREŚCI i KONTROLĘ DODATNIĄ narzędzia (ten sam render bez
// rozgrzanego klucza), bez której „zawiera hasło" mogłoby przechodzić na
// dowolnym stringu.

describe("trasa /glossary - wyjście serwera zawiera hasła i DefinedTermSet", () => {
  it("po rozgrzaniu przez loader HTML serwera niesie hasło i definicję", async () => {
    const queryClient = freshClient();
    await glossaryLoader()({ context: { queryClient } });

    const html = ssr(queryClient);

    expect(html).toContain("Acquis wspólnotowe");
    expect(html).toContain("Dorobek prawny Unii obowiązujący każde państwo członkowskie.");
    expect(html).not.toContain("POWLOKA");
  });

  it("KONTROLA DODATNIA: bez rozgrzania serwer oddaje samą powłokę", async () => {
    // To jest stan, który naprawia loader. Gdyby ktoś wyciął loader, poprzedni
    // test zrobi się czerwony, a ten zostanie zielony - i to jest właściwy
    // podział ról między dowodem naprawy i dowodem przyczyny.
    const html = ssr(freshClient());

    expect(html).toContain("POWLOKA");
    expect(html).not.toContain("Acquis wspólnotowe");
  });

  it("węzeł DefinedTermSet schodzi z serwera z hasłami w środku", async () => {
    // Cała wartość tej strony dla asystentów i wyszukiwarek to ten węzeł.
    // Bez rozgrzanego klucza był on z konstrukcji `null`.
    const queryClient = freshClient();
    await glossaryLoader()({ context: { queryClient } });

    const html = ssr(queryClient);

    expect(html).toContain("DefinedTermSet");
    expect(html).toContain("DefinedTerm");
    expect(html).toContain("Acquis wsp"); // hasło w ładunku JSON-LD
  });

  it("pusty słowniczek NIE emituje pustego węzła DefinedTermSet", async () => {
    // Węzeł bez ani jednego terminu to obietnica bez pokrycia - lepiej go nie
    // wystawiać, niż wystawiać puste `hasDefinedTerm`.
    h.terms = [];
    const queryClient = freshClient();
    await glossaryLoader()({ context: { queryClient } });

    const html = ssr(queryClient);

    expect(html).not.toContain("DefinedTermSet");
    expect(html).toContain("Słowniczek jest w przygotowaniu.");
  });
});
