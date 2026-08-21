import { test, expect } from "@playwright/test";

// BRAMKA ODPORNOŚCI SSR: żadna publiczna trasa nie odpowiada 5xx, gdy backend
// jest niedostępny.
//
// REGRESJA ŹRÓDŁOWA (zmierzona, nie hipotetyczna). Trasa, której loader robił
// gołe `await ensureQueryData(...)`, zamieniała każdy blip Supabase w twarde
// HTTP 500 - dokument renderował się w całości (errorComponent trasy), ale
// status mówił „awaria serwera". Skutki są realne i nie widać ich w przeglądarce:
//   * CDN nie zapisze 500, więc każdy kolejny czytelnik płaci ten sam błąd,
//   * monitory (w tym operatora płatności) raportują serwis jako offline,
//   * crawler traktuje 500 jak awarię i wypycha adres z indeksu.
// Przed naprawą, przy niedostępnym backendzie, 500 zwracały: /experts, /events,
// /live, /podcasts, /programs, /web-stories i /author/$slug.
//
// DLACZEGO TA BRAMKA DZIAŁA W CI: suita startuje z placeholderowymi
// poświadczeniami Supabase (patrz playwright.config.ts), więc KAŻDE zapytanie
// do bazy z definicji nie dojeżdża. To jest dokładnie warunek brzegowy, którego
// dotyczy regresja - w CI jest on stanem domyślnym, nie sztucznym scenariuszem.
//
// Czego bramka NIE sprawdza: obecności danych. Pusta lista jest poprawnym
// wynikiem; niepoprawny jest status 5xx i pusty dokument.

interface PublicRoute {
  readonly path: string;
  readonly label: string;
}

/**
 * Publiczne trasy z zapytaniami SSR. Dodając trasę, która czyta dane w
 * loaderze, DOPISZ ją tutaj - to jedyne miejsce, które pilnuje, że nowa trasa
 * przeszła przez `lib/ssr/resilientLoad` zamiast rzucać z loadera.
 */
const ROUTES: readonly PublicRoute[] = [
  { path: "/", label: "strona główna" },
  { path: "/en", label: "strona główna (EN)" },
  { path: "/blog", label: "lista wpisów" },
  { path: "/experts", label: "katalog ekspertów" },
  { path: "/en/experts", label: "katalog ekspertów (EN)" },
  { path: "/events", label: "wydarzenia" },
  { path: "/live", label: "relacje na żywo" },
  { path: "/podcasts", label: "sieć podcastów" },
  { path: "/programs", label: "programy badawcze" },
  { path: "/web-stories", label: "web stories" },
  { path: "/tracker", label: "tracker legislacyjny" },
];

for (const route of ROUTES) {
  test(`${route.label} (${route.path}) nie oddaje 5xx przy martwym backendzie`, async ({
    request,
  }) => {
    const response = await request.get(route.path, { maxRedirects: 5 });
    const status = response.status();

    expect(
      status,
      `${route.path} zwróciło ${status}. Loader tej trasy prawdopodobnie rzuca ` +
        `zamiast degradować - przepuść zapytanie przez loadResilient() ` +
        `z lib/ssr/resilientLoad (patrz nagłówek tego pliku).`,
    ).toBeLessThan(500);

    // Dokument musi być realną stroną, nie strzępem: sama „nie-piątka" byłaby
    // pozorna, gdyby trasa oddawała pustą odpowiedź 200.
    const body = await response.text();
    expect(body, `${route.path}: pusty dokument`).toContain("<main");
  });
}

// Sam status 200 to za mało: trasa mogłaby go oddać, udając pustą listę
// („brak wydarzeń"), choć naprawdę nic nie dojechało. Ta asercja pilnuje
// DRUGIEJ połowy kontraktu - render zdegradowany mówi prawdę i daje
// ponowienie, w języku trasy.
const DEGRADED_COPY = {
  pl: "Reszta strony działa normalnie",
  en: "The rest of the page is fine",
} as const;

for (const [lang, path] of [
  ["pl", "/events"],
  ["en", "/en/events"],
] as const) {
  test(`render zdegradowany mówi prawdę zamiast udawać pustą listę (${lang})`, async ({
    request,
  }) => {
    const response = await request.get(path, { maxRedirects: 5 });
    expect(response.status()).toBe(200);
    const body = await response.text();

    expect(
      body,
      `${path}: brak uczciwego komunikatu o degradacji - strona prawdopodobnie ` +
        `renderuje pusty stan („brak wydarzeń") mimo że dane nie dojechały.`,
    ).toContain(DEGRADED_COPY[lang]);
  });
}

