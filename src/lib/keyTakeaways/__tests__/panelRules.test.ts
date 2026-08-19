// Reguły panelu sekcji „dowiesz się", wyprowadzone z pliku trasy.
//
// Wcześniej wszystkie te decyzje siedziały w warunkach wewnątrz JSX, a tekst
// rozgałęział się po języku na sztywno (31 wystąpień `isPL ? "…" : "…"`).
// Deskryptor zwraca teraz KLUCZ, więc test opisuje strukturę, nie brzmienie.
import { describe, it, expect } from "vitest";
import {
  BORDER_WIDTH_BOUNDS,
  HIGHLIGHT_OFFSET_BOUNDS,
  HIGHLIGHT_SIZE_BOUNDS,
  HIGHLIGHT_SIZE_STEP,
  KEY_TAKEAWAYS_ICON_CHOICES,
  KEY_TAKEAWAYS_SAMPLE_KEYS,
  borderWidthValue,
  colorFieldValue,
  highlightIndicesKey,
  highlightOffsetY,
  highlightSizeScale,
  highlightWords,
  iconMatches,
  isWordHighlighted,
  keyTakeawaysColorFields,
  keyTakeawaysVariantDescriptors,
} from "@/lib/keyTakeaways/panelRules";
import {
  KEY_TAKEAWAYS_DEFAULTS,
  KEY_TAKEAWAYS_VARIANTS,
  KeyTakeawaysSettingsSchema,
} from "@/lib/keyTakeaways/settings";

describe("granice suwaków", () => {
  it("pokrywają się ze schematem ustawień, więc UI nie oferuje wartości, których baza odrzuci", () => {
    expect(HIGHLIGHT_SIZE_BOUNDS).toEqual({ min: 0.5, max: 3 });
    expect(HIGHLIGHT_OFFSET_BOUNDS).toEqual({ min: -200, max: 200 });
    expect(BORDER_WIDTH_BOUNDS).toEqual({ min: 0, max: 8 });
  });

  it("skrajne wartości granic PRZECHODZĄ walidację schematu", () => {
    const atMax = KeyTakeawaysSettingsSchema.safeParse({
      highlight: { sizeScale: HIGHLIGHT_SIZE_BOUNDS.max, offsetY: HIGHLIGHT_OFFSET_BOUNDS.max },
      colors: { borderWidth: BORDER_WIDTH_BOUNDS.max },
    });
    const overMax = KeyTakeawaysSettingsSchema.safeParse({
      highlight: { sizeScale: HIGHLIGHT_SIZE_BOUNDS.max + 0.1 },
    });
    expect(atMax.success).toBe(true);
    expect(overMax.success).toBe(false);
  });

  it("krok rozmiaru jest UŁAMKOWY - suwak ma trzydzieści pozycji, nie trzy", () => {
    expect(HIGHLIGHT_SIZE_STEP).toBe(0.05);
    const positions = (HIGHLIGHT_SIZE_BOUNDS.max - HIGHLIGHT_SIZE_BOUNDS.min) / HIGHLIGHT_SIZE_STEP;
    expect(positions).toBeGreaterThan(20);
  });
});

describe("keyTakeawaysVariantDescriptors", () => {
  it("trzy warianty ze schematu, w kolejności A / B / C", () => {
    expect(keyTakeawaysVariantDescriptors().map((v) => v.value)).toEqual([
      ...KEY_TAKEAWAYS_VARIANTS,
    ]);
    expect(keyTakeawaysVariantDescriptors()).toHaveLength(3);
  });

  it("każdy wariant ma OSOBNY klucz oznaczenia i osobny klucz opisu", () => {
    const descriptors = keyTakeawaysVariantDescriptors();
    const keys = descriptors.flatMap((v) => [v.badgeKey, v.descKey]);
    expect(new Set(keys).size).toBe(6);
    expect(descriptors.every((v) => v.badgeKey !== v.descKey)).toBe(true);
  });

  it("klucze są zbudowane z wartości wariantu, nie z jego numeru porządkowego", () => {
    const ghost = keyTakeawaysVariantDescriptors().find((v) => v.value === "ghost");
    expect(ghost?.badgeKey).toBe("adminPostPanes.keyTakeaways.variant.ghost.badge");
    expect(ghost?.descKey).toBe("adminPostPanes.keyTakeaways.variant.ghost.desc");
  });
});

