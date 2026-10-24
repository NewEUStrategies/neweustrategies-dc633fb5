// ODSŁANIANIE GRANIC STRUMIENIA SSR W NAJBLIŻSZEJ KLATCE - bez dławienia Reacta 19.2.
//
// OBJAW (PSI 2026-10-24, ślad produkcji desktop). Na zimnym izolacie nagłówek (`B:0`) i pierwsza
// sekcja z obrazem LCP (`B:1`) nie mieszczą się we wspólnym terminie loadera i idą strumieniem
// za powłoką, jako granice Suspense ze szkieletem. Cały dokument był w przeglądarce PRZED
// pierwszym malowaniem (koniec dokumentu 4,9 s, FCP 5,67 s), a mimo to od FCP do ~6,12 s na
// ekranie stały szkielety: `$RC` zainstalował timer 253 ms (`TimerInstall 5558 ... $RC`), a obraz
// LCP, pobrany ~5,5 s, czekał na odsłonięcie sekcji (`elementRenderDelay` 646 ms).
//
// PRZYCZYNA. Runtime Fizz Reacta 19.2 (`$RC`, react-dom-server) odsłania segmenty partiami:
// póki `$RT` nie jest liczbą - w najbliższej klatce (`requestAnimationFrame($RV)`), a gdy jest -
// `setTimeout`-em na `$RT + 300 ms` (w oknie 2,0-2,3 s od nawigacji: na 2,3 s). `$RT` ustawia
// skrypt powłoki (`requestAnimationFrame(function(){$RT=performance.now()})`) i każde
// odsłonięcie (`$RV`). Dławienie ma zbierać odsłonięcia w paczki; na naszej stronie odsuwa
// tylko treść nad zgięciem od pierwszego malowania o >= 300 ms - Speed Index liczy właśnie
// postęp wizualny od FCP, a LCP czeka na odsłonięcie sekcji z hero.
//
// CO ROBI. Definiuje `window.$RT` jako akcesor - zanim wykona się jakikolwiek skrypt Reacta
// (inline w `<head>` korzenia). Zapis Reacta jest zapamiętywany, ale odczyt na WIDOCZNEJ karcie
// oddaje `undefined`: `$RC` idzie wtedy ścieżką `requestAnimationFrame`, czyli zachowaniem sprzed
// 19.2 - każda partia odsłania się w najbliższej klatce. Na UKRYTEJ karcie odczyt oddaje wartość
// Reacta bez zmian: ukryty dokument nie wykonuje `requestAnimationFrame`, a timer Reacta tak
// (z dławieniem przeglądarki), więc segmenty odsłaniają się w tle jak dotąd. Bez tego karta
// schowana po pierwszej klatce trzymała szkielety do powrotu, a `restoreAfterReveal` (sufit 5 s
// od hydratacji, która w tle biegnie) odpuszczał i pozycja przeładowania odjeżdżała o różnicę
// szkielet/treść (przegląd adwersaryjny PR #534, odtworzone w przeglądarce).
//
// Klient React (`react-dom-client`) `$RT` nie czyta; siatki przewijania
// (`lib/scroll/restoreAfterReveal.ts`, `lib/scroll/fragmentLandingScript.ts`) obsługują
// odsłonięcie w dowolnej chwili, a wcześniejsze to dla nich „zwykły przypadek". `try` -
// środowisko z zamrożonym `window` dostaje dotychczasowe zachowanie Reacta.
// A frame queued while visible can be suspended if the tab is hidden before it runs.
// Drain React's shared queue on that transition; the later frame sees an empty queue.
// Reuse one listener even if the head script is executed again during navigation.
export const STREAM_REVEAL_SCRIPT =
  'try{(function(t){Object.defineProperty(window,"$RT",{configurable:true,get:function(){return document.hidden?t:void 0},set:function(v){t=v}});if(!window.__nesRevealVisibility){window.__nesRevealVisibility=function(){if(document.hidden)setTimeout(function(){var q=window.$RB,f=window.$RV;if(document.hidden&&Array.isArray(q)&&q.length&&typeof f==="function")f(q)},0)};document.addEventListener("visibilitychange",window.__nesRevealVisibility)}})()}catch(e){}';
