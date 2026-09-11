// PARYTET ROZSTRZYGANIA MOTYWU: SKRYPT Z `<head>` I `ThemeProvider` MUSZĄ
// DAWAĆ TEN SAM `<html>`.
//
// PO CO TA BRAMKA. Reguła „jawny wybór użytkownika wygrywa z preferencją
// systemu" biegnie w tej aplikacji w DWÓCH RÓŻNYCH JĘZYKACH WYKONANIA i w
// dwóch różnych chwilach: raz jako napis wstrzyknięty do `<head>` przed
// pierwszym malowaniem, raz jako TypeScript w `ThemeProvider` po hydracji.
// Do tej pory ich zgodności pilnował KOMENTARZ - dosłownie zdanie „Mirrors
// the pre-hydration themeInitScript in __root.tsx - keep both in sync".
//
// Komentarz nie jest bramką i ten konkretny się nie utrzymał: wersje
// napisowe zgubiły `!!` wokół członu `matchMedia`, więc w środowisku bez
// `matchMedia` wyrażenie dawało `undefined`, a `classList.toggle('dark',
// undefined)` jest wg specyfikacji wywołaniem BEZ drugiego argumentu, czyli
// PRZEŁĄCZA klasę zamiast ją zdjąć. Czytelnik, który nigdy nie wybrał
// ciemnego motywu, dostawał ciemne tło z jasnym `color-scheme` - ciemną
// stronę z jasnym paskiem przewijania i jasnymi kontrolkami formularza.
//
// CO TU JEST SPRAWDZANE. Nie treść napisu i nie kształt funkcji, a SKUTEK:
// obie ścieżki są uruchamiane na tej samej macierzy wejść (cztery wartości
// w magazynie razy dwie preferencje systemu) i muszą zostawić na
// `documentElement` identyczną trójkę: klasę, `color-scheme` i atrybut
// wyboru. Asercja na treści przeszłaby dla wersji z odwróconym warunkiem.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { THEME_INIT_SCRIPT } from "../themeInitScript";
import {
  applyTheme,
  readThemeChoice,
  resolveTheme,
  systemPrefersDark,
  THEME_ATTR,
  THEME_ATTR_DARK,
  THEME_ATTR_LIGHT,
  THEME_STORAGE_KEY,
} from "../themeChoice";

/** Skutek na `<html>` - dokładnie to, co widzi czytelnik i arkusz. */
interface Stan {
  dark: boolean;
  scheme: string;
  motyw: string | null;
}

function stan(): Stan {
  const root = document.documentElement;
  return {
    dark: root.classList.contains("dark"),
    scheme: root.style.colorScheme,
    motyw: root.getAttribute(THEME_ATTR),
  };
}

function wyczysc(): void {
  const root = document.documentElement;
  root.classList.remove("dark");
  root.style.colorScheme = "";
  root.removeAttribute(THEME_ATTR);
  localStorage.clear();
}

/** Ustawia odpowiedź `prefers-color-scheme`; `null` = brak `matchMedia`. */
function system(dark: boolean | null): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value:
      dark === null
        ? undefined
        : (query: string) => ({
            matches: query.includes("prefers-color-scheme: dark") ? dark : false,
            media: query,
            addEventListener: () => undefined,
            removeEventListener: () => undefined,
          }),
  });
}

/** Ścieżka PRZED hydracją: skrypt z `<head>`, wykonany tak jak w przeglądarce. */
function przezSkrypt(): Stan {
  new Function(THEME_INIT_SCRIPT)();
  return stan();
}

/** Ścieżka PO hydracji: to samo, co robi `apply()` w `ThemeProvider`. */
function przezProvider(): Stan {
  const wybor = readThemeChoice();
  applyTheme(resolveTheme(wybor, systemPrefersDark()), wybor, document.documentElement);
  return stan();
}

const MAGAZYN: Array<string | null> = [null, "dark", "light", "sepia"];
const SYSTEM: Array<boolean | null> = [true, false, null];

beforeEach(wyczysc);
afterEach(wyczysc);

describe("skrypt z `<head>` i `ThemeProvider` rozstrzygają IDENTYCZNIE", () => {
  for (const zapis of MAGAZYN) {
    for (const sys of SYSTEM) {
      const opis =
        `magazyn=${zapis ?? "brak"}, system=` +
        (sys === null ? "bez matchMedia" : sys ? "ciemny" : "jasny");
      it(opis, () => {
        // Ta sama macierz, dwa przebiegi, czyste `<html>` przed każdym.
        wyczysc();
        if (zapis !== null) localStorage.setItem(THEME_STORAGE_KEY, zapis);
        system(sys);
        const zeSkryptu = przezSkrypt();

        wyczysc();
        if (zapis !== null) localStorage.setItem(THEME_STORAGE_KEY, zapis);
        system(sys);
        const zProvidera = przezProvider();

        expect(zeSkryptu).toEqual(zProvidera);
      });
    }
  }
});

