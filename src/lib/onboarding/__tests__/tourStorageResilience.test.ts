// MAGAZYN POSTĘPU PRZEWODNIKA - zachowanie, gdy `localStorage` KŁAMIE albo go NIE MA.
//
// CO TEN PLIK DOWODZI. `tourStorage` jest jedyną pamięcią przewodnika po panelu:
// decyduje, czy nowy redaktor zobaczy coachmarki i czy przestanie je widzieć po
// zamknięciu. Trzy sytuacje, w których naiwna implementacja wywraca CAŁY panel
// admina, a nie tylko przewodnik:
//
//   1. USZKODZONY WPIS. Pod naszym kluczem stoi obcy JSON albo ucięty łańcuch
//      (poprzednia wersja aplikacji, ręczna edycja w DevTools, rozszerzenie
//      przeglądarki). Odczyt musi dać jednoznaczną odpowiedź „nie widziano",
//      a nie rzucić - bo `isTourDismissed` jest wołane w efekcie haka podczas
//      montowania buildera: wyjątek stąd leci przez React w górę i zamiast
//      edytora strony redaktor dostaje biały ekran.
//   2. MAGAZYN NIEDOSTĘPNY. Tryb prywatny Safari i polityki „block all cookies"
//      rzucają `SecurityError` z SAMEGO DOSTĘPU do `localStorage` - nie z zapisu.
//      Panel musi wtedy działać dalej (przewodnik po prostu nie ma pamięci).
//   3. SSR. Pierwsze renderowanie leci na serwerze, gdzie `window` nie istnieje.
//      Odczyt musi tam powiedzieć „zamknięte", inaczej nakładka trafia do HTML-u
//      z serwera i rozjeżdża hydratację.
//
// Dowodzimy też ROZŁĄCZNOŚCI klucza: po wycieczce (builder vs bloki) i po
// wersji (bump prefiksu pokazuje przewodnik ponownie po przebudowie panelu).
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// - SZCZĘŚLIWEJ ŚCIEŻKI (zapis -> odczyt -> reset, rozłączność dwóch id):
//   `src/lib/onboarding/__tests__/tourStorage.test.ts`.
// - REGUŁ STARTU I ZAPAMIĘTANIA ZAKOŃCZENIA: to warstwa wyżej,
//   `src/lib/onboarding/__tests__/useOnboardingTour.test.tsx`.
// - NAKŁADKI I JEJ DOSTĘPNOŚCI:
//   `src/components/admin/onboarding/__tests__/CoachmarkTour.test.tsx`.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissTour, isTourDismissed, resetTour } from "@/lib/onboarding/tourStorage";

/** Klucze zapisane JAWNIE, nie wyliczone z kodu modułu. */
const KEY_BUILDER = "cms_onboarding:v1:builder";
const KEY_BLOCKS = "cms_onboarding:v1:blocks";

/** Awaria dostępu do magazynu w kształcie, w jakim zgłasza ją przeglądarka. */
function rzucBlokade(): never {
  throw new DOMException("The operation is insecure.", "SecurityError");
}

type MetodaMagazynu = "getItem" | "setItem" | "removeItem";

/**
 * Magazyn, który działa poprawnie POZA jedną metodą - ta rzuca `SecurityError`.
 * Podmieniamy CAŁĄ właściwość `window.localStorage` (a nie szpiegujemy metody),
 * bo w happy-dom `localStorage` jest proxy i `vi.restoreAllMocks()` nie umie
 * zdjąć z niego szpiega - awaria przeciekała do kolejnych testów w pliku.
 */
function magazynZAwaria(awaria: MetodaMagazynu): Storage {
  const dane = new Map<string, string>();
  return {
    get length() {
      return dane.size;
    },
    clear: () => dane.clear(),
    key: (index: number) => [...dane.keys()][index] ?? null,
    getItem: (key: string) => (awaria === "getItem" ? rzucBlokade() : (dane.get(key) ?? null)),
    setItem: (key: string, value: string) => {
      if (awaria === "setItem") rzucBlokade();
      dane.set(key, value);
    },
    removeItem: (key: string) => {
      if (awaria === "removeItem") rzucBlokade();
      dane.delete(key);
    },
  };
}

const OPIS_MAGAZYNU = Object.getOwnPropertyDescriptor(window, "localStorage");

function podmienMagazyn(magazyn: Storage): void {
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => magazyn });
}

function przywrocMagazyn(): void {
  if (OPIS_MAGAZYNU) Object.defineProperty(window, "localStorage", OPIS_MAGAZYNU);
}

/** Klucze magazynu - `Object.keys` na proxy happy-dom zwraca pustą tablicę. */
function kluczeMagazynu(): string[] {
  const out: string[] = [];
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i);
    if (key !== null) out.push(key);
  }
  return out;
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  przywrocMagazyn();
  window.localStorage.clear();
});

