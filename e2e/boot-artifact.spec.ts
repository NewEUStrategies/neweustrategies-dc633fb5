// BOOT-TEST NA ARTEFAKCIE PRODUKCYJNYM. Uruchamiany WYŁĄCZNIE przez
// `playwright.artifact.config.ts` (`bun run test:e2e:artifact`), nigdy przez
// zwykłe `bun run test:e2e` - tam nie ma zbudowanego serwera.
//
// CO TEN PLIK ZAMYKA. Jedyną klasę awarii, która w tym repozytorium REALNIE
// WYSTĄPIŁA i miała pełny promień rażenia: 2026-07-20, cykl chunków vendorowych
// wywrócił kolejność inicjalizacji CJS-interop, boot klienta padł PRZED
// `hydrateRoot` i strona została statycznym SSR-em. Bez żadnego błędu widocznego
// dla użytkownika - przyciski i linki po prostu nie reagowały.
//
// DLACZEGO ISTNIEJĄCE BRAMKI TEGO NIE ŁAPIĄ, każda z osobna:
//   * `check:chunks` łapie WYŁĄCZNIE CYKLE. Artefakt bez cyklu też może paść
//     przed hydratacją (brakujący eksport, rzut w inicjalizacji vendora);
//   * dev-server, na którym stoi cała reszta suity e2e, NIE MA CHUNKÓW
//     z definicji, więc nie potrafi odtworzyć tej klasy w ogóle;
//   * `e2e/ssr-completeness.spec.ts` sprawdza KOMPLETNOŚĆ SSR-owego HTML-a
//     (jeden niepusty `<h1>`, `main#main-content`, `<footer>`, język) - i jego
//     własny komentarz mówi wprost, że „SSR może być kompletny, a strona i tak
//     martwa". Wszystkie jego asercje są spełnione przez w pełni wyrenderowany,
//     całkowicie martwy dokument;
//   * wszystkie SZEŚĆ nasłuchów `page.on(` w katalogu `e2e/` to `pageerror` -
//     zero `console`. Sprawdzone: przy martwej hydratacji ta konkretna awaria
//     objawia się `console.error`, którego `pageerror` nie widzi.
//
// DLATEGO TEN TEST WYKONUJE INTERAKCJĘ, a nie tylko sprawdza brak błędu.
//
// WYBÓR POWIERZCHNI: `/cookies`. Trasa plikowa BEZ zależności od danych z
// backendu (ta sama, którą `ssr-completeness` traktuje jako przypadek
// backend-agnostyczny), jej przyciski są RENDEROWANE SERWEROWO, a stan, który
// mutują, jest LOKALNY (localStorage + ciasteczko zgody) - zero Supabase, pełna
// determinacja. SSR renderuje akapit „nie zapisano jeszcze wyboru", bo stan zgód
// czyta się z przeglądarki; klik po hydratacji zamienia go na siatkę kategorii.
// Martwy dokument pokazuje ten sam przycisk, tylko klik jest no-opem.
import { expect, test } from "@playwright/test";

/** Kopia PL z `src/routes/cookies.tsx` - powierzchnia publiczna renderuje PL na "/". */
const UNDECIDED = "Nie zapisano jeszcze wyboru";
const ACCEPT_ALL = "Akceptuj wszystkie";
const GRANTED = "Włączone";
/** Cztery kategorie zgód w `CATEGORIES` - tyle kafelków musi pokazać stan po kliku. */
const CATEGORY_COUNT = 4;