describe("atrybut wyboru ma TRZY stany, nie dwa", () => {
  it("jawny ciemny zapisuje `ciemny`", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    system(false);
    expect(przezSkrypt()).toEqual({ dark: true, scheme: "dark", motyw: THEME_ATTR_DARK });
  });

  it("jawny jasny zapisuje `jasny` NAWET przy ciemnym systemie", () => {
    // To jest przypadek, dla którego atrybut w ogóle istnieje: klasa `.dark`
    // jest tu nieobecna, ale nieobecność klasy znaczy „jasny motyw", a nie
    // „użytkownik wybrał jasny". Bez atrybutu te dwa stany są w DOM
    // nierozróżnialne, a specyfikacja wymaga właśnie tego rozróżnienia.
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    system(true);
    expect(przezSkrypt()).toEqual({ dark: false, scheme: "light", motyw: THEME_ATTR_LIGHT });
  });

  it("brak wyboru NIE zapisuje atrybutu, choćby system był ciemny", () => {
    system(true);
    expect(przezSkrypt()).toEqual({ dark: true, scheme: "dark", motyw: null });
  });

  it("nieznany zapis jest brakiem wyboru, nie wyborem", () => {
    // Starsza wersja aplikacji mogła zapisać cokolwiek. „sepia" nie może ani
    // zablokować podążania za systemem, ani wylądować w atrybucie.
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    system(true);
    expect(przezSkrypt()).toEqual({ dark: true, scheme: "dark", motyw: null });
  });

  it("atrybut jest ZDEJMOWANY, gdy użytkownik wraca do podążania za systemem", () => {
    // Ścieżka realna: użytkownik wybrał ciemny, potem wyczyścił dane witryny
    // albo aplikacja usunęła wpis. Atrybut, który zostaje, twierdziłby o
    // wyborze, którego już nie ma.
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    system(false);
    przezSkrypt();
    localStorage.clear();
    expect(przezSkrypt().motyw).toBeNull();
  });
});

describe("degradacja bez `matchMedia` jest SPÓJNA", () => {
  it("klasa i `color-scheme` mówią to samo - dawniej nie mówiły", () => {
    // REGRESJA ODWROTNA. Poprzednia wersja skryptu dawała tu
    // `{dark: true, scheme: "light"}`, bo `undefined` jako drugi argument
    // `classList.toggle` przełącza klasę, a w wyrażeniu `d ? ... : ...` jest
    // fałszywe. Defekt był zgłoszony jako `it.fails` w
    // `themeInitScript.test.ts`; ta asercja pilnuje, żeby nie wrócił.
    system(null);
    expect(przezSkrypt()).toEqual({ dark: false, scheme: "light", motyw: null });
  });

  it("brak `matchMedia` nie przeszkadza jawnemu wyborowi", () => {
    system(null);
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(przezSkrypt()).toEqual({ dark: true, scheme: "dark", motyw: THEME_ATTR_DARK });
  });
});

describe("atrybut NIE JEST drugim źródłem prawdy", () => {
  const arkusz = readFileSync("src/styles.css", "utf8");

  it("arkusz nie keyuje na `data-motyw` ANI RAZU", () => {
    // TO JEST NAJWAŻNIEJSZA ASERCJA W TYM PLIKU. Specyfikacja rozstrzyga
    // motyw w CSS i dlatego MUSI mieć ten atrybut w selektorze. To
    // repozytorium rozstrzyga motyw w JavaScripcie przed pierwszym
    // malowaniem i materializuje wyłącznie odpowiedź - w arkuszu nie ma ani
    // jednego `prefers-color-scheme`. Dopisanie selektora na `data-motyw`
    // dołożyłoby DRUGĄ ścieżkę decyzji o tym samym pikselu i od tej chwili
    // istniałby stan, w którym klasa mówi jedno, a atrybut drugie.
    expect(arkusz).not.toContain(THEME_ATTR);
  });

  it("klasa `.dark` pozostaje jedynym przełącznikiem bloku ciemnego", () => {
    expect(arkusz).toContain(".dark {");
    expect(arkusz).not.toContain("prefers-color-scheme");
  });
});

describe("reguła rozstrzygania jest w JEDNYM miejscu", () => {
  // RATCHET. Ta bramka nie sprawdza zachowania - sprawdza, czy reguła nie
  // zaczęła się znów rozmnażać. Cztery kopie wyrażenia „jawny wybór wygrywa
  // z systemem" już raz się rozjechały (brak `!!` w wersjach napisowych),
  // a rozjazd był niewidoczny dla typów, dla lintera i dla wszystkich
  // pozostałych testów. Jedyne, co go wyłapie, to zakaz posiadania drugiej
  // kopii.
  const PLIKI = [
    "src/lib/theme/themeInitScript.ts",
    "src/components/ThemeProvider.tsx",
    "src/components/quiz/QuizBackground.tsx",
    "src/components/admin/ExpertLayoutPreview.tsx",
  ];

  it("żaden konsument nie czyta klucza magazynu na własną rękę", () => {
    for (const plik of PLIKI) {
      const tresc = readFileSync(plik, "utf8");
      // Klucz wolno wymienić WYŁĄCZNIE jako stałą `THEME_STORAGE_KEY`.
      // Literał `'theme'` w wywołaniu `getItem`/`setItem` znaczy, że ktoś
      // odtworzył regułę lokalnie.
      expect(tresc, `${plik} czyta magazyn literałem`).not.toMatch(
        /(get|set)Item\(\s*['"]theme['"]/,
      );
    }
  });

  it("żaden konsument nie pyta o `prefers-color-scheme` na własną rękę", () => {
    for (const plik of PLIKI) {
      const tresc = readFileSync(plik, "utf8");
      // Zapytanie o preferencję systemu jedzie przez `systemPrefersDark()`
      // albo przez `THEME_RESOLVE_JS`. Surowe `matchMedia('(prefers-color-
      // scheme: dark)')` w pliku konsumenta to druga kopia reguły.
      expect(tresc, `${plik} pyta system bezpośrednio`).not.toContain(
        "matchMedia('(prefers-color-scheme",
      );
      expect(tresc, `${plik} pyta system bezpośrednio`).not.toContain(
        'matchMedia("(prefers-color-scheme',
      );
    }
  });
});
