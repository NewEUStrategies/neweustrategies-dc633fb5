// Trasa `/login` - jedyna brama wejścia do konta. Trzy rzeczy, które ten plik
// pilnuje: kontrakt wklejanego adresu (`?mode=signup` / `?mode=reset` z maili
// i kampanii), nagłówek `head()` z zakazem indeksowania oraz domyślny tryb,
// z jakim startuje `AuthPortal`.
//
// ROZSTRZYGNIĘCIE O i18n (nie badaj tego od nowa). `head()` wykonuje się przy
// ROZWIĄZYWANIU TRASY - poza drzewem Reacta i poza dostawcą i18next - a język
// bierze z ADRESU żądania (`activeLang(url)`), nie z `i18n.language`. Singleton
// i18next jest współdzielony między równoległymi żądaniami SSR, więc czytanie
// go w `head()` ścigałoby się z `changeLanguage()` innego żądania i mogłoby
// wstawić do wspólnie cache'owanego dokumentu tytuł w złym języku. Bliźniacza
// trasa `src/routes/reset-password.tsx` używa dokładnie tego samego wzorca
// literałów i jej testy też asertują na literałach - więc TU ASERTUJEMY NA
// LITERAŁACH i nie wymuszamy i18next w `head()`.
// PROPOZYCJA (nie zmiana w tym PR): te dwie pary napisów - tytuł i opis strony
// logowania - warto wynieść do małego dwujęzycznego słownika w stylu
// `src/lib/errorCopy.ts` (np. `authCopy.ts`: `{ pl: {...}, en: {...} }`),
// czytanego po `Lang`. Wtedy literał mieszka w jednym miejscu dla obu tras
// auth, a test asertuje na słowniku, nie na wklejonym napisie.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import type * as AuthPortalModule from "@/components/auth/AuthPortal";

const h = vi.hoisted(() => ({
  /**
   * Adres żądania widziany przez `head()`. Pusty ciąg = zachowanie domyślne
   * pod vitestem (`getRequestUrl()` nie ma ani żądania serwera, ani okna
   * z adresem trasy), czyli wejście w gałąź fallbacku `|| "/login"`.
   */
  requestUrl: "",
  /** Kolejne wartości `initialMode`, jakie atrapa portalu dostała w propsach. */
  initialModes: [] as (string | undefined)[],
}));

vi.mock("@/lib/seo/request", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/seo/request")>()),
  getRequestUrl: () => h.requestUrl,
}));

// Prawdziwy `AuthPortal` ciąga supabase, useAuth, useServerFn i dwa obrazki -
// tutaj przedmiotem dowodu jest WYŁĄCZNIE prop `initialMode`, który trasa mu
// podaje. Typ atrapy bierzemy z prawdziwego modułu (import tylko typu, więc
// runtime go nie ładuje), żeby zmiana kształtu propsów wysadziła kompilację.
vi.mock("@/components/auth/AuthPortal", () => {
  const AuthPortal: typeof AuthPortalModule.AuthPortal = ({ initialMode }) => {
    h.initialModes.push(initialMode);
    return <div data-testid="auth-portal-stub">{String(initialMode)}</div>;
  };
  return { AuthPortal };
});

import {
  renderRoute,
  routeHead,
  routeSearchValidator,
  type RouteMetaEntry,
} from "@/test/routeHarness";
import { Route as LoginRoute } from "@/routes/login";

const PATH = "/login";

function mount(entry = PATH) {
  return renderRoute({ route: LoginRoute, path: PATH, initialEntry: entry });
}

/** Wartość `content` wpisu meta wskazanego atrybutem - z twardym błędem, gdy
 *  wpisu nie ma (test „przechodzący" na brakującym meta nie dowodzi niczego). */
function metaContent(
  meta: RouteMetaEntry[] | undefined,
  key: "name" | "property",
  value: string,
): string {
  const found = (meta ?? []).find((entry) => entry[key] === value);
  const content = found?.content;
  if (typeof content !== "string") throw new Error(`test: brak meta ${key}="${value}"`);
  return content;
}

/** `href` linku o danym `rel` z `head().links` - patrz `metaContent`. */
function linkHref(links: Record<string, unknown>[] | undefined, rel: string): string {
  const found = (links ?? []).find((entry) => entry.rel === rel);
  const href = found?.href;
  if (typeof href !== "string") throw new Error(`test: brak linku rel="${rel}"`);
  return href;
}

beforeEach(() => {
  h.requestUrl = "";
  h.initialModes = [];
});

afterEach(() => {
  cleanup();
});

