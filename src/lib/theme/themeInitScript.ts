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
//
// TREŚĆ NIE JEST JUŻ PISANA TUTAJ, i to jest cała zmiana wobec poprzedniej
// wersji. Wyrażenie rozstrzygające motyw stało w repozytorium w czterech
// kopiach (dwa skrypty inline, `ThemeProvider`, podgląd w iframe) i te kopie
// już się rozjechały - wersje napisowe nie miały `!!` wokół członu
// `matchMedia`, więc w środowisku bez `matchMedia` przełączały klasę zamiast
// ją zdjąć. Fragmenty pochodzą teraz z `themeChoice.ts`; uzasadnienie i pomiar
// defektu są tam, przy `THEME_RESOLVE_JS`.
import { THEME_APPLY_JS, THEME_RESOLVE_JS } from "./themeChoice";

/**
 * Treść skryptu inicjalizacji motywu. IIFE w jednej linii - wstrzykiwana
 * inline, więc każdy znak nowej linii to bajt na krytycznej ścieżce.
 *
 * Skrypt robi teraz o jedną rzecz więcej niż wcześniej: obok klasy `.dark`
 * i `color-scheme` zapisuje na `<html>` atrybut `data-motyw` z WYBOREM
 * użytkownika (obecny tylko wtedy, gdy wybór był jawny). Koszt to około 110
 * bajtów na krytycznej ścieżce; kupuje za to jedyny stan, którego klasa
 * `.dark` wyrazić nie potrafi - różnicę między „użytkownik wybrał jasny"
 * a „użytkownik nie wybrał nic, a system jest jasny".
 */
export const THEME_INIT_SCRIPT = `(function(){try{${THEME_RESOLVE_JS}var r=document.documentElement;${THEME_APPLY_JS}}catch(e){}})();`;
