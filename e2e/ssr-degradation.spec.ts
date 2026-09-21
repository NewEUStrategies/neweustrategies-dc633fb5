import { test, expect } from "@playwright/test";
import { NIEISTNIEJACE, metaRobotsZHtml, odkodujEncje } from "./helpers/notFoundCopy";

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
  // Dołączony 2026-08-22, zgodnie z tym, co nakazywał komentarz osobnego testu
  // resolvera („po naprawie ten test powinien przejść do tamtej listy").
  // `$.tsx` obsługuje szerszą powierzchnię niż wszystkie pozostałe pozycje tej
  // listy razem, a od naprawy degraduje tak samo jak one.
  { path: "/dowolna-strona-cms", label: "resolver adresów CMS (`$.tsx`)" },
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
// ADRES NIEROZSTRZYGNIĘTY PRZY MARTWYM BACKENDZIE - I DLACZEGO TO NIE JEST 404.
//
// KRONIKA (zostaje, bo bez niej ta sekcja wygląda na kaprys):
//
//   2026-08-21, zmierzone na dev serverze bez poświadczeń Supabase - czyli
//     w DOKŁADNIE tym warunku, dla którego napisano ten plik:
//         GET /nie-ma-takiej-strony-9f2a  ->  HTTP 500
//     Loader `src/routes/$.tsx` po nieudanej rezolucji treści wykonywał DWA
//     nieosłonięte odczyty (równoległe zapytanie o archiwum kategorii i tagu
//     oraz `resolveLegacyPostPath(...)`). Przy niedostępnej bazie rzucały,
//     wyjątek wychodził z loadera, framework oddawał 500. `$.tsx` rozwiązuje
//     KAŻDY publiczny adres, który nie trafił w trasę statyczną, więc awaria
//     bazy zamieniała w 500 nie jedną trasę, a całą powierzchnię treści.
//
//   2026-08-22, naprawa - i to TEN mechanizm ją wykrył. Testy sekcji wisiały
//     na `test.fail()`; po przepisaniu loadera na gramatykę z
//     `src/lib/routing/resolvePublicPath.ts` (dwie fazy, decyzja jako wartość,
//     `notFound()` zamiast nieosłoniętego odczytu) CI zgłosiło „Expected to
//     fail, but passed" dla dziewięciu przypadków i `test.fail()` zdjęto.
//     Kontrakt brzmiał wtedy: przy martwym backendzie nieistniejący adres daje
//     404, bo „adresu NIE MA, więc 404 jest odpowiedzią prawdziwą".
//
//   2026-09-21, TO ZAŁOŻENIE ZOSTAŁO ODRZUCONE ŚWIADOMIE (audyt CWV, defekt
//     W8). Serwer z martwą bazą NIE WIE, czy adresu nie ma - wie tylko, że
//     baza nie odpowiedziała. 404 jest w tym stanie ZGADYWANIEM, a zgaduje na
//     koszt indeksu: fałszywy 404 pod adresem żywego artykułu wypisuje go
//     z wyników wyszukiwania, a powrót zajmuje dni. Od tej naprawy `$.tsx`
//     przy rezolucji ZDEGRADOWANEJ oddaje HTTP 200 z uczciwym komunikatem
//     degradacji, `robots: noindex, nofollow` (gałąź
//     `loaderData?.kind === "degraded"` w `head()`) oraz
//     `Cache-Control: private, no-store`. 404 leci WYŁĄCZNIE z odczytu
//     CZYSTEGO - ta sama reguła, którą kodyfikuje `src/lib/ssr/notFoundIfClean.ts`
//     i którą stosują trasy archiwów.
//
// GDZIE MIESZKA TERAZ KONTRAKT 404. Tam, gdzie da się go rozstrzygnąć
// uczciwie: w suicie z ŻYWĄ bazą (`e2e/user-paths.spec.ts`, job `e2e-seeded`,
// `supabase start` + `E2E_SEEDED=1`). Czysty odczyt oddaje „nie ma takiego
// wiersza", więc status 404, kopia z `src/lib/errorCopy.ts` i podpowiedzi
// nawigacyjne są tam deterministyczne. Tutaj, na poświadczeniach zastępczych,
// ten sam test mierzyłby wyłącznie to, że baza nie odpowiada - i wymuszałby
// na produkcie zachowanie, które kosztuje indeks.
//
// SOFT 404 TO NIE JEST TEN SAM PROBLEM. Zarzut „200 pod nieistniejącym
// adresem wchodzi do indeksu jako soft 404" dotyczy strony, która UDAJE
// poprawną treść. Render zdegradowany niczego nie udaje: mówi wprost, że dane
// nie dojechały, niesie `noindex, nofollow` (crawler nie ma czego
// zaindeksować) i `no-store` (odpowiedź nie zamarza na CDN i nie dożywa
// powrotu bazy). Dla adresu, którego naprawdę nie ma, 404 nadal przychodzi -
// tylko z odczytu, który wie, co mówi.
//
// KOMUNIKAT IDZIE Z JEDNEGO ŹRÓDŁA. Warstwa awaryjna (404, degradacja, error
// boundary) renderuje się poza dostawcą i18next - `src/lib/errorCopy.ts` jest
// świadomym, udokumentowanym wyjątkiem od reguły „tekst z klucza": jeden
// dwujęzyczny słownik `Record<"pl" | "en", ErrorCopy>`, którego parytet
// wymusza TypeScript. Kopię degradacji cytuje `DEGRADED_COPY` wyżej, kopię 404
// - `e2e/helpers/notFoundCopy.ts`.
// ═══════════════════════════════════════════════════════════════════════════