// USTALENIE O ROUTERZE (zweryfikowane w źródle, nie zgadnięte):
// `renderRoute(...).search()` czyta `match.search`, a to w TanStack Router jest
// search LUŹNY - `router-core/dist/esm/router.js` buduje go jako
// `preMatchSearch = { ...parentSearch, ...strictSearch }`, czyli surowe
// parametry adresu SCALONE z wynikiem walidatora. Wynik samego walidatora leży
// osobno, w `match._strictSearch` - i NIKT GO NIE CZYTA: `useSearch.js` to
// `useMatch({ select: (match) => match.search })`.
// Skutek: `validateSearch` zawęża TYLKO TYPY, a `Route.useSearch()` w
// komponencie widzi surową wartość z adresu. To jest właśnie defekt zgłoszony
// dwoma `it.fails` niżej, a nie ciekawostka o harnessie.
// Dlatego KONTRAKT WALIDATORA czytamy przez `routeSearchValidator()` (walidator
// jest czystą funkcją, więc da się go sprawdzić w izolacji), a SKUTEK dla
// człowieka - na zamontowanej trasie, trybem, z jakim startuje portal.
describe("trasa /login - kontrakt wklejanego adresu (validateSearch)", () => {
  const validate = routeSearchValidator(LoginRoute);

  it.each([["signin"], ["signup"], ["reset"]])("tryb '%s' przechodzi walidację adresu", (mode) => {
    expect(validate({ mode })).toEqual({ mode });
  });

  it.each([
    ["wielkie litery", "SIGNUP"],
    ["nieznany tryb", "magic"],
    ["pusta wartość", ""],
    ["liczba", 1],
    ["brak parametru mode", undefined],
  ])("%s: walidator cicho oddaje pusty search i NIE rzuca", (_label, mode) => {
    expect(() => validate({ mode })).not.toThrow();
    expect(validate({ mode })).toEqual({});
  });

  it("parametry kampanijne nie przechodzą do search obok poprawnego trybu", () => {
    // `utm_source` z linku w newsletterze musi zostać odsiany: `toEqual`
    // sprawdza CAŁY obiekt wyniku, więc dowodzi też braku nadmiarowego klucza.
    expect(validate({ mode: "signup", utm_source: "x" })).toEqual({ mode: "signup" });
  });

  it("parametry kampanijne przy złym trybie też nie przechodzą", () => {
    expect(validate({ mode: "magic", utm_source: "x" })).toEqual({});
  });

  it.each([
    ["wielkie litery", "/login?mode=SIGNUP"],
    ["nieznany tryb", "/login?mode=magic"],
    ["pusta wartość", "/login?mode="],
    ["liczba", "/login?mode=1"],
    ["parametr kampanijny", "/login?mode=magic&utm_source=x"],
  ])("%s w adresie: strona logowania otwiera się mimo wszystko", async (_label, entry) => {
    // Zły `mode` z linku w mailu nie kończy się ekranem błędu routera: trasa
    // się rozwiązuje i portal jest na ekranie. Asercja idzie na `initialModes`,
    // a nie tylko na obecność atrapy w drzewie - inaczej ten test przechodzi
    // także po USUNIĘCIU `validateSearch` z produkcji, czyli nie odróżnia
    // działającej trasy od trasy bez kontraktu adresu.
    const view = await mount(entry);

    expect(screen.getByTestId("auth-portal-stub")).toBeInTheDocument();
    expect(view.currentPath()).toBe(PATH);
    expect(h.initialModes).toHaveLength(1);
  });

  it("walidator odrzuca zły tryb, a komponent i tak go widzi - sprzężenie obu faktów", async () => {
    // Te dwie asercje MUSZĄ stać w jednym teście, bo dopiero razem opisują
    // defekt: walidator mówi „odrzucone", a komponent dostaje surową wartość.
    // Osobno pierwsza jest testem czystej funkcji, a druga - testem
    // TanStack Routera, nie tej trasy.
    // UWAGA na zasięg tego kanarka: gaśnie tylko wtedy, gdy ROUTER zacznie
    // oddawać komponentowi search zawężony. Naprawa rekomendowana niżej
    // (własny strażnik w `LoginPage`) go NIE ruszy - po niej zmienią stan
    // wyłącznie dwa `it.fails`.
    const view = await mount("/login?mode=magic");

    expect(routeSearchValidator(LoginRoute)({ mode: "magic" })).toEqual({});
    expect(view.search()).toEqual({ mode: "magic" });
  });

  // ─── DEFEKT PRODUKCYJNY ────────────────────────────────────────────────────
  // `validateSearch` zawęża TYLKO TYPY. W runtime `Route.useSearch()` czyta
  // `match.search` (search LUŹNY = surowe parametry adresu scalone z wynikiem
  // walidatora), a nie `match._strictSearch`, w którym router trzyma wynik
  // walidatora. Skutek: `LoginPage` przekazuje do `AuthPortal` jako
  // `initialMode` DOKŁADNIE to, co stało w adresie - także `"magic"`, `""`
  // czy liczbę `1` - choć typ obiecuje wyłącznie trzy wartości.
  // CO WIDZI CZŁOWIEK (z odczytu `AuthPortal.tsx`): żadna z trzech zakładek
  // w szynie nie jest aktywna, linia pomocnicza nad formularzem jest pusta
  // (znika „Nie masz konta? Zarejestruj się"), formularz renderuje pola
  // logowania, ale przycisk wysyłki dostaje etykietę resetu hasła
  // (`mode === "signin" ? ... : mode === "signup" ? ... : submitReset`),
  // a guard brute-force dostaje `kind: "magic"` zamiast `"login"`.
  // Adresy `?mode=` (obcięty link z maila) i `?mode=Signup` (autokorekta
  // wielkiej litery w kliencie pocztowym) są w kampaniach realne.
  // NAPRAWA (nie w tym PR): w `LoginPage` przepuścić `mode` przez ten sam
  // strażnik, co `validateSearch` (wspólna funkcja `parseAuthMode`), zamiast
  // polegać na typie zwracanym przez walidator.
  it.fails("DEFEKT: nieznany mode z adresu trafia do portalu zamiast 'signin'", async () => {
    await mount("/login?mode=magic");

    expect(screen.getByTestId("auth-portal-stub")).toHaveTextContent("signin");
  });

  it.fails("DEFEKT: pusty mode z obciętego linku trafia do portalu zamiast 'signin'", async () => {
    await mount("/login?mode=");

    expect(h.initialModes).toEqual(["signin"]);
  });
});