/**
 * JEDYNY TOLEROWANY `console.error` - DEFEKT BIBLIOTEKI, NIE TEJ APLIKACJI.
 *
 * `@tanstack/router-ssr-query-core` (dist/esm/index.js:93-95) czyta strumień
 * zapytań w pętli, w której `hydrate(queryClient, value)` stoi PRZED
 * `if (done) return`. Ostatni odczyt domkniętego strumienia to z definicji
 * `{done: true, value: undefined}`, a `hydrate(qc, undefined)` czyta
 * `dehydratedState.mutations` i rzuca `TypeError`. Rzut leci do `.catch`
 * biblioteki, który loguje ten komunikat - na KAŻDYM dokumencie.
 *
 * DLACZEGO TO WOLNO PRZEPUŚCIĆ, a nie jest to rozluźnienie bramki: rzut wypada
 * na odczycie TERMINALNYM, więc wszystkie prawdziwe porcje strumienia są już
 * zhydratowane i nie ginie ani jedno zapytanie. Wyjątek jest przy tym WĄSKI -
 * wymaga OBU fragmentów naraz - a każdy inny `console.error` nadal wywraca ten
 * test, bo po to on istnieje.
 *
 * WYJĄTEK NIE PRZEŻYJE DEFEKTU: przyczyna jest przypięta w
 * `src/__tests__/router.test.tsx` („integracja router<->query: terminalny odczyt
 * strumienia") asercją, że biblioteka NADAL woła `hydrate` przed sprawdzeniem
 * `done`. Gdy to się zmieni, tamten test zapali się sam i będzie sygnałem do
 * ZDJĘCIA tego wyjątku. Naprawa obejściem u nas (podstawiony czytnik, który
 * nigdy się nie rozstrzyga) to zmiana zachowania produkcyjnego dla zgaszenia
 * logu i DECYZJA NALEŻY DO CZŁOWIEKA - patrz komentarz w tamtym teście.
 */
const TOLERATED_LIBRARY_ERROR = ["Error reading query stream:", "mutations"] as const;

function isToleratedLibraryError(text: string): boolean {
  return TOLERATED_LIBRARY_ERROR.every((fragment) => text.includes(fragment));
}

/**
 * DRUGI I OSTATNI WYJĄTEK: TRANSPORT DO OBCEGO HOSTA.
 *
 * Ten test jedzie po artefakcie BEZ BACKENDU - i w CI, i tutaj `SUPABASE_URL`
 * to `https://placeholder.supabase.co`, host, który z konstrukcji nie istnieje.
 * Zmierzone na artefakcie: od dwóch do czterech żądań na ten host kończy się
 * `net::ERR_TUNNEL_CONNECTION_FAILED` (`site_settings`, `post_layout_settings`,
 * `newsletter_settings`, `builder_popups`), a Chromium loguje każde jako
 * `console.error`. LICZBA JEST NIEDETERMINISTYCZNA - zależy od tego, ile
 * zapytań zdąży wystartować - więc wyjątek MUSI iść po pochodzeniu, nie po
 * liczbie.
 *
 * GRANICA JEST WĄSKA I TO JEST W NIEJ NAJWAŻNIEJSZE. Przepuszczamy WYŁĄCZNIE
 * awarie transportu (`net::ERR_*`) do hosta INNEGO niż ten, z którego zszedł
 * dokument. Brakujący chunk aplikacji to `Failed to load resource` na URL-u
 * WŁASNEGO pochodzenia (albo status HTTP, nie `net::ERR_*`) - i to nadal
 * wywraca ten test, bo dokładnie po to on istnieje: awaria pobrania chunku
 * bootu jest tą klasą, dla której go napisano.
 */
function isForeignTransportError(text: string, url: string, origin: string): boolean {
  if (!text.includes("net::ERR_")) return false;
  if (url === "") return false;
  try {
    return new URL(url).origin !== origin;
  } catch {
    return false;
  }
}

