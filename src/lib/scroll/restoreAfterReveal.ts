// PRZYWRÓCENIE PRZEWINIĘCIA PO PÓŹNYM ODSŁONIĘCIU SEGMENTÓW STRUMIENIA SSR.
//
// OBJAW. Przeładowanie (albo powrót bez bfcache) w połowie strony lądowało losowo 140-195 px
// nad miejscem czytania (`e2e/content-visibility.boot-home.spec.ts`, „przeładowanie w połowie
// strony": ~2/20 przebiegów, desktop `scrollY` 2202 -> 2009, telefon 3185 -> 3018). cv jest
// wtedy zdjęte przez strażnika (`html[data-cv-off]`), a skrypt lądowania na kotwicy kończy
// się na pustym `location.hash` - żadne z nich nie bierze udziału.
//
// PRZYCZYNA (odtworzona deterministycznie). Router przywraca okno ABSOLUTNYM `scrollTo(y)`
// zapisanym przy `pagehide` (router-core `scroll-restoration.js`): skryptem inline na końcu
// `<main>` (zawsze na szkieletach - segmenty sekcji są dalej w dokumencie) i JEDEN raz przy
// hydratacji (`onRendered`). Zapisane `y` pochodzi z układu z treścią, a sekcje z danymi
// czekają na serwerze za granicą Suspense ze szkieletem `estimateSectionHeight`
// (`lib/builder/sectionStreaming.tsx`), którego wysokość różni się od treści. React 19.2
// odsłania segmenty (`$RC` -> `$RV`) partiami: pierwsza w najbliższej klatce, a gdy jakaś klatka
// już się namalowała (`$RT`), każda następna dopiero `setTimeout`-em >= 300 ms po poprzedniej -
// często PO hydratacji. Dwa tryby porażki, oba zmierzone:
//  - szkielet WYŻSZY od treści: przywrócenie trafia, a odsłonięcie zmniejsza sekcje nad widokiem;
//    zakotwiczenie przewijania Chromium trzyma w miejscu to, co było widać NA SZKIELETACH,
//    więc `scrollY` spada o różnicę (desktop: 151 + 15 = 166 px);
//  - szkielet NIŻSZY od treści: strona jest przy hydratacji za krótka, `scrollTo(2202)`
//    zostaje PRZYCIĘTY (do 1953), a późniejszy wzrost strony zakotwiczenie zachowuje.
// Nikt już potem nie przewija. Kolejność zależy od tego, czy parser zdążył przed pierwszą
// klatką (porcje sieci, obciążenie CPU) - stąd losowość.
//
// CO ROBI. Przy PIERWSZYM `onRendered` (hydratacja; słuchacz zapisany po słuchaczu router-core
// z konstruktora routera, więc biegnie po jego przewinięciu): gdy router miał wpis OKNA dla
// tego wpisu historii (czyli właśnie go przywrócił - przy `scrollRestoration: true` router
// przywraca okno przy hydratacji zawsze, gdy wpis jest, także z `#` w adresie), a w `<body>`
// czeka jeszcze segment strumienia (`<div hidden id="S:…">`, który `$RV` usuwa), czeka na
// usunięcie OSTATNIEGO z nich i powtarza przewinięcie routera z TEGO SAMEGO wpisu - w tym
// samym zadaniu co odsłonięcie, przed malowaniem. Wpis, a nie `scrollY` zapamiętany po
// przywróceniu routera: w trybie przyciętym ten drugi już jest zły. Segmenty odsłonięte przed
// hydratacją (zwykły przypadek), pierwsze wejście (brak wpisu) i render czysto kliencki
// (nawigacja SPA - brak segmentów) = nic do zrobienia, bez obserwatora.
//
// KIEDY USTĘPUJE (powtórzenie przywrócenia ma sens tylko wtedy, gdy nikt go nie ruszył):
//  - użytkownik: kółko, przesunięcie palcem, klawisz i KAŻDE wciśnięcie wskaźnika. Inaczej niż
//    `fragmentLandingScript` (tam klik w zgodę na cookies odbierał lądowanie, które było
//    jedynym przewinięciem): tu przerwanie kosztuje najwyżej dzisiejsze zachowanie, a
//    wciśnięcie łapie przeciąganie paska przewijania, autoprzewijanie środkowym przyciskiem
//    i zaznaczanie z przewijaniem - zdarzeń, których przewinięcie kółkiem nie daje;
//  - nawigacja: każda zmiana wpisu historii (inny klucz przywracania - link, wstecz/dalej,
//    zmiana `#`) kończy czekanie od razu. Klik w odnośnik łapie już `pointerdown`, ale przycisk
//    „Wstecz" przeglądarki i przekierowanie z kodu nie dają na stronie żadnego zdarzenia - bez
//    tego strażnika nowa strona dostawała pozycję starej (zmierzone: `/regulamin` na 2178).
//    Sprawdzenie dopiero przy odsłonięciu nie wystarcza: po „tam i z powrotem" klucz byłby
//    znów ten sam, a router przywróciłby już nowszą pozycję;
//  - aplikacja przejęła fragment: `smoothScrollToAnchor` ustawia `window.__nesAnchorOwned`
//    (ta sama flaga co w `fragmentLandingScript`; literał, bo moduł skryptu z tekstem nie
//    wchodzi do bundla). Skrypt lądowania na kotwicy sam ustępuje, gdy wpis okna istnieje -
//    a bez wpisu ten moduł nic nie robi, więc oba nigdy nie przewijają tej samej strony;
//  - sufit `RESTORE_AFTER_REVEAL_MAX_MS` od hydratacji (zmierzone opóźnienie ostatniej partii:
//    ~300-450 ms; segment, którego nikt nie odsłoni - zerwany strumień - nie trzyma obserwatora).
// Selektor segmentu to format React Fizz (`div[hidden][id^="S:"]`, ten sam w testach e2e):
// gdyby React go zmienił, moduł po cichu nic nie robi i wraca dzisiejsze zachowanie.
//
// Dowód w prawdziwej przeglądarce (odsłonięcie wstrzymane do gotowości aplikacji, także
// z nawigacją przed odsłonięciem): `e2e/content-visibility.boot-home.spec.ts`.
import {
  defaultGetScrollRestorationKey,
  getElementScrollRestorationEntry,
  type AnyRouter,
} from "@tanstack/router-core";

