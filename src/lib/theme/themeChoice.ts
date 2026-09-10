// WYBÓR MOTYWU: JEDNA REGUŁA ROZSTRZYGANIA, TRZY MIEJSCA, W KTÓRYCH BIEGNIE.
//
// PO CO TEN MODUŁ ISTNIEJE. Reguła „jawny wybór użytkownika wygrywa
// z preferencją systemu" była w repozytorium zapisana CZTERY RAZY, w dwóch
// różnych językach wykonania:
//
//   1. `THEME_INIT_SCRIPT` - skrypt anty-FOUC w `<head>`, jako napis;
//   2. `QUIZ_BG_PRELOAD_SCRIPT` - preload tła quizu, też jako napis;
//   3. `ThemeProvider.readStored()` + `systemTheme()` - jako TypeScript;
//   4. `ExpertLayoutPreview.applyThemeToIframe()` - jako narzucenie motywu
//      podglądowi w iframe.
//
// Cztery kopie tego samego wyrażenia logicznego to nie kwestia estetyki:
// wersje napisowe NIOSŁY JUŻ ROZJAZD. W obu brakowało `!!` wokół członu
// `matchMedia`, więc w środowisku bez `matchMedia` wyrażenie dawało
// `undefined`, a nie `false` - a `classList.toggle('dark', undefined)` jest
// wg specyfikacji wywołaniem BEZ drugiego argumentu, czyli PRZEŁĄCZA klasę
// zamiast ją zdjąć. Skutek: czytelnik, który nigdy nie wybrał ciemnego
// motywu, dostawał ciemną stronę z jasnym `color-scheme`, czyli ciemne tło
// z jasnym paskiem przewijania i jasnymi kontrolkami formularza. Defekt był
// zgłoszony w `themeInitScript.test.ts` jako `it.fails` z adnotacją „decyzja
// dla człowieka" - tu jest naprawiony w JEDNYM miejscu dla wszystkich kopii.
//
// KLUCZOWE ROZRÓŻNIENIE, KTÓRE TEN MODUŁ WPROWADZA: WYBÓR to nie MOTYW.
//
//   * WYBÓR (`ThemeChoice`) ma TRZY stany: jasny, ciemny, brak wyboru.
//     Brak wyboru znaczy „podążaj za systemem" i jest stanem odrębnym,
//     a nie synonimem jasnego.
//   * MOTYW (`Theme`) ma dwa stany i jest WYNIKIEM rozstrzygnięcia wyboru
//     wobec preferencji systemu.
//
// Klasa `.dark` na `<html>` niesie MOTYW - i tylko ona steruje arkuszem.
// Atrybut `data-motyw` niesie WYBÓR - i nie steruje niczym w arkuszu.
// To nie są dwa źródła prawdy o tym samym, bo mówią o dwóch różnych
// rzeczach: jedna o wejściu, druga o wyjściu tej samej funkcji.
//
// CZEMU ARKUSZ NIE KEYUJE NA `data-motyw`, choć specyfikacja tak robi.
// Specyfikacja rozstrzyga motyw W CSS: jej blok ciemny stoi pod
// `@media (prefers-color-scheme: dark)` i wyłącza się selektorem
// `:root:not([data-motyw="jasny"])`. Przy takim układzie atrybut MUSI być
// w arkuszu, bo bez niego nie ma jak nadpisać preferencji systemu. To
// repozytorium rozstrzyga motyw W JAVASCRIPCIE (skrypt w `<head>` przed
// pierwszym malowaniem) i materializuje wyłącznie ODPOWIEDŹ - w arkuszu nie
// ma ani jednego `prefers-color-scheme`. Dopisanie do arkusza selektora na
// `data-motyw` dołożyłoby DRUGĄ ścieżkę decyzji o tym samym pikselu i od tej
// chwili istniałby stan, w którym klasa mówi jedno, a atrybut drugie. Dlatego
// atrybut jest tu wyłącznie ODCZYTYWALNYM STANEM WYBORU: dla osadzeń, dla
// diagnostyki, dla testów i dla eksportu wykresu do dokumentu o innym tle -
// czyli dokładnie dla przypadku, którym specyfikacja ten atrybut uzasadnia.

/** Klucz w `localStorage`. Jeden literał, bo wcześniej były trzy. */
export const THEME_STORAGE_KEY = "theme";

/** Atrybut na `<html>` niosący WYBÓR użytkownika (nie rozstrzygnięty motyw). */
export const THEME_ATTR = "data-motyw";

/**
 * Wartości atrybutu. Polskie, bo takie są w specyfikacji i mają być
 * rozpoznawalne dla arkusza osadzającego wykres poza tą aplikacją. To nie
 * jest tekst dla użytkownika - nigdzie się nie renderuje - więc nie idzie
 * do słownika i18n.
 */
export const THEME_ATTR_LIGHT = "jasny";
export const THEME_ATTR_DARK = "ciemny";

export type Theme = "light" | "dark";

/** `null` = użytkownik nie wybrał, więc decyduje system. Trzeci stan, nie brak. */
export type ThemeChoice = Theme | null;

