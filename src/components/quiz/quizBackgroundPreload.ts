// Preload tła /quiz dla `head()` trasy - wydzielony z `QuizBackground.tsx`.
//
// DLACZEGO OSOBNY PLIK. `head()` zostaje w shellu trasy, a shell KAŻDEJ trasy
// ląduje w chunku wejściowym przeglądarki. Dopóki stałe preloadu mieszkały
// obok komponentu, każdy czytelnik serwisu pobierał komponent tła quizu
// razem z dwunastoma manifestami obrazów (5,5 KB + 1,6 KB przed minifikacją,
// pomiar entry 2026-10-02). Tutaj zostają tylko cztery adresy AVIF, których
// `head()` naprawdę potrzebuje; komponent importuje stąd i re-eksportuje
// obie stałe, więc testy i dotychczasowi importerzy widzą to samo API.
import lightMobileAvif from "@/assets/quiz/quiz-bg-light-mobile.avif.asset.json";
import lightDesktopAvif from "@/assets/quiz/quiz-bg-light-desktop.avif.asset.json";
import darkMobileAvif from "@/assets/quiz/quiz-bg-dark-mobile.avif.asset.json";
import darkDesktopAvif from "@/assets/quiz/quiz-bg-dark-desktop.avif.asset.json";
import { THEME_RESOLVE_JS } from "@/lib/theme/themeChoice";

/** Preload dla LCP tła - wariant LIGHT (SSR default) w formacie AVIF (najlżejszy).
 *  Przeglądarki bez wsparcia AVIF zignorują preload i pobiorą JPG przez <picture>
 *  fallback - bez blokowania renderu. DARK preloaduje inline-script tylko dla
 *  użytkowników z aktywnym trybem ciemnym. */
export const QUIZ_BG_PRELOAD_LINKS = [
  {
    rel: "preload",
    as: "image",
    href: lightMobileAvif.url,
    type: "image/avif",
    media: "(max-width: 767px)",
    fetchpriority: "high",
  },
  {
    rel: "preload",
    as: "image",
    href: lightDesktopAvif.url,
    type: "image/avif",
    media: "(min-width: 768px)",
    fetchpriority: "high",
  },
] as const;

/** Inline-script wstawiany do <head> trasy /quiz. Uruchamia się przed
 *  hydracją, odczytuje motyw i tylko dla trybu DARK dokłada
 *  <link rel="preload"> właściwego wariantu AVIF.
 *
 *  ROZSTRZYGNIĘCIE MOTYWU NIE JEST TU PISANE. Było - własną kopią wyrażenia
 *  „jawny wybór wygrywa z systemem" - i to jest dokładnie ten rodzaj kopii,
 *  który cicho się rozjeżdża: preload wariantu AVIF dla NIE TEGO motywu
 *  kosztuje pobranie obrazu, którego nikt nie zobaczy, i nie zgłasza żadnego
 *  błędu. Fragment idzie teraz z `lib/theme/themeChoice.ts`, więc reguła jest
 *  jedna dla skryptu anty-FOUC, dla `ThemeProvider` i dla tego preloadu. */
export const QUIZ_BG_PRELOAD_SCRIPT = `(function(){try{
${THEME_RESOLVE_JS}
if(!d)return;
var isMobile=window.matchMedia&&window.matchMedia('(max-width: 767px)').matches;
var href=isMobile?${JSON.stringify(darkMobileAvif.url)}:${JSON.stringify(darkDesktopAvif.url)};
var l=document.createElement('link');
l.rel='preload';l.as='image';l.href=href;l.type='image/avif';l.setAttribute('fetchpriority','high');
document.head.appendChild(l);
}catch(e){}})();`;