// Zapytanie TOŻSAMOŚCIOWE (czy ten zasób istnieje?) ma osobny kontrakt:
// degradacja NIE MOŻE dać 404, bo to wyrzuciłoby indeksowaną stronę z wyników
// wyszukiwania na podstawie chwilowej awarii bazy. Przy martwym backendzie
// oczekujemy 200 z uczciwym komunikatem - nigdy 404 ani 5xx.
test("profil eksperta przy martwym backendzie nie fabrykuje 404", async ({ request }) => {
  const response = await request.get("/author/dowolny-slug", { maxRedirects: 5 });
  const status = response.status();
  expect(
    status,
    `/author/$slug zwróciło ${status}. Blip backendu nie może stać się 404 ` +
      `(fałszywy 404 = deindeksacja) ani 5xx.`,
  ).toBe(200);
});

// ═══════════════════════════════════════════════════════════════════════════
// STATUS 404 JAKO KONTRAKT SEO - I DEFEKT, KTÓRY TA BRAMKA WŁAŚNIE ODKRYŁA.
//
// ZMIERZONY STAN FAKTYCZNY (2026-08-21, dev server bez poświadczeń Supabase -
// czyli DOKŁADNIE warunek, dla którego napisano ten plik):
//
//     GET /nie-ma-takiej-strony-9f2a  ->  HTTP 500
//
// Oczekiwane jest 404. Przyczyna jest w loaderze `src/routes/$.tsx`: po tym,
// jak rezolucja treści nie znajdzie strony, loader wykonuje DWA dalsze
// odczyty - równoległe zapytanie o archiwum kategorii i tagu oraz
// `resolveLegacyPostPath(...)` - i ŻADEN z nich nie jest osłonięty. Zapytanie
// o treść ma `.catch(() => undefined)`, te dwa nie mają nic. Przy niedostępnej
// bazie rzucają, wyjątek wychodzi z loadera i framework oddaje 500.
//
// DLACZEGO TO JEST POWAŻNE. `$.tsx` rozwiązuje KAŻDY publiczny adres, który nie
// trafił w trasę statyczną - czyli wszystkie strony CMS i wszystkie stare
// adresy wpisów. Awaria bazy zamienia więc nie jedną trasę, a całą powierzchnię
// treści w 500. To jest dokładnie ta regresja, którą opisuje nagłówek tego
// pliku („trasa, której loader robił gołe `await ensureQueryData(...)`,
// zamieniała każdy blip Supabase w twarde HTTP 500") - tylko że lista `ROUTES`
// wyżej sprawdza jedenaście tras STATYCZNYCH i `$.tsx` nigdy się na niej nie
// znalazł. Bramka istniała, a najszersza powierzchnia w aplikacji była poza jej
// zasięgiem.
//
// DRUGI SKUTEK, NIEZALEŻNY OD AWARII: soft 404. Adres, którego nie ma, musi
// odpowiedzieć 404. Zwrócony z kodem 200 wygląda w przeglądarce poprawnie,
// a wyszukiwarce mówi „to jest prawidłowa treść" - i tak do indeksu wchodzą
// dowolne warianty pustej strony, konkurując z realnymi adresami. Google
// raportuje to jako „Soft 404" i sam wypycha adresy z wyników.
//
// DLACZEGO `test.fail()`, A NIE POPRAWKA. Naprawa to osłonięcie dwóch odczytów
// w loaderze i decyzja, CZYM ma być degradacja na tej powierzchni: 404
// (spójne z „nie ma takiej strony") czy 200 z komunikatem (spójne z kontraktem
// `/author/$slug` niżej, który WYMAGA 200, bo „fałszywy 404 = deindeksacja").
// Te dwa kontrakty są dziś sprzeczne, a rozstrzygnięcie jest decyzją
// produktową - nie skutkiem ubocznym testu. Testy zostają, oznaczone jako
// oczekiwana porażka: w dniu naprawy zapalą się na zielono i wymuszą zdjęcie
// `test.fail()`, więc nikt nie przeoczy, że kontrakt się domknął.
//
// KOMUNIKAT IDZIE Z JEDNEGO ŹRÓDŁA. Warstwa awaryjna (404, error boundary)
// renderuje się poza dostawcą i18next - `src/lib/errorCopy.ts` jest świadomym,
// udokumentowanym wyjątkiem od reguły „tekst z klucza": jeden dwujęzyczny
// słownik `Record<"pl" | "en", ErrorCopy>`, którego parytet wymusza TypeScript.
// ═══════════════════════════════════════════════════════════════════════════

/** Kopia strony 404 z `src/lib/errorCopy.ts` - jedno źródło dla obu języków. */
const NOT_FOUND_COPY = {
  pl: {
    title: "Nie znaleziono strony",
    body: "Strona, której szukasz, nie istnieje lub została przeniesiona.",
    suggestions: "Być może szukasz:",
  },
  en: {
    title: "Page not found",
    body: "The page you're looking for doesn't exist or has been moved.",
    suggestions: "You might be looking for:",
  },
} as const;

