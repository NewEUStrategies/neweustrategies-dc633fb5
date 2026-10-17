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
// CO ROBI SKRYPT (ES5, jedno IIFE, inline w `<head>` korzenia). Zasada nadrzędna: skrypt jest
// WYŁĄCZNIE siatką bezpieczeństwa dla przypadku „nikt nie przewinął" - działa tylko wtedy,
// gdy strona po wczytaniu stoi dokładnie na górze (`scrollY === 0`). Każde inne położenie
// znaczy, że ktoś już zdecydował: przeglądarka (kotwica przed `load`, przywrócenie pozycji
// przy przeładowaniu/wstecz), router (przywracanie, `scrollIntoView` przy hydratacji),
// aplikacja (płynne przewinięcie do kotwicy) albo użytkownik (kółko, klawisze, pasek
// przewijania, czytnik ekranu, „znajdź na stronie") - i skrypt ustępuje.
//  1. Tylko wejście z fragmentem w adresie (`location.hash` dłuższy niż `#`). Fragment
//     tekstowy (`#:~:text=`) Chromium wycina z `location`, a przewija do niego sam.
//  2. NIE walczy z przywróceniem przewinięcia TanStacka: gdy jest wpis OKNA dla tego wpisu
//     historii (`sessionStorage["tsr-scroll-restoration-v1_3"][history.state.__TSR_key]
//     .window`), router przywraca TĘ pozycję (już po hydratacji, więc `scrollY` w chwili
//     wczytania bywa jeszcze 0) i celowo pomija fragment - skrypt też. Wpisy samych
//     elementów (karuzela, kontener z przewijaniem) routera od fragmentu nie odwodzą, więc
//     i skryptu nie. Klucz magazynu to `storageKey` z `@tanstack/router-core` (zgodność
//     pilnuje test), ten sam odczyt ma strażnik cv w `BuilderRenderer.tsx`.
//  3. Co 100 ms (bez odczytu układu: `getElementById` + `closest`) czeka, aż karta jest
//     widoczna, dokument wczytany (`readyState === "complete"`: przeglądarka skończyła własną
//     próbę) i cel istnieje POZA ukrytym segmentem. Wtedy w najbliższej klatce, jeśli strona
//     dalej stoi na górze: `scrollIntoView()` bez opcji (jak router przy
//     `hashScrollIntoViewOptions ?? true`; `scroll-margin`/`scroll-padding` arkusza ustawiają
//     cel pod nagłówkiem). Cel u dołu ekranu też - przeglądarka przewinęłaby go do góry.
//     Potem koniec.
//  4. Ustępuje użytkownikowi: `wheel`/`touchmove` kończą czekanie od razu, każde inne
//     przewinięcie łapie warunek `scrollY`. Kliknięcie i dotknięcie bez przewijania (zgoda
//     na cookies na pierwszej wizycie, menu) NIE odbiera lądowania - wcześniej odbierało
//     i wracał objaw z CI.
//  5. Ustępuje aplikacji, która przejmuje fragment: `smoothScrollToAnchor` ustawia
//     `window.__nesAnchorOwned` przed pierwszą klatką płynnego przewinięcia (kotwice
//     powiadomień, których cel przychodzi z RPC po hydratacji) - natychmiastowy skok w tej
//     samej klatce cofałby animację do jej odcinka startowego. NIE czytamy do tego
//     `history.state.__hashScrollIntoViewOptions`: router zapisuje tam `false` przy KAŻDYM
//     zatwierdzeniu nawigacji (`defaultHashScrollIntoView: false` w `src/router.tsx`), także
//     przy kanonizującym `replace` adresu, więc znaczyłoby „ktoś przejął" bez przejęcia.
//  6. Sufity liczone uczciwie: 80 prób (8 s) liczy się WYŁĄCZNIE wtedy, gdy skrypt mógłby
//     działać (karta widoczna, dokument wczytany) - w karcie otwartej w tle React nie odsłania
//     segmentów (pierwsza partia czeka na `requestAnimationFrame`, którego ukryty dokument nie
//     wykonuje), a wolne łącze potrafi trzymać `readyState` dłużej niż 8 s. Osobny sufit 600
//     prób łącznie kończy pętlę, gdy wczytanie nie skończy się nigdy (ukryta karta: Chromium
//     dławi timery do 1/s, więc to ~10 min, potem jeszcze rzadziej).
// Świadomie poza zakresem: ponowne lądowanie, gdy PÓŹNIEJSZA partia odsłonięć nad celem
// zmieni wysokość sekcji. Chromium koryguje to zakotwiczeniem przewijania; WebKit go nie ma
// (cel przesunie się o różnicę szkieletu i treści), ale ponowne przewijanie po własnym skoku
// wymagałoby odróżniania własnego przewinięcia od cudzego - to kod, który łatwo zamienia
// siatkę w walkę z czytelnikiem.
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

/** Odstęp prób i sufit prób „czynnych" (karta widoczna, dokument wczytany): 100 ms x 80 = 8 s. */
export const FRAGMENT_LANDING_POLL_MS = 100;
export const FRAGMENT_LANDING_MAX_POLLS = 80;
/** Sufit wszystkich prób (także w ukrytej karcie i przy niekończącym się wczytywaniu). */
export const FRAGMENT_LANDING_MAX_TICKS = 600;

/** Flaga na `window`, którą kod strony mówi „fragment jest mój" (`smoothScrollToAnchor`). */
export const FRAGMENT_OWNED_FLAG = "__nesAnchorOwned";

export const FRAGMENT_LANDING_SCRIPT =
  "(function(w,d){try{var h=location.hash;if(h.length<2)return;" +
  "try{var k=(history.state||{}).__TSR_key;if(k&&(JSON.parse(sessionStorage.getItem(" +
  `"${TSR_SCROLL_STORAGE_KEY}")||"{}")[k]||{}).window)return}catch(x){}` +
  'var r=h.slice(1),n=0,m=0,s=0,E=["wheel","touchmove"];' +
  "function z(){s=1;for(var i=0;i<E.length;i++)removeEventListener(E[i],z,!0)}" +
  "for(var i=0;i<E.length;i++)addEventListener(E[i],z,{capture:!0,passive:!0});" +
  `function o(){return w.${FRAGMENT_OWNED_FLAG}||w.scrollY!==0}` +
  "function g(){var e=d.getElementById(r);if(!e)try{e=d.getElementById(decodeURIComponent(r))}" +
  "catch(x){}return e}" +
  `function t(){if(s)return;if(location.hash!==h||++m>${FRAGMENT_LANDING_MAX_TICKS})return z();` +
  'if(!d.hidden&&d.readyState=="complete"){if(o())return z();var e=g();' +
  'if(e&&!e.closest("[hidden]"))return requestAnimationFrame(function(){if(s)return;z();' +
  "o()||e.scrollIntoView()});" +
  `if(++n>${FRAGMENT_LANDING_MAX_POLLS})return z()}` +
  `setTimeout(t,${FRAGMENT_LANDING_POLL_MS})}t()}catch(x){}})(window,document)`;