test("zbudowany artefakt hydratuje się i ZOSTAJE interaktywny (/cookies)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e)}`));
  // `console` obok `pageerror` - i to nie jest pas i szelki. Awaria hydratacji
  // integracji router<->query objawia się `console.error`, który `pageerror`
  // przepuszcza; wszystkie istniejące nasłuchy w e2e/ są tylko `pageerror`.
  const appOrigin = new URL(test.info().project.use.baseURL ?? "http://127.0.0.1").origin;
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const text = m.text();
    if (isToleratedLibraryError(text)) return;
    if (isForeignTransportError(text, m.location().url, appOrigin)) return;
    errors.push(`console.error: ${text}`);
  });

  await page.goto("/cookies", { waitUntil: "load" });

  // Banner zgód niesie BLIŹNIACZY przycisk o tej samej nazwie dostępnej, więc
  // bez zawężenia do treści strony `getByRole` łamie tryb strict.
  const main = page.locator("#main-content");
  const undecided = main.getByText(UNDECIDED, { exact: false });
  const accept = main.getByRole("button", { name: ACCEPT_ALL });

  // 1. SSR DOWIÓZŁ TREŚĆ. Bez tego reszta testu mierzyłaby pustą stronę.
  await expect(undecided).toBeVisible();
  await expect(accept).toBeVisible();

  // 2. Wartownik „bez pełnego przeładowania": nawigacja dokumentu skasowałaby
  // tę zmienną, więc jej obecność na końcu dowodzi, że interakcja obsłużyła się
  // NA KLIENCIE, a nie przez przypadkowy round-trip do serwera.
  await page.evaluate(() => {
    (window as unknown as { __nesBootProbe?: number }).__nesBootProbe = 1;
  });

  // 3. BRAMA HYDRATACJI. Flaga jest ustawiana synchronicznie w efekcie
  // montowania korzenia (`lib/watchdog/appReady`) - martwy dokument nie ma jak
  // jej spełnić. Do 2026-09-01 była zamknięta w leniwym chunku podglądu, więc
  // na publikowanej stronie NIE ISTNIAŁ żaden sygnał tego rodzaju.
  await page.waitForFunction(
    () => (window as unknown as { __nesAppReady?: boolean }).__nesAppReady === true,
    undefined,
    { timeout: 60_000 },
  );

  // 4. Sonda bootu (klasyczny skrypt w `<head>`, pierwszy w dokumencie) nie
  // zbuforowała ani jednego błędu - łapie też rzut w chunku vendorowym, czyli
  // to, czego żaden handler z modułu nie zobaczy.
  const bootErrors = await page.evaluate(
    () => (window as unknown as { __nesBootErrors?: unknown[] }).__nesBootErrors ?? [],
  );
  expect(bootErrors, JSON.stringify(bootErrors)).toHaveLength(0);
  const bootDead = await page.evaluate(
    () => (window as unknown as { __nesBootDead?: number }).__nesBootDead,
  );
  expect(bootDead, "sonda uznała boot za martwy").toBeUndefined();

  // 5. INTERAKTYWNOŚĆ - sedno tego testu. Handler istnieje TYLKO po hydratacji.
  await accept.click();
  await expect(undecided).toHaveCount(0);
  await expect(main.getByText(GRANTED)).toHaveCount(CATEGORY_COUNT);

  // 6. Skutek uboczny handlera poza Reactem: ciasteczko zgody.
  const cookieNames = (await page.context().cookies()).map((c) => c.name);
  expect(cookieNames).toContain("nes_cookie_consent");

  // 7. To się stało bez pełnego przeładowania dokumentu.
  expect(
    await page.evaluate(() => (window as unknown as { __nesBootProbe?: number }).__nesBootProbe),
  ).toBe(1);

  expect(errors, errors.join(" | ")).toHaveLength(0);
});

