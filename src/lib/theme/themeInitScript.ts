// Skrypt anty-FOUC motywu: jedyna rzecz, która stoi między czytelnikiem
// a błyskiem białego tła na ciemnym motywie.
//
// PO CO OSOBNY MODUŁ. Ten skrypt jest wstrzykiwany do `<head>` jako
// `dangerouslySetInnerHTML` i wykonuje się PRZED pierwszym malowaniem - zanim
// React w ogóle wstanie. Jako literał wpleciony w `__root.tsx` był nietykalny
// dla testów (0% pokrycia), a jest to kod, którego jedna literówka daje błysk
// na KAŻDYM wejściu na stronę w ciemnym motywie. Tu daje się i przeczytać,
// i WYKONAĆ w teście.
//
// KONTRAKT (ten sam, co `ThemeProvider`):
//   * `localStorage.theme === "dark"`  -> ciemny;
//   * `localStorage.theme === "light"` -> jasny, NAWET gdy system woła ciemny
//     (jawny wybór użytkownika wygrywa z preferencją systemu);
//   * brak zapisanego wyboru          -> `prefers-color-scheme`;
//   * cokolwiek rzuci (tryb prywatny odbiera `localStorage`) -> jasny,
//     bez wyjątku wywalającego dokument.
//
// `color-scheme` ustawiamy razem z klasą, bo bez niego formularze i pasek
// przewijania zostają jasne na ciemnej stronie.

/**
 * Treść skryptu inicjalizacji motywu. IIFE w jednej linii - wstrzykiwana
 * inline, więc każdy znak nowej linii to bajt na krytycznej ścieżce.
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(t!=='light'&&window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})();`;
