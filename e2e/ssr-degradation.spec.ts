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