describe("uszkodzony wpis pod naszym kluczem", () => {
  // Każda z tych wartości mogła powstać: obiekt z poprzedniej wersji formatu,
  // ucięty zapis przy zamknięciu karty, ręczna edycja, wartość logiczna zamiast
  // znacznika. Żadna nie ma prawa ani rzucić, ani udać „zamknięte".
  it.each([
    ['{"seen":true}', "obcy JSON z poprzedniego formatu"],
    ['{"seen":tru', "ucięty łańcuch po przerwanym zapisie"],
    ["", "pusty łańcuch"],
    ["0", "zero jako znacznik"],
    ["true", "wartość logiczna zamiast znacznika"],
    [" 1", "znacznik z wiodącą spacją"],
    ["1 ", "znacznik ze spacją na końcu"],
    ["null", "napis null"],
    ["11", "podwójnie dopisany znacznik"],
  ])("wartość %j (%s) czyta się jako NIE ZAMKNIĘTE i nie rzuca", (raw) => {
    window.localStorage.setItem(KEY_BUILDER, raw);
    expect(() => isTourDismissed("builder")).not.toThrow();
    expect(isTourDismissed("builder")).toBe(false);
  });

  it("KANAREK: dokładnie ten sam odczyt widzi wpis zapisany przez `dismissTour`", () => {
    // Bez tej asercji cała grupa powyżej byłaby zielona także wtedy, gdyby
    // odczyt patrzył w ZŁY klucz i zawsze zwracał false.
    dismissTour("builder");
    expect(window.localStorage.getItem(KEY_BUILDER)).toBe("1");
    expect(isTourDismissed("builder")).toBe(true);
  });

  it("uszkodzony wpis daje się nadpisać - przewodnik odzyskuje pamięć po zamknięciu", () => {
    window.localStorage.setItem(KEY_BUILDER, '{"seen":true}');
    dismissTour("builder");
    expect(isTourDismissed("builder")).toBe(true);
  });
});

describe("magazyn niedostępny (tryb prywatny, zablokowane ciasteczka)", () => {
  it("wyjątek z ODCZYTU nie wywraca panelu - odpowiedź brzmi „nie widziano”", () => {
    // Magazyn MA wpis „zamknięte", ale odczyt rzuca. Ta para asercji dowodzi,
    // że `false` pochodzi z gałęzi `catch`, a nie z pustego magazynu.
    const magazyn = magazynZAwaria("getItem");
    podmienMagazyn(magazyn);
    expect(() => isTourDismissed("builder")).not.toThrow();
    expect(isTourDismissed("builder")).toBe(false);
  });

  it("wyjątek z ZAPISU nie wywraca panelu", () => {
    podmienMagazyn(magazynZAwaria("setItem"));
    expect(() => dismissTour("builder")).not.toThrow();
  });

  it("wyjątek z USUNIĘCIA nie wywraca panelu", () => {
    podmienMagazyn(magazynZAwaria("removeItem"));
    expect(() => resetTour("builder")).not.toThrow();
  });

  it("STAN FAKTYCZNY: gdy zapis jest zablokowany, przewodnik wraca po każdym odświeżeniu", () => {
    // To NIE jest życzenie, tylko opis rzeczywistości: bez pamięci nie ma jak
    // odnotować zamknięcia, więc redaktor w trybie prywatnym zobaczy coachmarki
    // przy każdym wejściu do buildera. Świadomy koszt - alternatywą byłoby
    // trzymanie flagi na serwerze (osobna kolumna profilu), czego ten moduł
    // nie robi.
    podmienMagazyn(magazynZAwaria("setItem"));
    dismissTour("builder");
    expect(isTourDismissed("builder")).toBe(false);
  });
});

describe("renderowanie po stronie serwera (brak `window`)", () => {
  it("odczyt mówi „zamknięte”, więc nakładka nie trafia do HTML-u z serwera", () => {
    // Odwrotna odpowiedź niż przy zablokowanym magazynie - i to jest celowe:
    // na serwerze „nie wiem" musi znaczyć „nie pokazuj", inaczej hydratacja
    // rozjeżdża się na nakładce, której klient nie narysuje.
    vi.stubGlobal("window", undefined);
    expect(isTourDismissed("builder")).toBe(true);
  });

  it("zapis i reset są bezpiecznymi pustymi operacjami", () => {
    vi.stubGlobal("window", undefined);
    expect(() => dismissTour("builder")).not.toThrow();
    expect(() => resetTour("builder")).not.toThrow();
  });

  it("nic nie zostało zapisane w magazynie klienta", () => {
    vi.stubGlobal("window", undefined);
    dismissTour("builder");
    vi.unstubAllGlobals();
    expect(window.localStorage.getItem(KEY_BUILDER)).toBeNull();
    expect(kluczeMagazynu()).toEqual([]);
  });
});

describe("rozłączność klucza", () => {
  it("zamknięcie jednej wycieczki nie zamyka drugiej, a reset nie kasuje sąsiada", () => {
    dismissTour("builder");
    dismissTour("blocks");
    resetTour("builder");
    expect(isTourDismissed("builder")).toBe(false);
    expect(isTourDismissed("blocks")).toBe(true);
    expect(window.localStorage.getItem(KEY_BLOCKS)).toBe("1");
  });

  it("wpis ze STARSZEJ wersji prefiksu nie ucisza nowego przewodnika", () => {
    // Po przebudowie panelu bump `VERSION` ma pokazać przewodnik ponownie -
    // dlatego stary klucz musi być dla odczytu niewidoczny.
    window.localStorage.setItem("cms_onboarding:v0:builder", "1");
    expect(isTourDismissed("builder")).toBe(false);
  });

  it("STAN FAKTYCZNY: klucz NIE zawiera identyfikatora użytkownika", () => {
    // Świadomy opis rzeczywistości, nie życzenie. Kod nigdzie nie obiecuje
    // rozdziału per konto - pamięć jest per PRZEGLĄDARKA. Konsekwencja: na
    // współdzielonej stacji w redakcji drugi admin nie zobaczy przewodnika,
    // bo pierwszy go zamknął. Gdyby ktoś chciał to zmienić, ten test pokaże,
    // że zmiana kształtu klucza jest ZAMIERZONA (i unieważnia stare wpisy).
    dismissTour("builder");
    expect(kluczeMagazynu()).toEqual([KEY_BUILDER]);
    expect(KEY_BUILDER.split(":")).toEqual(["cms_onboarding", "v1", "builder"]);
  });
});
