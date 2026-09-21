// Skrypt anty-FOUC motywu - sprawdzany PRZEZ WYKONANIE, nie przez porównanie tekstu.
//
// CO TO DOWODZI. `THEME_INIT_SCRIPT` wykonuje się w `<head>` przed pierwszym
// malowaniem i jest jedyną rzeczą, która stoi między czytelnikiem a błyskiem
// białego tła na ciemnym motywie. Jako literał w `__root.tsx` miał 0% pokrycia:
// żaden test nie mógł go ani wywołać, ani nawet przeczytać.
//
// DLACZEGO WYKONANIE, A NIE ASERCJA NA TREŚCI. Asercja „tekst zawiera
// `classList.toggle`" przechodzi także dla skryptu z odwróconym warunkiem -
// czyli dla wersji, która zapala ciemny motyw u wszystkich, którzy wybrali
// jasny. Ten plik URUCHAMIA skrypt przez `new Function` i sprawdza SKUTEK na
// `documentElement`, czyli to samo, co zobaczy czytelnik.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. `ThemeProvider` (zapis wyboru do
// `localStorage`, przełącznik w UI) ma własne testy. Tutaj chodzi wyłącznie
// o odczyt przy starcie dokumentu - a to inny kod i inna chwila.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { THEME_INIT_SCRIPT } from "../themeInitScript";

/** Uruchamia skrypt dokładnie tak, jak zrobi to przeglądarka w `<head>`. */
function run(): void {
  new Function(THEME_INIT_SCRIPT)();
}

/** Ustawia odpowiedź `prefers-color-scheme`. */
function systemPrefersDark(dark: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: query.includes("prefers-color-scheme: dark") ? dark : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  });
}

function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}

function colorScheme(): string {
  return document.documentElement.style.colorScheme;
}

/**
 * Sprzątanie `<html>` po przebiegu. Atrybut wyboru (`data-motyw`) jest tu
 * zdejmowany, choć żadna asercja w tym pliku go nie czyta: skrypt go ZAPISUJE,
 * więc bez tego zostawałby na dokumencie i karmił kolejny przypadek stanem,
 * którego ten przypadek nie ustawił. Parytet obu ścieżek rozstrzygania
 * sprawdza osobny plik (`themeParity.test.ts`) - tu chodzi wyłącznie o skrypt.
 */
function wyczyscHtml(): void {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
  document.documentElement.removeAttribute("data-motyw");
}

beforeEach(() => {
  wyczyscHtml();
  systemPrefersDark(false);
});

afterEach(wyczyscHtml);

describe("zapisany wybór użytkownika wygrywa z systemem", () => {
  it("`dark` w magazynie zapala ciemny motyw także przy jasnym systemie", () => {
    localStorage.setItem("theme", "dark");
    systemPrefersDark(false);
    run();
    expect(isDark()).toBe(true);
    expect(colorScheme()).toBe("dark");
  });

  it("`light` w magazynie zostawia jasny motyw MIMO ciemnego systemu", () => {
    // To jest przypadek, którego asercja na treści skryptu nie wyłapie:
    // odwrócony warunek dałby tu ciemny motyw wbrew jawnemu wyborowi.
    localStorage.setItem("theme", "light");
    systemPrefersDark(true);
    run();
    expect(isDark()).toBe(false);
    expect(colorScheme()).toBe("light");
  });
});

describe("brak zapisanego wyboru - decyduje system", () => {
  it("ciemny system daje ciemny motyw", () => {
    systemPrefersDark(true);
    run();
    expect(isDark()).toBe(true);
    expect(colorScheme()).toBe("dark");
  });

  it("jasny system daje jasny motyw", () => {
    systemPrefersDark(false);
    run();
    expect(isDark()).toBe(false);
    expect(colorScheme()).toBe("light");
  });

  it("nieznana wartość w magazynie jest traktowana jak brak wyboru", () => {
    // Stara wersja aplikacji mogła zapisać cokolwiek; „sepia" nie może
    // zablokować podążania za systemem.
    localStorage.setItem("theme", "sepia");
    systemPrefersDark(true);
    run();
    expect(isDark()).toBe(true);
  });
});

describe("degradacja", () => {
  it("brak `matchMedia` nie rzuca wyjątkiem", () => {
    // Skrypt biegnie w `<head>`, więc nieobsłużony wyjątek zatrzymuje
    // parsowanie dokumentu - to nie jest „tylko brak motywu".
    Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
    expect(() => run()).not.toThrow();
  });

  // DEFEKT NAPRAWIONY - ten przypadek był tu wcześniej jako `it.fails`
  // z adnotacją „decyzja dla człowieka".
  //
  // CO BYŁO. Gdy `window.matchMedia` nie istniało, wyrażenie
  //   d = t==='dark' || (t!=='light' && window.matchMedia && window.matchMedia(...).matches)
  // dawało `undefined`, a nie `false` - łańcuch `&&` zwraca swój pierwszy
  // fałszywy członek. Dalej z tej JEDNEJ wartości działy się DWIE różne
  // rzeczy: `classList.toggle('dark', undefined)` jest wg specyfikacji
  // wywołaniem BEZ drugiego argumentu, więc PRZEŁĄCZAŁO klasę (przy czystym
  // `<html>` dodawało `dark`), a `d ? 'dark' : 'light'` traktowało `undefined`
  // jako fałsz i ustawiało `light`. Czytelnik, który nigdy nie wybrał ciemnego
  // motywu, dostawał ciemne tło z jasnym paskiem przewijania i jasnymi
  // kontrolkami formularza - w starych webview i w części przeglądarek
  // osadzonych.
  //
  // CO JEST. Wyrażenie stoi raz, w `themeChoice.ts` jako `THEME_RESOLVE_JS`,
  // i ma `!!(...)` wokół członu `matchMedia`, więc `d` jest zawsze prawdziwym
  // logicznym. Naprawa objęła jednocześnie drugi skrypt inline (preload tła
  // quizu), który nosił tę samą kopię wyrażenia.
  it("brak `matchMedia` daje SPÓJNY jasny motyw", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: undefined });
    run();
    expect({ dark: isDark(), scheme: colorScheme() }).toEqual({ dark: false, scheme: "light" });
  });

  it("zablokowany `localStorage` nie wywala dokumentu", () => {
    // Tryb prywatny: `localStorage.getItem` rzuca. Skrypt ma `try/catch`,
    // więc dokument musi wstać - bez motywu, ale wstać.
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new Error("odmowa dostępu");
    };
    try {
      expect(() => run()).not.toThrow();
    } finally {
      Storage.prototype.getItem = original;
    }
  });

  it("`color-scheme` jest ustawiane RAZEM z klasą", () => {
    // Bez `color-scheme` formularze i pasek przewijania zostają jasne na
    // ciemnej stronie - widoczny, brzydki rozjazd.
    systemPrefersDark(true);
    run();
    expect({ dark: isDark(), scheme: colorScheme() }).toEqual({ dark: true, scheme: "dark" });
  });

  it("wielokrotne uruchomienie jest idempotentne", () => {
    localStorage.setItem("theme", "dark");
    run();
    run();
    expect(document.documentElement.className.match(/dark/g)).toHaveLength(1);
  });
});