describe("iconMatches - dopasowanie zapisanej ikony do siatki", () => {
  it("zapis kebab-case pasuje dokładnie", () => {
    expect(iconMatches("book-open", "book-open")).toBe(true);
    expect(iconMatches("book-open", "lightbulb")).toBe(false);
  });

  it("WIELKA LITERA nie psuje dopasowania (schemat domyślnie zapisuje `Search`)", () => {
    expect(iconMatches("Search", "search")).toBe(true);
    expect(iconMatches(KEY_TAKEAWAYS_DEFAULTS.icon, "search")).toBe(true);
  });

  it("zapis BEZ łącznika też pasuje (starsze wiersze trzymały `bookopen`)", () => {
    expect(iconMatches("bookopen", "book-open")).toBe(true);
    expect(iconMatches("BookOpen", "book-open")).toBe(true);
  });

  it("nazwa spoza siatki nie pasuje do niczego", () => {
    const matches = KEY_TAKEAWAYS_ICON_CHOICES.filter((name) => iconMatches("wymyslona", name));
    expect(matches).toEqual([]);
    expect(iconMatches("", "search")).toBe(false);
  });

  it("każda pozycja siatki pasuje do DOKŁADNIE jednej nazwy", () => {
    for (const name of KEY_TAKEAWAYS_ICON_CHOICES) {
      const hits = KEY_TAKEAWAYS_ICON_CHOICES.filter((other) => iconMatches(name, other));
      expect(hits).toEqual([name]);
    }
    expect(new Set(KEY_TAKEAWAYS_ICON_CHOICES).size).toBe(KEY_TAKEAWAYS_ICON_CHOICES.length);
  });
});

describe("highlightWords - słowa etykiety do podświetlenia", () => {
  it("rozdziela etykietę na słowa", () => {
    expect(highlightWords("Z tego artykułu dowiesz się")).toEqual([
      "Z",
      "tego",
      "artykułu",
      "dowiesz",
      "się",
    ]);
    expect(highlightWords("Jedno")).toEqual(["Jedno"]);
  });

  it("PODWÓJNE spacje i spacja na końcu nie produkują chipa bez treści", () => {
    // Chip bez treści to przycisk bez nazwy dostępnej - dla czytnika ekranu
    // niemożliwy do zidentyfikowania.
    expect(highlightWords("Z  tego ")).toEqual(["Z", "tego"]);
    expect(highlightWords("  ")).toEqual([]);
  });

  it("pusta etykieta daje pustą listę, nie wyjątek", () => {
    expect(highlightWords("")).toEqual([]);
    expect(highlightWords(undefined as unknown as string)).toEqual([]);
  });

  it("łamanie wiersza liczy się jako odstęp", () => {
    expect(highlightWords("Z\ntego\tartykułu")).toEqual(["Z", "tego", "artykułu"]);
    expect(highlightWords("Z\n\ntego")).toHaveLength(2);
  });
});

describe("highlightIndicesKey / isWordHighlighted", () => {
  it("każdy język ma WŁASNĄ listę indeksów (PL i EN mają inną liczbę słów)", () => {
    expect(highlightIndicesKey("pl")).toBe("indicesPl");
    expect(highlightIndicesKey("en")).toBe("indicesEn");
  });

  it("podświetlenie jednego języka NIE przecieka na drugi", () => {
    const highlight = { ...KEY_TAKEAWAYS_DEFAULTS.highlight, indicesPl: [1], indicesEn: [] };
    expect(isWordHighlighted(highlight, "pl", 1)).toBe(true);
    expect(isWordHighlighted(highlight, "en", 1)).toBe(false);
  });

  it("brak obiektu podświetlenia czyta się jako brak podświetleń", () => {
    expect(isWordHighlighted(undefined, "pl", 0)).toBe(false);
    expect(isWordHighlighted(KEY_TAKEAWAYS_DEFAULTS.highlight, "pl", 0)).toBe(false);
  });
});

describe("keyTakeawaysColorFields", () => {
  it("jedenaście pól koloru, bez `borderWidth` (to liczba, nie barwa)", () => {
    const keys = keyTakeawaysColorFields().map((f) => f.key);
    expect(keys).toHaveLength(11);
    expect(keys).not.toContain("borderWidth");
  });

  it("pola pokrywają CAŁY zestaw barw ze schematu", () => {
    const keys = new Set<string>(keyTakeawaysColorFields().map((f) => String(f.key)));
    const schemaColorKeys = Object.entries(KEY_TAKEAWAYS_DEFAULTS.colors)
      .filter(([, value]) => typeof value === "string")
      .map(([key]) => key);
    expect([...keys].sort()).toEqual(schemaColorKeys.sort());
    expect(schemaColorKeys).toHaveLength(11);
  });

  it("każde pole ma własny klucz etykiety zbudowany z nazwy pola", () => {
    for (const field of keyTakeawaysColorFields()) {
      expect(field.labelKey).toBe(`adminPostPanes.keyTakeaways.colorField.${field.key}`);
    }
    expect(new Set(keyTakeawaysColorFields().map((f) => f.labelKey)).size).toBe(11);
  });
});