/** Segment strumienia React Fizz czekający na odsłonięcie (`$RV` usuwa go z `<body>`). */
export const PENDING_STREAM_SEGMENT = 'body>div[hidden][id^="S:"]';

/** Sufit czekania na ostatnie odsłonięcie, liczony od hydratacji (ms). */
export const RESTORE_AFTER_REVEAL_MAX_MS = 5_000;

/** Zamiar użytkownika, po którym powtórzenie przywrócenia byłoby walką z czytelnikiem. */
export const RESTORE_AFTER_REVEAL_STOP_EVENTS = [
  "wheel",
  "touchmove",
  "keydown",
  "pointerdown",
] as const;

const anchorOwned = () => !!(window as Window & { __nesAnchorOwned?: boolean }).__nesAnchorOwned;

export function installRestoreAfterReveal(router: AnyRouter): void {
  // Ten sam klucz co przywracanie routera (`setupScrollRestoration`).
  const getKey = router.options.getScrollRestorationKey ?? defaultGetScrollRestorationKey;
  const off = router.subscribe("onRendered", () => {
    off();
    const key = getKey(router.latestLocation);
    const entry = getElementScrollRestorationEntry(router, { getKey, getElement: () => window });
    if (!entry || anchorOwned() || !document.querySelector(PENDING_STREAM_SEGMENT)) return;
    const observer = new MutationObserver(() => {
      if (document.querySelector(PENDING_STREAM_SEGMENT)) return;
      stop();
      if (!anchorOwned()) scrollTo(entry.scrollX, entry.scrollY);
    });
    const offNavigate = router.subscribe("onBeforeNavigate", (event) => {
      if (getKey(event.toLocation) !== key) stop();
    });
    const timer = setTimeout(stop, RESTORE_AFTER_REVEAL_MAX_MS);
    function stop() {
      observer.disconnect();
      offNavigate();
      clearTimeout(timer);
      for (const type of RESTORE_AFTER_REVEAL_STOP_EVENTS) removeEventListener(type, stop, true);
    }
    for (const type of RESTORE_AFTER_REVEAL_STOP_EVENTS) {
      addEventListener(type, stop, { capture: true, passive: true });
    }
    // Segmenty są dziećmi `<body>` (React dopisuje je za powłoką), więc wystarczy `childList`.
    observer.observe(document.body, { childList: true });
  });
}
