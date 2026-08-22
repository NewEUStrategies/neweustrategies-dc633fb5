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

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
  systemPrefersDark(false);
});

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
});

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

  // DEFEKT ZGŁOSZONY, NIE NAPRAWIONY (istniał przed wyprowadzeniem skryptu -
  // treść przeniesiona znak w znak z `__root.tsx`).
  //
  // GDY `window.matchMedia` NIE ISTNIEJE, wyrażenie
  //   d = t==='dark' || (t!=='light' && window.matchMedia && window.matchMedia(...).matches)
  // daje `undefined`, a nie `false` - łańcuch `&&` zwraca swój pierwszy fałszywy
  // członek, którym jest tu `undefined`.
  //
  // Dalej dzieją się DWIE RÓŻNE rzeczy z tej samej wartości:
  //   * `classList.toggle('dark', undefined)` - drugi argument `undefined` jest
  //     wg specyfikacji traktowany jak ARGUMENT NIEOBECNY, więc metoda
  //     PRZEŁĄCZA klasę zamiast ją wyłączyć: przy czystym `<html>` DODAJE `dark`;
  //   * `style.colorScheme = d ? 'dark' : 'light'` - `undefined` jest fałszywe,
  //     więc ustawia `light`.
  //
  // KONSEKWENCJA: czytelnik, który nigdy nie wybrał ciemnego motywu, dostaje
  // ciemne style z jasnym `color-scheme` - czyli ciemną stronę z jasnym paskiem
  // przewijania i jasnymi kontrolkami formularzy. Zmierzony stan faktyczny:
  // `dark=true`, `color-scheme=light`. Dotyczy środowisk bez `matchMedia`
  // (stare webview, część osadzonych przeglądarek).
  //
  // Naprawa to jedna zmiana w skrypcie produkcyjnym (`!!(...)` albo `=== true`),
  // ale zmienia zachowanie renderu - decyzja dla człowieka.
  it.fails("brak `matchMedia` daje SPÓJNY jasny motyw", () => {
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
