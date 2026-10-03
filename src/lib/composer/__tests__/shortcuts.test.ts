// Wiązania skrótów formatowania - `matchMarkdownShortcut` na zdarzeniach w
// kształcie, w jakim wysyła je przeglądarka.
//
// CO TEN PLIK DOWODZI.
// (1) SHIFT ROZSTRZYGA FIZYCZNY KLAWISZ. Ctrl+Shift+8 to `key: "*"`,
//     `code: "Digit8"`; dopasowanie po samym `key` nie trafiało nigdy.
// (2) UKŁAD NIEŁACIŃSKI też formatuje (cyrylica: `key: "и"`, `code: "KeyB"`),
//     ale łacińska litera na innym klawiszu (Dvorak: `key: "x"` na `KeyB`)
//     zostaje swoją literą - Ctrl+X ma dalej wycinać.
// (3) BEZ `code` (zdarzenia syntetyczne) działa dopasowanie po `key`.
// (4) NAZWA KLAWISZA TO NIE ZNAK. „Process" (IME), „Dead", „Unidentified"
//     nie idą po `code` - inaczej Ctrl+I w japońskim IME formatowałby tekst
//     w środku kompozycji.
// (5) NA APPLE SKRÓTEM JEST TYLKO CMD - Ctrl+E/K/B to tam systemowa edycja.
//
// Przypadki po samym `key` (Ctrl/Cmd, Alt, Cmd+Ctrl, podpowiedzi) ma
// `src/components/forms/__tests__/MessageComposerShortcuts.test.tsx`.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isAppleShortcutPlatform,
  matchMarkdownShortcut,
  type ShortcutEventLike,
} from "@/lib/composer/shortcuts";

function ev(partial: Partial<ShortcutEventLike> & { key: string }): ShortcutEventLike {
  return { ctrlKey: true, metaKey: false, shiftKey: false, altKey: false, ...partial };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("matchMarkdownShortcut - zdarzenia z przeglądarki", () => {
  it.each([
    ["*", "Digit8", "bulletList"],
    ["&", "Digit7", "numberedList"],
    [">", "Period", "quote"],
  ] as const)("Shift: `key` %s na `%s` -> %s", (key, code, expected) => {
    expect(matchMarkdownShortcut(ev({ key, code, shiftKey: true }))).toBe(expected);
  });

  it("ten sam fizyczny klawisz BEZ Shiftu nie jest skrótem listy", () => {
    expect(matchMarkdownShortcut(ev({ key: "8", code: "Digit8" }))).toBeNull();
  });

  it("Shift z literą nie trafia w wiązanie bez Shiftu (Ctrl+Shift+B)", () => {
    expect(matchMarkdownShortcut(ev({ key: "B", code: "KeyB", shiftKey: true }))).toBeNull();
  });

  it("cyrylica: Ctrl na fizycznym B pogrubia mimo innej litery", () => {
    expect(matchMarkdownShortcut(ev({ key: "и", code: "KeyB" }))).toBe("bold");
    expect(matchMarkdownShortcut(ev({ key: "л", code: "KeyK" }))).toBe("link");
  });

  it("cyrylica z Shiftem: litera innego pisma na fizycznej kropce to cytat", () => {
    // Układ rosyjski: fizyczna kropka to „ю", z Shiftem „Ю".
    expect(matchMarkdownShortcut(ev({ key: "Ю", code: "Period", shiftKey: true }))).toBe("quote");
  });

  it.each(["Process", "Dead", "Unidentified"])(
    "`key` %s (nazwa, nie znak) nie dopasowuje się po fizycznym klawiszu",
    (key) => {
      // Regresja, którą to łapie: Ctrl+I w IME Microsoftu (konwersja na
      // katakanę) przychodzi jako `key: "Process"`, `code: "KeyI"`.
      expect(matchMarkdownShortcut(ev({ key, code: "KeyI" }))).toBeNull();
      expect(matchMarkdownShortcut(ev({ key, code: "Digit8", shiftKey: true }))).toBeNull();
    },
  );

  it("Dvorak z Shiftem: Ctrl+Shift+V (wklej bez formatowania) nie jest cytatem", () => {
    // Fizyczna kropka to na Dvoraku „v". Łacińska litera nigdy nie idzie po `code`.
    expect(matchMarkdownShortcut(ev({ key: "V", code: "Period", shiftKey: true }))).toBeNull();
    expect(
      matchMarkdownShortcut(
        ev({ key: "V", code: "Period", shiftKey: true, ctrlKey: false, metaKey: true }),
      ),
    ).toBeNull();
  });

  it("Dvorak bez Shiftu: kropka na fizycznym E nie jest kodem", () => {
    // Bez Shiftu wiązania są literami - zastępuje je wyłącznie litera innego pisma.
    expect(matchMarkdownShortcut(ev({ key: ".", code: "KeyE" }))).toBeNull();
  });

  it("Dvorak: łacińska litera na fizycznym B zostaje swoją literą", () => {
    // Fizyczne `KeyB` to na Dvoraku „x" - Ctrl+X ma wyciąć, nie pogrubić.
    expect(matchMarkdownShortcut(ev({ key: "x", code: "KeyB" }))).toBeNull();
    // A fizyczne `KeyN` daje tam „b" - skrót idzie za znakiem.
    expect(matchMarkdownShortcut(ev({ key: "b", code: "KeyN" }))).toBe("bold");
  });

  it("zdarzenie bez `code` dopasowuje się po samym znaku", () => {
    expect(matchMarkdownShortcut(ev({ key: "e" }))).toBe("code");
    expect(matchMarkdownShortcut(ev({ key: "*", shiftKey: true }))).toBeNull();
  });
});

describe("matchMarkdownShortcut - platforma Apple", () => {
  it("Cmd formatuje", () => {
    expect(
      matchMarkdownShortcut(ev({ key: "b", ctrlKey: false, metaKey: true }), { apple: true }),
    ).toBe("bold");
  });

  it.each(["e", "k", "b"])("sam Ctrl+%s zostaje systemową edycją macOS", (key) => {
    // Regresja, którą to łapie: Ctrl+E (koniec linii) wstawiał „``" w komentarzu.
    expect(matchMarkdownShortcut(ev({ key }), { apple: true })).toBeNull();
  });

  it("poza Apple Ctrl formatuje jak dotąd", () => {
    expect(matchMarkdownShortcut(ev({ key: "e" }), { apple: false })).toBe("code");
  });
});

describe("isAppleShortcutPlatform", () => {
  it.each([
    ["MacIntel", "", true],
    ["", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", true],
    ["Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", false],
    ["Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)", false],
  ])("platform %j, UA %j -> %s", (platform, userAgent, expected) => {
    vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);

    expect(isAppleShortcutPlatform()).toBe(expected);
  });

  it("bez `navigator` (SSR w starszym środowisku) to nie Apple", () => {
    vi.stubGlobal("navigator", undefined);

    expect(isAppleShortcutPlatform()).toBe(false);
  });
});