// ── DETEKTOR NIEZGODNOŚCI HYDRATACJI (mismatch) ─────────────────────────────
//
// ROZSTRZYGNIĘCIE, KTÓRE TA SEKCJA ZAPISUJE. Audyt wydania 8 twierdził, że
// detektora niezgodności hydratacji nie ma w repozytorium wcale, a commit
// 2fa8eb826 nazywa się „Boot-test na artefakcie produkcyjnym i detekcja
// martwej hydratacji". Obie rzeczy są prawdziwe, bo to DWA RÓŻNE detektory:
//
//   * MARTWA HYDRATACJA („strona się nie uruchomiła") - ISTNIEJE i jest
//     zbudowana świadomie: flaga `window.__nesAppReady` (`lib/watchdog/appReady`,
//     czekana w tym pliku), sonda `__nesBootErrors`/`__nesBootDead`
//     (`lib/observability/bootProbeScript`), KLIK po hydratacji w teście wyżej
//     i próg `MAX_READY_MS` w `boot-timing.spec.ts`;
//   * NIEZGODNOŚĆ („uruchomiła się, ale React przerysował HTML z serwera") -
//     NIE ISTNIAŁA jako detektor. Była łapana WYŁĄCZNIE UBOCZNIE, przez
//     ogólne `expect(errors, ...).toHaveLength(0)` (ten plik, :152 i :172,
//     oraz `boot-timing.spec.ts`), i to z dwiema wadami: (a) nic nie nazywało
//     tej klasy, więc komunikat awarii w artefakcie produkcyjnym brzmiałby
//     „Minified React error #418" i nie powiedziałby czytelnikowi NIC;
//     (b) nie istniał ŻADEN dowód, że ta klasa jest w ogóle przechwytywana -
//     a detektor bez takiego dowodu jest napisem.
//
// SPROSTOWANIE ODNIESIENIA: zlecenie wydania 9 wskazuje wzorzec
// `expect(errors, errors.join(" | ")).toHaveLength(0)` w
// „boot-artifact.spec.ts:422". Ten plik miał wtedy 173 wiersze - wzorzec stoi
// w NIM w :172, a w :422 stoi w `boot-timing.spec.ts`. Numer pochodzi z tego
// drugiego pliku.
//
// JAK NIEZGODNOŚĆ DOCHODZI DO TESTU. React 19 zgłasza ją jako błąd
// ODZYSKIWALNY: `defaultOnRecoverableError` woła `reportGlobalError`
// (react-dom-client, `defaultOnRecoverableError`), co dyspozycjonuje globalne
// zdarzenie `error` - czyli trafia w `page.on("pageerror")`, a NIE w
// `console.error`. Detektor musi więc czytać OBA kanały; czyta oba.
//
// DLACZEGO KLASYFIKATOR MUSI ZNAĆ POSTAĆ ZMINIFIKOWANĄ. Artefakt serwuje
// produkcyjny `react-dom` (sprawdzone: w `.output/public/assets/*.js` nie ma
// ANI JEDNEGO wystąpienia „Hydration failed because the server rendered", a
// `vendor-react-*.js` zawiera odsyłacz `react.dev/errors`). Komunikat ma tam
// postać `Minified React error #NNN`, więc dopasowanie po tekście z builda
// deweloperskiego łapałoby wyłącznie tryb dev - czyli nigdy w CI.
//
// ZMIERZONE, NIE ZAŁOŻONE (2026-09-03, react/react-dom 19.2.5, artefakt
// `build:smoke`). Wstrzyknięcie rozjazdu daje DOKŁADNIE ten komunikat, i to
// kanałem `pageerror`, nie `console.error`:
//
//   pageerror: Error: Minified React error #418; visit
//   https://react.dev/errors/418?args[]=text&args[]= for the full message [...]
//
// Potwierdzone też ZACHOWANIE, które czyni tę klasę groźną: sonda pokazała
// `domHasInjected=false` przy `domHasOriginal=true`, czyli React WYRZUCIŁ HTML
// z serwera i przerysował poddrzewo wersją kliencką. Strona po tym ŻYJE - więc
// żadna z asercji żywotności tego pliku by tego nie zauważyła.
const HYDRATION_MISMATCH_MARKERS = [
  // Postać deweloperska (dev `react-dom`, dla uruchomień lokalnych).
  "hydration failed because the server rendered",
  "a tree hydrated but some attributes",
  "text content does not match",
  "hydrating but some attributes",
  // Postać PRODUKCYJNA - kody błędów hydratacji Reacta.
  "minified react error #418",
  "minified react error #423",
  "minified react error #425",
  "react.dev/errors/418",
  "react.dev/errors/423",
  "react.dev/errors/425",
] as const;

export function isHydrationMismatch(text: string): boolean {
  const lower = text.toLowerCase();
  return HYDRATION_MISMATCH_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Nasłuch obu kanałów naraz. Zwraca tablicę, którą test asertuje - ten sam
 * kształt, co `errors` wyżej, żeby komunikat awarii wyglądał tak samo.
 */
function watchHydrationMismatches(page: import("@playwright/test").Page): string[] {
  const found: string[] = [];
  page.on("pageerror", (e) => {
    const text = String(e);
    if (isHydrationMismatch(text)) found.push(`pageerror: ${text}`);
  });
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    if (isHydrationMismatch(m.text())) found.push(`console.error: ${m.text()}`);
  });
  return found;
}

test("artefakt hydratuje się BEZ niezgodności serwer<->klient (/cookies)", async ({ page }) => {
  const mismatches = watchHydrationMismatches(page);

  await page.goto("/cookies", { waitUntil: "load" });
  await page.waitForFunction(
    () => (window as unknown as { __nesAppReady?: boolean }).__nesAppReady === true,
    undefined,
    { timeout: 60_000 },
  );

  // Niezgodność jest błędem ODZYSKIWALNYM: strona po niej ŻYJE, tylko React
  // wyrzucił HTML z serwera i przerysował poddrzewo na kliencie. Czyli
  // wszystkie asercje testu żywotności wyżej byłyby spełnione, a czytelnik
  // i tak dostałby migotanie i stracony SSR. Dlatego to jest osobna asercja,
  // a nie dodatek do tamtej.
  expect(mismatches, mismatches.join(" | ")).toHaveLength(0);
});