/**
 * Ścieżki, których na pewno nie ma. Rozwiązuje je uniwersalny resolver
 * (`src/routes/$.tsx`), bo nie trafiają w żadną trasę statyczną.
 */
const NIEISTNIEJACE: ReadonlyArray<{ path: string; lang: "pl" | "en"; label: string }> = [
  { path: "/nie-ma-takiej-strony-9f2a", lang: "pl", label: "slug jednopoziomowy" },
  { path: "/en/no-such-page-9f2a", lang: "en", label: "slug jednopoziomowy (EN)" },
  { path: "/analizy/nie-ma-takiego-wpisu-9f2a", lang: "pl", label: "ścieżka dwupoziomowa" },
  { path: "/a/b/c/d-9f2a", lang: "pl", label: "ścieżka czteropoziomowa" },
];

for (const { path, lang, label } of NIEISTNIEJACE) {
  test(`nieistniejąca ścieżka daje status 404, nie 500 (${label})`, async ({ request }) => {
    // ZMIERZONE: 500. Patrz nagłówek sekcji - dwa nieosłonięte odczyty
    // w loaderze `$.tsx` po nieudanej rezolucji treści.
    test.fail();
    const res = await request.get(path, { maxRedirects: 0 });
    expect(
      res.status(),
      `${path} zwróciło ${res.status()}. 404 to „nie ma takiej strony"; 500 to ` +
        `„wróć później" i zostawia adres-widmo w indeksie. 200 byłoby soft 404.`,
    ).toBe(404);
  });

  test(`strona 404 renderuje pełny dokument z komunikatem (${label})`, async ({ request }) => {
    // Blokuje ten sam defekt: przy 500 nie ma szablonu 404, więc czytelnik ze
    // starego linku dostaje stronę błędu zamiast podpowiedzi, gdzie szukać.
    test.fail();
    const res = await request.get(path, { maxRedirects: 0 });
    const body = await res.text();
    const copy = NOT_FOUND_COPY[lang];
    expect(body, `${path}: brak tytułu 404 w języku ${lang}`).toContain(copy.title);
    expect(body, `${path}: brak treści komunikatu 404`).toContain(copy.body);
    expect(body, `${path}: 404 bez szkieletu strony`).toContain("<main");
    expect(body, `${path}: 404 bez podpowiedzi nawigacyjnych`).toContain(copy.suggestions);
  });
}

test("nieistniejąca ścieżka nie jest zwracana jako 5xx", async ({ request }) => {
  // Ta asercja jest sednem defektu w jednym zdaniu: rozróżnienie „tego nie ma"
  // od „wróć później" jest tym, co decyduje, czy adres wypadnie z indeksu.
  test.fail();
  const res = await request.get("/nie-ma-takiej-strony-9f2a", { maxRedirects: 0 });
  expect(res.status()).toBeLessThan(500);
});

test("strona 404 nie zaprasza do indeksowania", async ({ page }) => {
  // Strona „nie znaleziono" z `index,follow` to zaproszenie do zaindeksowania
  // szablonu błędu - i dokładnie tak powstają tysiące soft 404 w indeksie.
  test.fail();
  const res = await page.goto("/nie-ma-takiej-strony-9f2a");
  expect(res?.status()).toBe(404);
  const robots = await page.locator('meta[name="robots"]').first().getAttribute("content");
  if (robots) expect(robots).not.toMatch(/(^|,)\s*index\b/);
});

test("resolver adresów nie oddaje 5xx przy martwym backendzie", async ({ request }) => {
  // `$.tsx` NIE JEST na liście `ROUTES` wyżej, choć obsługuje szerszą
  // powierzchnię niż wszystkie te jedenaście tras razem. Po naprawie ten test
  // powinien przejść do tamtej listy.
  test.fail();
  const res = await request.get("/dowolna-strona-cms", { maxRedirects: 5 });
  expect(
    res.status(),
    `resolver /$ zwrócił ${res.status()} - loader rzuca zamiast degradować ` +
      `(dwa nieosłonięte odczyty, patrz nagłówek sekcji).`,
  ).toBeLessThan(500);
});

test("resolver adresów zawsze oddaje dokument, nigdy pustej odpowiedzi", async ({ request }) => {
  // Ten kontrakt trzyma się NAWET przy 500: strona błędu jest renderowana
  // w całości, więc czytelnik nie dostaje białego ekranu. To jedyna dobra
  // wiadomość w tej sekcji i warto ją przypiąć, żeby nie zniknęła przy naprawie.
  const res = await request.get("/dowolna-strona-cms", { maxRedirects: 5 });
  const body = await res.text();
  expect(body.length, "pusta odpowiedź resolvera").toBeGreaterThan(500);
  expect(body, "dokument bez szkieletu aplikacji").toContain("<main");
});
