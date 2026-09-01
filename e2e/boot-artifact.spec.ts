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

test("zbudowany artefakt hydratuje się i ZOSTAJE interaktywny (/cookies)", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e)}`));
  // `console` obok `pageerror` - i to nie jest pas i szelki. Awaria hydratacji
  // integracji router<->query objawia się `console.error`, który `pageerror`
  // przepuszcza; wszystkie istniejące nasłuchy w e2e/ są tylko `pageerror`.
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
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