describe("trasa /login - head: strona logowania poza indeksem", () => {
  it("robots niesie zarówno noindex, jak i nofollow", async () => {
    // NAJWAŻNIEJSZA ASERCJA TEGO PLIKU. Jedna linia produkcji (`login.tsx:26`)
    // jest całą ochroną przed tym, żeby formularz logowania - i jego warianty
    // `?mode=signup` / `?mode=reset` jako zduplikowane adresy - wszedł do
    // wyszukiwarki. Dwie osobne asercje, bo utrata KTÓREJKOLWIEK z dyrektyw
    // jest osobną regresją: bez `noindex` strona się indeksuje, bez `nofollow`
    // crawler idzie dalej po linkach z ekranu logowania.
    const view = await mount();
    const robots = metaContent(view.meta(), "name", "robots");

    expect(robots).toContain("noindex");
    expect(robots).toContain("nofollow");
  });

  it.each([["signup"], ["reset"]])(
    "wariant ?mode=%s nie dostaje własnego adresu kanonicznego",
    (mode) => {
      // POPRZEDNIA WERSJA TEGO TESTU NIC NIE MIERZYŁA. Montowała trasę pod
      // `/login?mode=signup` i sprawdzała `robots` - ale `head()` nie
      // przyjmuje argumentów i czyta WYŁĄCZNIE zamockowany `getRequestUrl()`,
      // więc query z `initialEntry` nie miało żadnego kanału wpływu na wynik.
      // Nagłówek był bajtowo identyczny z tym z testu wyżej, czyli były to dwie
      // dosłowne kopie pod inną nazwą.
      // Teraz query wchodzi TĄ DROGĄ, KTÓRĄ WCHODZI W PRODUKCJI - przez adres
      // żądania - a asercja dotyczy tego, co nazwa testu obiecuje: warianty
      // trybu NIE stają się osobnymi adresami w indeksie. Gdyby
      // `buildContentHead` przestało zawężać adres do `pathname`
      // (`src/lib/seo/meta.ts`), każdy wariant `?mode=` dostałby własny
      // kanoniczny - czyli dokładnie tę duplikację, przed którą to broni.
      h.requestUrl = `https://example.org/login?mode=${mode}`;
      const head = routeHead(LoginRoute);

      expect(linkHref(head.links, "canonical")).toBe("https://example.org/login");
      expect(metaContent(head.meta, "property", "og:url")).toBe("https://example.org/login");
      expect(metaContent(head.meta, "name", "robots")).toContain("noindex");
    },
  );
});