/**
 * FRAGMENT JS DLA SKRYPTÓW WSTRZYKIWANYCH DO `<head>`.
 *
 * Definiuje `var t` (surowy wybór z magazynu) i `var d` (rozstrzygnięty motyw,
 * `true` = ciemny). Oba skrypty inline biorą stąd JEDNO wyrażenie, więc reguła
 * „jawny wybór wygrywa z systemem" nie da się już rozjechać między nimi.
 *
 * `!!(...)` NIE JEST OZDOBĄ - patrz akapit o `classList.toggle` na górze pliku.
 * Bez niego środowisko bez `matchMedia` dostaje `undefined` i przełącza klasę.
 *
 * Jedna linia, bo to bajty na krytycznej ścieżce renderu.
 */
export const THEME_RESOLVE_JS =
  `var t=localStorage.getItem('${THEME_STORAGE_KEY}');` +
  `var d=t==='dark'||(t!=='light'&&!!(window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches));`;

/**
 * FRAGMENT JS ZAPISUJĄCY WYBÓR NA `<html>`. Wymaga, żeby `var t` i `var d`
 * były już zdefiniowane (czyli poprzedza go `THEME_RESOLVE_JS`), i żeby `r`
 * wskazywało element dokumentu.
 *
 * Kolejność: najpierw klasa i `color-scheme` (to one decydują o pikselu
 * i o kontrolkach przeglądarki), potem atrybut wyboru. Gdyby atrybut szedł
 * pierwszy, czytelnik z zablokowanym `localStorage` widziałby na `<html>`
 * wybór, którego rozstrzygnięcie nigdy nie doszło.
 */
export const THEME_APPLY_JS =
  `r.classList.toggle('dark',d);` +
  `r.style.colorScheme=d?'dark':'light';` +
  `if(t==='dark')r.setAttribute('${THEME_ATTR}','${THEME_ATTR_DARK}');` +
  `else if(t==='light')r.setAttribute('${THEME_ATTR}','${THEME_ATTR_LIGHT}');` +
  `else r.removeAttribute('${THEME_ATTR}');`;

/**
 * Surowa wartość z magazynu na wybór. Wszystko, czego nie znamy, jest BRAKIEM
 * wyboru, nie jasnym motywem: starsza wersja aplikacji mogła zapisać cokolwiek,
 * a „sepia" nie może zablokować podążania za systemem.
 */
export function parseThemeChoice(raw: string | null | undefined): ThemeChoice {
  return raw === "dark" || raw === "light" ? raw : null;
}

/**
 * Zapytanie o preferencję systemu. Jeden literał, bo stał w repozytorium
 * w czterech miejscach - a literówka w nim nie jest błędem składni: zapytanie
 * po prostu nigdy się nie dopasowuje i wszyscy dostają jasny motyw.
 */
export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/** Czy system woła ciemny. Bezpieczne na serwerze i bez `matchMedia`. */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  return window.matchMedia(SYSTEM_DARK_QUERY).matches;
}

/**
 * Nasłuch na ŻYWĄ zmianę preferencji systemu. Zwraca funkcję odpinającą albo
 * `undefined`, gdy nasłuchiwać nie ma jak.
 *
 * Osobno od `systemPrefersDark`, bo to dwie różne rzeczy: tamto pyta o stan
 * TERAZ, to reaguje na zmianę. Oba jednak muszą używać TEGO SAMEGO zapytania -
 * gdyby się rozjechały, aplikacja startowałaby w jednym motywie, a na zmianę
 * systemu reagowała według innego warunku.
 */
export function subscribeSystemTheme(onChange: () => void): (() => void) | undefined {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
  const mql = window.matchMedia(SYSTEM_DARK_QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** Wybór z magazynu. Tryb prywatny odbiera `localStorage`, więc try/catch. */
export function readThemeChoice(): ThemeChoice {
  if (typeof window === "undefined") return null;
  try {
    return parseThemeChoice(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Magazyn zablokowany. To brak wyboru, a nie wybór jasnego - inaczej
    // czytelnik z ciemnym systemem i zablokowanym magazynem dostawałby jasną
    // stronę i nie miałby jak tego zmienić.
    return null;
  }
}

/** Rozstrzygnięcie: jawny wybór wygrywa, brak wyboru oddaje głos systemowi. */
export function resolveTheme(choice: ThemeChoice, systemDark: boolean): Theme {
  if (choice !== null) return choice;
  return systemDark ? "dark" : "light";
}

/** Wartość atrybutu dla danego wyboru; `null` znaczy „atrybut nieobecny". */
export function themeAttrValue(choice: ThemeChoice): string | null {
  if (choice === "dark") return THEME_ATTR_DARK;
  if (choice === "light") return THEME_ATTR_LIGHT;
  return null;
}

/**
 * Nałożenie motywu na element dokumentu. `root` jest parametrem, bo podgląd
 * układu narzuca motyw dokumentowi W IFRAME - to inny `document`, a reguła ma
 * być ta sama.
 */
export function applyTheme(resolved: Theme, choice: ThemeChoice, root: HTMLElement): void {
  root.classList.toggle("dark", resolved === "dark");
  // Bez `instanceof`: dokument w iframe ma WŁASNY konstruktor `HTMLElement`,
  // więc sprawdzenie międzyramowe zawsze wychodziłoby fałszywe i podgląd
  // układu zostałby bez `color-scheme`. `Document.documentElement` jest
  // typowany jako `HTMLElement`, więc pole `style` jest tu pewne z typu.
  root.style.colorScheme = resolved;
  const attr = themeAttrValue(choice);
  if (attr === null) root.removeAttribute(THEME_ATTR);
  else root.setAttribute(THEME_ATTR, attr);
}
