// Przywrócona pozycja okna trzymana, dopóki układ pod nią się nie ustali.
//
// PO CO. Router (`scrollRestoration: true`) zapisuje `scrollX`/`scrollY` okna
// przy `pagehide` i przy wyjściu z wpisu historii, a przywraca je jako liczby
// bezwzględne w `onRendered` (dokument z serwera dostaje je wcześniej także
// ze skryptu na końcu `<main>`). Zapisana liczba pasuje jednak wyłącznie do
// układu, w którym ją zapisano, a zaraz po `onRendered` układ wciąż się
// zmienia:
//  - nagłówek `sticky-shrink` przychodzi z serwera rozwinięty i zwija się
//    dopiero po hydratacji (`Header.tsx`), oddając treści 70% odzyskanej
//    wysokości (`--hdr-gap-keep: 0.3` w `styles.css`): desktop 1350x940 -
//    nagłówek 185,3 -> 146 px, treść podjeżdża o ~27 px;
//  - React 19 odsłania strumieniowane sekcje (`$RC`/`$RV`) partiami, kolejną
//    najwcześniej 300 ms po poprzedniej, więc szkielet z szacunku
//    (`estimateSectionHeight`) bywa podmieniany na treść już PO `onRendered`
//    (zmierzone: sekcja nad widokiem 632 -> 617 px);
//  - szkielety pod widokiem bywają niższe od treści, więc w `onRendered`
//    dokument bywa krótszy niż przy zapisie i `scrollTo` przycina pozycję do
//    jego końca (zmierzone: 2202 -> 1952), a późniejszy wzrost jej nie oddaje.
// Przy dwóch pierwszych zmianach zakotwiczenie przewijania (Chromium, Firefox)
// trzyma w miejscu treść widoczną W TEJ CHWILI - pośrednią, a nie zapisaną -
// i obniża `scrollY` o sumę zmian nad kotwicą. Przeładowanie strony głównej
// w połowie lądowało przez to 15-43 px nad zapisanym miejscem, a przy
// przycięciu 193 px (artefakt + fixture; e2e
// `content-visibility.boot-home.spec.ts`, „przeładowanie w połowie strony").
// Baza sprzed content-visibility (P3.3, d22cf7d6) dawała te same 26-27 px.
//
// MECHANIZM. Po `onRendered`, w którym router przywrócił okno, moduł trzyma
// zapisaną pozycję: zdarzenie `scroll` okna (także korekta zakotwiczenia),
// po którym okno stoi gdzie indziej, ponawia `scrollTo` tej samej pozycji,
// a pozycję przyciętą ponawia każda zmiana rozmiaru dokumentu. Tak samo
// działa natywne przywracanie przeglądarki: ponawia pozycję w trakcie
// wczytywania, dopóki czytelnik sam nie przewinie. Korekta zakotwiczenia
// przychodzi zdarzeniem `scroll` w klatce PO nim, więc jest przewinięciem,
// a nie przesunięciem układu. Wyłączenie zakotwiczenia
// (`overflow-anchor: none`) dokładało wpisy `layout-shift` i nie oddawało
// przyciętej pozycji (odrzucone po pomiarze).
//
// KONIEC TRZYMANIA - cokolwiek przyjdzie pierwsze:
//  - gest czytelnika (`wheel`, `touchstart`, `pointerdown`, `keydown` -
//    przechwytywanie na oknie, przed handlerami strony), więc moduł nigdy nie
//    walczy z przewijaniem użytkownika;
//  - nawigacja routera na inny adres (`onBeforeNavigate` z `hrefChanged`;
//    `router.invalidate()` pod tym samym adresem trzymania nie przerywa)
//    i każde następne `onRendered`;
//  - cisza: `HOLD_QUIET_MS` bez potrzeby korekty, najpóźniej `HOLD_MAX_MS` od
//    przywrócenia. Potem dalsze zmiany układu znów wyrównuje zakotwiczenie.
//
// Tylko klient (`router.tsx`, gałąź `!isServer`). Nasłuch `onRendered`
// routera zapisuje się w jego konstruktorze, więc ten - zapisany po
// `createRouter` - widzi już wykonane przywrócenie.
import { getElementScrollRestorationEntry, type AnyRouter } from "@tanstack/router-core";