describe("colorFieldValue - wartość gotowa dla selektora barwy", () => {
  it("wartość z ustawień przechodzi bez zmian", () => {
    expect(colorFieldValue(KEY_TAKEAWAYS_DEFAULTS.colors, "accent")).toBe(
      KEY_TAKEAWAYS_DEFAULTS.colors.accent,
    );
    expect(colorFieldValue(KEY_TAKEAWAYS_DEFAULTS.colors, "bg")).toBe(
      KEY_TAKEAWAYS_DEFAULTS.colors.bg,
    );
  });

  it("BRAK wartości schodzi do `transparent`, nie do pustego okienka selektora", () => {
    const colors = { ...KEY_TAKEAWAYS_DEFAULTS.colors, border: "" };
    expect(colorFieldValue(colors, "border")).toBe("transparent");
    expect(colorFieldValue({} as never, "border")).toBe("transparent");
  });

  it("wartość nietekstowa ze zepsutego wiersza też schodzi do `transparent`", () => {
    const colors = { ...KEY_TAKEAWAYS_DEFAULTS.colors, border: 5 as unknown as string };
    expect(colorFieldValue(colors, "border")).toBe("transparent");
    expect(colorFieldValue(colors, "accent")).not.toBe("transparent");
  });
});

describe("wartości domyślne pól opcjonalnych", () => {
  it("mnożnik rozmiaru bez zapisu to jedynka", () => {
    expect(highlightSizeScale(undefined)).toBe(1);
    expect(highlightSizeScale({ ...KEY_TAKEAWAYS_DEFAULTS.highlight, sizeScale: 1.5 })).toBe(1.5);
  });

  it("przesunięcie bez zapisu to zero", () => {
    expect(highlightOffsetY(undefined)).toBe(0);
    expect(highlightOffsetY({ ...KEY_TAKEAWAYS_DEFAULTS.highlight, offsetY: -40 })).toBe(-40);
  });

  it("grubość ramki bez zapisu to zero (brak ramki)", () => {
    expect(borderWidthValue(KEY_TAKEAWAYS_DEFAULTS.colors)).toBe(0);
    expect(borderWidthValue({ ...KEY_TAKEAWAYS_DEFAULTS.colors, borderWidth: 3 })).toBe(3);
  });

  it("STARSZY wiersz BEZ pola grubości czyta się jako zero, nie jako `undefined`", () => {
    // Pole doszło do schematu później, więc wiersze zapisane wcześniej go nie
    // mają. `undefined` w atrybucie suwaka zamieniłby go w kontrolkę
    // niekontrolowaną i React zgłosiłby ostrzeżenie.
    const legacy = { ...KEY_TAKEAWAYS_DEFAULTS.colors } as Record<string, unknown>;
    delete legacy.borderWidth;
    expect(borderWidthValue(legacy as never)).toBe(0);
    expect(highlightSizeScale({} as never)).toBe(1);
  });

  it("zero jako zapisana wartość NIE jest gubione jako falsy", () => {
    expect(highlightOffsetY({ ...KEY_TAKEAWAYS_DEFAULTS.highlight, offsetY: 0 })).toBe(0);
    expect(borderWidthValue({ ...KEY_TAKEAWAYS_DEFAULTS.colors, borderWidth: 0 })).toBe(0);
  });
});

describe("KEY_TAKEAWAYS_SAMPLE_KEYS", () => {
  it("trzy przykładowe punkty, każdy jako KLUCZ (nie tekst po polsku w kodzie)", () => {
    expect(KEY_TAKEAWAYS_SAMPLE_KEYS).toHaveLength(3);
    expect(
      KEY_TAKEAWAYS_SAMPLE_KEYS.every((k) => k.startsWith("adminPostPanes.keyTakeaways.sample.")),
    ).toBe(true);
  });

  it("klucze są różne - podgląd nie powtarza trzy razy tego samego zdania", () => {
    expect(new Set(KEY_TAKEAWAYS_SAMPLE_KEYS).size).toBe(3);
    expect(KEY_TAKEAWAYS_SAMPLE_KEYS.every((k) => k.length > 0)).toBe(true);
  });
});
