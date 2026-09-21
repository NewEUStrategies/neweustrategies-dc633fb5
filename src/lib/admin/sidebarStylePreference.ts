// PAMIĘĆ SZEROKOŚCI PASKA BOCZNEGO PANELU - jedyny cel: zero przeskoku układu.
//
// PROBLEM, KTÓRY TO ZAMYKA (CLS 0,532 na `/admin`, okno pomiarowe 2026-09).
// `AdminShell` liczy wariant paska z ustawienia `theme_options.sidebars.style`,
// a `style-4` to pasek ZWINIĘTY (`w-12` = 3 rem) zamiast rozwiniętego
// (`w-56` = 14 rem). Ustawienie przyjeżdża zapytaniem `site_settings`, którego
// panel - trasa `ssr: false` - nie ma z czego zhydratować: pierwszy render
// klienta dostaje wbudowane domyślne (`style-1`), maluje pasek 224 px szeroki,
// a po odpowiedzi bazy zwęża go do 48 px. Cała treść panelu przesuwa się wtedy
// o 176 px w poziomie - jedno przesunięcie, które samo wysyca próg "Poor".
//
// ROZWIĄZANIE: zapamiętać ROZSTRZYGNIĘTY wariant w `localStorage` i użyć go
// jako wartości POCZĄTKOWEJ następnego wejścia. To preferencja widoku tej
// przeglądarki, nie stan aplikacji: nie decyduje o niczym poza szerokością
// pierwszego malowania i jest natychmiast nadpisywana wartością z bazy.
//
// GRANICE, wprost:
//   * PIERWSZE w życiu wejście do panelu na danej przeglądarce nadal może
//     przeskoczyć - nie ma czego pamiętać. Kolejne (czyli praktycznie cała
//     praca operatora) już nie.
//   * Zmiana wariantu w panelu wygląda z tej perspektywy jak pierwsze wejście:
//     jedno przesunięcie w momencie zapisu, potem znów stabilnie.
//   * Brak dostępu do `localStorage` (tryb prywatny, zablokowane dane witryny)
//     to zejście do dzisiejszego zachowania, nigdy wyjątek.
import type { SidebarStyle } from "@/lib/builder/sidebarStyles";

const STORAGE_KEY = "nes.admin.sidebar-style";

const KNOWN_STYLES: readonly SidebarStyle[] = [
  "style-1",
  "style-2",
  "style-3",
  "style-4",
  "style-5",
  "style-6",
];

function isSidebarStyle(value: unknown): value is SidebarStyle {
  return typeof value === "string" && (KNOWN_STYLES as readonly string[]).includes(value);
}

/**
 * Ostatni ZNANY wariant paska, albo `null` gdy niczego nie zapamiętano.
 *
 * Czytać WYŁĄCZNIE w inicjalizatorze `useState` (raz na montaż), nie w ciele
 * renderu: wartość ma być stabilna przez całe życie komponentu, a nie zmieniać
 * się pod wpływem zapisu z innej karty.
 */
export function readRememberedSidebarStyle(): SidebarStyle | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return isSidebarStyle(raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Utrwal wariant ROZSTRZYGNIĘTY danymi z bazy (nigdy domyślny z fallbacku). */
export function rememberSidebarStyle(style: SidebarStyle): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, style);
  } catch {
    /* brak dostępu do storage - preferencja widoku nie jest warta wyjątku */
  }
}