describe("trasa /login - head: język brany z adresu", () => {
  it("prefiks /en w adresie daje angielski tytuł, opis i znacznik języka", () => {
    // `head()` NIE czyta `i18n.language` (patrz komentarz na górze pliku) -
    // bierze język z adresu żądania, więc wariant EN to osobna ścieżka kodu.
    h.requestUrl = "https://example.org/en/login";
    const head = routeHead(LoginRoute);

    expect(head.meta).toContainEqual({ title: "Sign in - New European Strategies" });
    expect(head.meta).toContainEqual({
      name: "description",
      content: "Sign in to your New European Strategies account.",
    });
    expect(head.meta).toContainEqual({ httpEquiv: "content-language", content: "en" });
  });

  it("adres bez prefiksu językowego daje nagłówek polski", () => {
    // ZMIERZONE, NIE ZGADNIĘTE (sonda, żeby nie badać tego po raz drugi):
    // gdy w adresie nie ma prefiksu, `activeLang` spada na `currentLang()`,
    // a to jest `createIsomorphicFn` - pod vitestem aktywna jest gałąź
    // SERWEROWA, w której `getRequest()` rzuca (nie ma kontekstu żądania)
    // i `catch` zwraca `DEFAULT_LANG`. Wynik jest więc DETERMINISTYCZNY i nie
    // zależy ani od startowego adresu happy-dom, ani od modułowej zmiennej
    // `clientLocale`: `setClientLang("en")` NIE zmienia tu niczego
    // (sprawdzone - `currentLang()` nadal zwraca "pl").
    // Konsekwencja dla następnej osoby: wariantu ANGIELSKIEGO bez prefiksu
    // NIE DA SIĘ dowieść z tego poziomu - potrzebny byłby mock
    // `@/lib/i18n/localeRuntime`. Wariant EN jest tu dowodzony prefiksem
    // `/en/login` (test wyżej), czyli tą ścieżką, którą realnie chodzi ruch.
    h.requestUrl = "https://example.org/login";
    const head = routeHead(LoginRoute);

    expect(head.meta).toContainEqual({ title: "Zaloguj się - New European Strategies" });
    expect(head.meta).toContainEqual({
      name: "description",
      content: "Zaloguj się do swojego konta New European Strategies.",
    });
    expect(head.meta).toContainEqual({ httpEquiv: "content-language", content: "pl" });
  });
});

describe("trasa /login - head: adres kanoniczny", () => {
  it("kanoniczny i og:url biorą adres z getRequestUrl", () => {
    h.requestUrl = "https://example.org/login";
    const head = routeHead(LoginRoute);

    expect(linkHref(head.links, "canonical")).toBe("https://example.org/login");
    expect(metaContent(head.meta, "property", "og:url")).toBe("https://example.org/login");
  });

  it("pusty getRequestUrl spada na '/login', a nie na pusty adres", () => {
    // Gałąź `||` w `login.tsx:14`. Bez fallbacku `buildContentHead` dostałby
    // pusty `url`, pominąłby kanoniczny i og:url - podglądy linków do strony
    // logowania byłyby bez adresu, a cały nagłówek stałby się bezużyteczny.
    h.requestUrl = "";
    const head = routeHead(LoginRoute);

    const canonical = linkHref(head.links, "canonical");
    expect(canonical).toBe("/login");
    expect(metaContent(head.meta, "property", "og:url")).toBe("/login");
    // Adres bez prefiksu = wariant polski, więc nagłówek jest polski.
    expect(head.meta).toContainEqual({ title: "Zaloguj się - New European Strategies" });
  });
});

describe("trasa /login - domyślny tryb portalu", () => {
  it.each([
    ["signin", "/login?mode=signin"],
    ["signup", "/login?mode=signup"],
    ["reset", "/login?mode=reset"],
  ])("tryb '%s' z adresu trafia do AuthPortal jako initialMode", async (mode, entry) => {
    await mount(entry);

    // `toEqual([mode])`, nie `toContain`: `toContain` przechodzi także wtedy,
    // gdy trasa zamontowała portal WIELOKROTNIE, dokładając przy okazji zły
    // tryb z poprzedniego adresu.
    expect(h.initialModes).toEqual([mode]);
    expect(screen.getByTestId("auth-portal-stub")).toHaveTextContent(mode);
  });

  it("bez parametru mode portal startuje w trybie logowania", async () => {
    // Gałąź `??` w `login.tsx:34`: gdyby tu przeciekło `undefined`, ktoś
    // wchodzący na samo /login zobaczyłby formularz w trybie zależnym od
    // domyślnego stanu portalu, a nie w logowaniu.
    await mount("/login");

    expect(h.initialModes).toEqual(["signin"]);
    expect(screen.getByTestId("auth-portal-stub")).toHaveTextContent("signin");
  });
});