test("detektor niezgodności ŁAPIE wstrzykniętą niezgodność (kontrola negatywna)", async ({
  page,
}) => {
  // KONTROLA NEGATYWNA DETEKTORA. Bez niej asercja wyżej jest napisem: nie
  // wiadomo, czy przechodzi, bo niezgodności nie ma, czy bo detektor jej nie
  // widzi. Ten test PSUJE dokument w locie i wymaga, żeby detektor zapalił.
  //
  // WSTRZYKNIĘCIE IDZIE PRZEZ `page.route` NA DOKUMENCIE, nie przez
  // `addInitScript`: mutujemy WYŁĄCZNIE HTML, który zszedł z serwera, a klient
  // renderuje swoją (niezmienioną) wersję - czyli dokładnie asymetria, którą
  // React nazywa niezgodnością. Cel podmiany jest wybrany świadomie: akapit
  // „nie zapisano jeszcze wyboru" jest RENDEROWANY SERWEROWO i renderuje się
  // tak samo w pierwszym przejściu klienta (stan zgód czyta się z przeglądarki
  // dopiero w efekcie), więc podmiana jego treści gwarantuje rozjazd.
  const INJECTED = "WSTRZYKNIETA-NIEZGODNOSC-HYDRATACJI";
  await page.route(
    (url) => url.pathname === "/cookies",
    async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      // Jeżeli marker nie występuje, wstrzyknięcie nie zaszło - i test MUSI
      // to zgłosić, zamiast przejść na braku niezgodności.
      expect(body, "SSR nie dowiózł akapitu, w który wstrzykujemy rozjazd").toContain(UNDECIDED);
      await route.fulfill({ response, body: body.replaceAll(UNDECIDED, INJECTED) });
    },
  );

  const mismatches = watchHydrationMismatches(page);
  await page.goto("/cookies", { waitUntil: "load" });

  // ŚWIADOMIE NIE CZEKAMY NA `__nesAppReady`, i to jest poprawka Z POMIARU.
  // Pierwsza wersja tego testu czekała na flagę gotowości i padała na
  // `TimeoutError` przy uruchomieniu SAMEGO tego testu (przechodziła tylko
  // w pełnym przebiegu, czyli była zielona PRZYPADKIEM). Przyczyna jest
  // merytoryczna, nie techniczna: wstrzyknięty rozjazd może zatrzymać boot
  // ZANIM efekt korzenia ustawi flagę, więc warunek „poczekaj na gotowość"
  // zakłada dokładnie to, czego ten test celowo psuje. Przedmiotem dowodu jest
  // TYLKO to, czy detektor zobaczył niezgodność - i na to czekamy.
  await expect
    .poll(() => mismatches.length, {
      message:
        "detektor niezgodności NIE zapalił na wstrzykniętym rozjeździe - czyli asercja w teście obok nie dowodzi niczego",
      timeout: 30_000,
    })
    .toBeGreaterThan(0);

  // Komunikat wypisany w logu: dzięki temu wiadomo, KTÓRY marker zadziałał,
  // gdy React zmieni postać swojego błędu w kolejnej wersji.
  console.log(`[hydration-mismatch] ${JSON.stringify(mismatches)}`);

  // I DRUGA POŁOWA DOWODU: detektor jest WĄSKI. Gdyby `isHydrationMismatch`
  // przepuszczał cokolwiek, ten test też by przechodził - a bramka obok
  // świeciłaby czerwono przy każdym niezwiązanym błędzie.
  expect(isHydrationMismatch("TypeError: fetch failed")).toBe(false);
  expect(isHydrationMismatch("net::ERR_TUNNEL_CONNECTION_FAILED")).toBe(false);
  expect(isHydrationMismatch("Error reading query stream: mutations")).toBe(false);
  expect(isHydrationMismatch("Minified React error #418")).toBe(true);
});
