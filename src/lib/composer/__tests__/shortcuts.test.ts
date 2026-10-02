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