/**
 * Cisza (ms) bez korekty, po której trzymanie się kończy. Dłużej niż odstęp
 * między partiami odsłaniania sekcji Reacta (300 ms) i niż zwijanie nagłówka
 * (`--hdr-duration`: 460 ms), które zaczyna się tuż po hydratacji (zmierzone:
 * do ~80 ms po `onRendered` na desktopie).
 */
export const HOLD_QUIET_MS = 1_000;

/** Twardy limit trzymania (ms) od przywrócenia - strona, której układ nie ustaje. */
export const HOLD_MAX_MS = 5_000;

/** Gesty czytelnika, które kończą trzymanie (przewinięcie albo jego zapowiedź). */
const USER_GESTURES = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/** Okno stoi na pozycji co do piksela (`scrollY` bywa ułamkowe przy powiększeniu). */
const at = (x: number, y: number): boolean =>
  Math.abs(window.scrollX - x) < 1 && Math.abs(window.scrollY - y) < 1;

/**
 * Czy router przywrócił właśnie tę pozycję: okno stoi na niej albo - gdy
 * dokument jest jeszcze krótszy - na jego końcu (`scrollTo` przycięte).
 */
function restoredTo(x: number, y: number): boolean {
  if (at(x, y)) return true;
  const maxY = document.documentElement.scrollHeight - window.innerHeight;
  return window.scrollY < y && window.scrollY >= maxY - 1;
}

/** Trzyma okno na (`x`, `y`) do końca trzymania; zwraca funkcję kończącą. */
function hold(x: number, y: number): () => void {
  let quiet = 0;
  // Pozycja przycięta do końca za krótkiego dokumentu. Jego późniejszy wzrost
  // nie wysyła `scroll`, więc korektę wyzwala wtedy zmiana rozmiaru. Bez
  // przycięcia zmianę rozmiaru pomijamy: przychodzi w klatce zakotwiczenia,
  // a korekta w tej samej klatce byłaby przesunięciem układu, nie przewinięciem.
  let short = !at(x, y);
  const pin = () => {
    if (at(x, y)) {
      short = false;
      return;
    }
    window.scrollTo({ left: x, top: y, behavior: "instant" });
    short = !at(x, y);
    window.clearTimeout(quiet);
    quiet = window.setTimeout(release, HOLD_QUIET_MS);
  };
  const resize =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          if (short) pin();
        })
      : null;
  const limit = window.setTimeout(release, HOLD_MAX_MS);
  quiet = window.setTimeout(release, HOLD_QUIET_MS);
  window.addEventListener("scroll", pin, { passive: true });
  for (const type of USER_GESTURES) {
    window.addEventListener(type, release, { capture: true, passive: true });
  }
  resize?.observe(document.documentElement);

  function release(): void {
    window.clearTimeout(quiet);
    window.clearTimeout(limit);
    window.removeEventListener("scroll", pin);
    for (const type of USER_GESTURES) {
      window.removeEventListener(type, release, { capture: true });
    }
    resize?.disconnect();
  }
  return release;
}

/**
 * Po każdym `onRendered`, w którym router przywrócił pozycję okna, trzyma ją,
 * dopóki układ się nie ustali (opis wyżej). Zwraca funkcję odpinającą.
 */
export function holdRestoredScroll(router: AnyRouter): () => void {
  let release: (() => void) | null = null;
  const stop = () => {
    release?.();
    release = null;
  };
  const unsubscribeRendered = router.subscribe("onRendered", () => {
    stop();
    const entry = getElementScrollRestorationEntry(router, {
      getElement: () => window,
      getKey: router.options.getScrollRestorationKey,
    });
    if (!entry || (entry.scrollX <= 0 && entry.scrollY <= 0)) return;
    if (!restoredTo(entry.scrollX, entry.scrollY)) return;
    release = hold(entry.scrollX, entry.scrollY);
  });
  const unsubscribeNavigate = router.subscribe("onBeforeNavigate", (event) => {
    if (event.hrefChanged) stop();
  });
  return () => {
    stop();
    unsubscribeRendered();
    unsubscribeNavigate();
  };
}