for (const { path, lang, label } of NIEISTNIEJACE) {
  test(`zdegradowana rezolucja oddaje 200, nie 404 (${label})`, async ({ request }) => {
    // BYŁO 500 (nieosłonięte odczyty w loaderze), potem 404, JEST 200.
    // Asercja na `< 500` zostaje obok równości: gdyby kontrakt kiedyś znów się
    // przesunął, komunikat ma rozróżniać „inny kod" od „awaria serwera".
    const res = await request.get(path, { maxRedirects: 0 });
    const status = res.status();
    expect(
      status,
      `${path} zwróciło ${status}. Przy martwym backendzie serwer nie wie, czy ` +
        `tej strony nie ma, czy baza nie odpowiedziała - 404 byłby zgadywaniem ` +
        `na koszt indeksu (W8), a 5xx wypycha adres z wyników tak samo.`,
    ).toBe(200);
    expect(status, `${path}: awaria serwera zamiast degradacji`).toBeLessThan(500);
  });

  test(`zdegradowany dokument mówi prawdę i nie zamarza na brzegu (${label})`, async ({
    request,
  }) => {
    // Druga połowa kontraktu. Sam status 200 byłby TUTAJ groźniejszy niż 404:
    // pusta strona z kodem 200 to soft 404. Dokument musi więc nieść szkielet
    // aplikacji ORAZ uczciwy komunikat degradacji w języku trasy, a nagłówek -
    // zakaz współdzielenia, żeby komunikat awarii nie dożył powrotu bazy
    // w cache'u brzegowym.
    const res = await request.get(path, { maxRedirects: 0 });
    const body = odkodujEncje(await res.text());
    expect(body, `${path}: degradacja bez szkieletu strony`).toContain("<main");
    expect(
      body,
      `${path}: brak uczciwego komunikatu o degradacji (${lang}) - dokument ` +
        `z kodem 200 bez tej kopii jest soft 404.`,
    ).toContain(DEGRADED_COPY[lang]);
    expect(
      res.headers()["cache-control"] ?? "",
      `${path}: render zdegradowany bez no-store trafiłby na CDN i przeżyłby ` + `powrót bazy.`,
    ).toContain("no-store");
  });
}

test("zdegradowana rezolucja nie zaprasza do indeksowania", async ({ request }) => {
  // Przy 404 główną gwarancją był STATUS - wyszukiwarki respektują go same
  // z siebie. Render zdegradowany jedzie z 200, więc status nie broni już
  // niczego: `noindex, nofollow` jest JEDYNĄ rzeczą, która nie pozwala utrwalić
  // komunikatu awarii pod adresem prawdziwego artykułu. Dlatego tu nie ma
  // gałęzi „metatagu nie ma, i to też jest OK".
  for (const { path } of NIEISTNIEJACE) {
    const res = await request.get(path, { maxRedirects: 0 });
    expect(res.status(), `${path} status`).toBe(200);
    const robots = metaRobotsZHtml(await res.text());
    expect(
      robots,
      `${path}: brak meta[name=robots] w zdegradowanym dokumencie - przy 200 ` +
        `nie ma drugiego sygnału, który powstrzymałby indeksowanie.`,
    ).not.toBeNull();
    expect(robots ?? "", `${path}: meta robots "${robots}" nie zawiera noindex`).toContain(
      "noindex",
    );
  }
});

test("nieistniejąca ścieżka nie jest zwracana jako 5xx", async ({ request }) => {
  // Ta asercja jest sednem naprawionego defektu w jednym zdaniu: rozróżnienie
  // „tego nie ma" od „wróć później" decyduje, czy adres wypadnie z indeksu.
  const res = await request.get("/nie-ma-takiej-strony-9f2a", { maxRedirects: 0 });
  expect(res.status()).toBeLessThan(500);
});

test("resolver adresów zawsze oddaje dokument, nigdy pustej odpowiedzi", async ({ request }) => {
  // Ten test ZOSTAJE obok pozycji resolvera na liście `ROUTES`, bo mierzy coś,
  // czego tamta pętla nie mierzy: ROZMIAR dokumentu. `<main>` w odpowiedzi
  // przechodzi też dla szkieletu `<main></main>`, a ten próg łapie strzęp.
  // Historycznie kontrakt trzymał się NAWET przy 500 - to była jedyna dobra
  // wiadomość w tej sekcji i została przypięta, żeby nie zniknęła przy naprawie.
  const res = await request.get("/dowolna-strona-cms", { maxRedirects: 5 });
  const body = await res.text();
  expect(body.length, "pusta odpowiedź resolvera").toBeGreaterThan(500);
  expect(body, "dokument bez szkieletu aplikacji").toContain("<main");
});
