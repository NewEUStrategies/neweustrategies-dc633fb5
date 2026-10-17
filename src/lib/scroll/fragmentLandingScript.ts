// LĄDOWANIE NA KOTWICY PRZY WEJŚCIU, gdy cel odsłania się PÓŹNO (granica strumienia SSR).
//
// OBJAW. Wejście pod adres z fragmentem (`/#kontakt`, link z menu, udostępniony nagłówek)
// zostawało na górze strony, choć cel istniał: `scrollY` 0, cel ~2400 px niżej (CI
// 38982787871, `content-visibility.boot-home.spec.ts`, desktop - test sprawdza właśnie to).
//
// PRZYCZYNA (odtworzona deterministycznie, nie zgadnięta). Cel leżał w segmencie granicy
// Suspense strumieniowanym przez serwer (`<div hidden id="S:c">`), który React 19.2 odsłania
// skryptem `$RC` W PARTIACH: pierwsza partia w najbliższej klatce, każda następna dopiero
// `setTimeout`-em co najmniej 300 ms po poprzedniej (w oknie 2,0-2,3 s od startu nawigacji -
// do 2,3 s). Przewinięcia do celu próbują wyłącznie dwie strony, obie JEDEN raz w czasie:
//  - przeglądarka: Chromium trzyma kotwicę fragmentu do zakończenia wczytywania dokumentu;
//    cel w `[hidden]` nie ma pudełka, a po `load` kotwica już nie wraca;
//  - router: skrypt przywracania TanStacka na końcu `<main>` (cel jeszcze nie sparsowany)
//    i `onRendered` przy hydratacji (`router-core` `scroll-restoration.js`:
//    `document.getElementById(hash)?.scrollIntoView(...)`) - cel w ukrytym segmencie
//    `scrollIntoView` ignoruje.
// Gdy odsłonięcie wypada po `load` i po hydratacji (szybkie urządzenie, dokument z L1 cache
// w jednym kawałku, partia odsłonięć w drugim i dalszym takcie), nikt już nie przewija.
// Opóźnienie `$RV` (funkcji odsłaniającej partię) o 1,5 s daje na artefakcie ten sam wynik
// co CI za każdym razem; bez opóźnienia - lądowanie (`e2e/fragment-landing.boot-home.spec.ts`).
//
// CO ROBI SKRYPT (ES5, jedno IIFE bez zmiennych globalnych, inline w `<head>` korzenia):
//  1. Tylko wejście z fragmentem w adresie (`location.hash` dłuższy niż `#`). Fragment
//     tekstowy (`#:~:text=`) Chromium wycina z `location`, a przewija do niego sam.
//  2. NIE walczy z przywróceniem przewinięcia: gdy TanStack ma wpis okna dla tego wpisu
//     historii (`sessionStorage["tsr-scroll-restoration-v1_3"][history.state.__TSR_key]
//     .window`), router przywraca TĘ pozycję i celowo pomija fragment - skrypt też.
//     Klucz magazynu to `storageKey` z `@tanstack/router-core` (zgodność pilnuje test),
//     ten sam odczyt ma strażnik cv w `BuilderRenderer.tsx`.
//  3. Co 100 ms (bez odczytu układu: `getElementById` + `closest`) czeka, aż cel istnieje
//     POZA ukrytym segmentem i dokument jest wczytany (`readyState === "complete"`) - wtedy
//     przeglądarka skończyła już własną próbę. W najbliższej klatce JEDEN odczyt położenia:
//     cel poza widokiem -> `scrollIntoView()` (domyślne wyrównanie, jak router przy
//     `hashScrollIntoViewOptions ?? true`), cel w widoku -> nic. Potem koniec.
//  4. Ustępuje użytkownikowi: pierwsze `wheel`/`touchstart`/`keydown`/`pointerdown` kończy
//     czekanie (nie skaczemy z miejsca, do którego ktoś już przewinął), zmiana fragmentu też.
//     Sufit 80 prób (8 s) - cel, który się nie pojawi (literówka w adresie), nie trzyma pętli.
// Koszt: kilkaset bajtów inline i jedno sprawdzenie DOM co 100 ms przez czas wczytywania,
// wyłącznie na wejściach z fragmentem; zwykłe wejście kończy się na pierwszym warunku.
//
// Literał (bramka `check:dangerous-html`); w przeglądarce `__root.tsx` przepisuje ten sam
// napis z już wykonanego węzła `script[data-nes-fragment-landing]`, więc tekst nie trafia
// do bundla klienta.

/** Atrybut węzła skryptu (render korzenia i odczyt treści przy hydratacji). */
export const FRAGMENT_LANDING_ATTR = "data-nes-fragment-landing";

/** Klucz magazynu przywracania przewinięcia TanStacka (`storageKey` w `@tanstack/router-core`). */
export const TSR_SCROLL_STORAGE_KEY = "tsr-scroll-restoration-v1_3";

/** Odstęp i sufit prób (100 ms x 80 = 8 s; odsłonięcia React 19.2 kończą się do ~2,3 s). */
export const FRAGMENT_LANDING_POLL_MS = 100;
export const FRAGMENT_LANDING_MAX_POLLS = 80;

export const FRAGMENT_LANDING_SCRIPT =
  "(function(d){try{var h=location.hash;if(h.length<2)return;" +
  "try{var k=(history.state||{}).__TSR_key;if(k&&(JSON.parse(sessionStorage.getItem(" +
  `"${TSR_SCROLL_STORAGE_KEY}")||"{}")[k]||{}).window)return}catch(x){}` +
  'var r=h.slice(1),n=0,s=0,E=["wheel","touchstart","keydown","pointerdown"];' +
  "function z(){s=1;for(var i=0;i<E.length;i++)removeEventListener(E[i],z,!0)}" +
  "for(var i=0;i<E.length;i++)addEventListener(E[i],z,{capture:!0,passive:!0});" +
  "function g(){var e=d.getElementById(r);if(!e)try{e=d.getElementById(decodeURIComponent(r))}" +
  "catch(x){}return e}" +
  `function t(){if(s)return;if(location.hash!==h||++n>${FRAGMENT_LANDING_MAX_POLLS})return z();` +
  'var e=g();if(e&&d.readyState=="complete"&&!e.closest("[hidden]"))' +
  "return requestAnimationFrame(function(){if(s)return;z();var y=e.getBoundingClientRect().top;" +
  "(y<0||y>=innerHeight)&&e.scrollIntoView()});" +
  `setTimeout(t,${FRAGMENT_LANDING_POLL_MS})}t()}catch(x){}})(document)`;
