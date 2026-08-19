// Symultaniczny podgląd czasu czytania PL i EN (`useBilingualReadingStats`,
// 0 z 2 funkcji przed tą zmianą).
//
// Hook liczy to, co czytelnik zobaczy pod tytułem, gdy redaktor NIE nadpisze
// czasu ręcznie. Trzy rzeczy są tu warte testu:
//
//   1. ROZDZIAŁ JĘZYKÓW. Wpis ma osobną treść PL i EN o różnej długości.
//      Policzenie obu z tej samej strony pokazałoby redaktorowi jedną liczbę
//      dwa razy i ukryło, że wersja angielska jest o połowę krótsza.
//   2. WSZYSTKIE ŹRÓDŁA TREŚCI. Wpis może być pisany w HTML, w blokach albo
//      w builderze; pominięcie któregokolwiek daje „1 minuta" dla długiego
//      artykułu.
//   3. TE SAME USTAWIENIA, CO STRONA PUBLICZNA. Podgląd liczony innym rdzeniem
//      niż strona publiczna byłby gorszy niż brak podglądu - kłamałby.
import { describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { postForm } from "@/test/post-editor/fixtures";

// Ustawienia trzymamy w PRAWDZIWYM ksztalcie (`ReadingTimeSettings`) - atrapa
// z wymyslonymi polami dawalaby NaN i test „dowodzilby" czegokolwiek.
const h = vi.hoisted(() => ({ calls: [] as unknown[], settings: null as unknown }));

vi.mock("@/hooks/useReadingTimeSettings", () => ({
  useReadingTimeSettings: () => h.settings,
}));

vi.mock("@/lib/readingTime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/readingTime")>();
  return {
    ...actual,
    computeBilingualReadingStats: (input: unknown, settings: unknown) => {
      h.calls.push({ input, settings });
      return actual.computeBilingualReadingStats(
        input as Parameters<typeof actual.computeBilingualReadingStats>[0],
        settings as Parameters<typeof actual.computeBilingualReadingStats>[1],
      );
    },
  };
});

import { useBilingualReadingStats } from "../useBilingualReadingStats";
import { DEFAULT_READING_TIME_SETTINGS } from "@/lib/readingTime";

h.settings = DEFAULT_READING_TIME_SETTINGS;

type Input = {
  pl: { html: string; docs: unknown[]; extraText?: string };
  en: { html: string; docs: unknown[]; extraText?: string };
};
const lastInput = () => (h.calls.at(-1) as { input: Input }).input;

describe("useBilingualReadingStats - rozdział języków", () => {
  it("każda strona językowa dostaje SWÓJ HTML i SWOJĄ zajawkę", () => {
    // Policzenie obu z tej samej strony ukryłoby, że wersja EN jest krótsza.
    h.calls = [];
    renderHook(() =>
      useBilingualReadingStats(
        postForm({
          content_pl: "<p>Polska treść</p>",
          content_en: "<p>English body</p>",
          excerpt_pl: "Zajawka PL",
          excerpt_en: "Excerpt EN",
        }),
      ),
    );

    const input = lastInput();
    expect(input.pl.html).toBe("<p>Polska treść</p>");
    expect(input.en.html).toBe("<p>English body</p>");
    expect(input.pl.extraText).toBe("Zajawka PL");
    expect(input.en.extraText).toBe("Excerpt EN");
  });

  it("zwraca osobne statystyki dla obu języków", () => {
    const { result } = renderHook(() =>
      useBilingualReadingStats(
        postForm({
          content_pl: `<p>${"słowo ".repeat(600)}</p>`,
          content_en: "<p>short</p>",
        }),
      ),
    );

    expect(result.current.pl.minutes).toBeGreaterThan(result.current.en.minutes);
  });
});

describe("useBilingualReadingStats - źródła treści", () => {
  it("dokument BUDOWANY wchodzi do obliczeń obu języków", () => {
    // Builder jest wspólny dla PL i EN (jeden dokument, dwie warstwy tekstu).
    h.calls = [];
    const builder = { version: 1, sections: [] };
    renderHook(() => useBilingualReadingStats(postForm({ builder_data: builder as never })));

    const input = lastInput();
    expect(input.pl.docs).toContain(builder);
    expect(input.en.docs).toContain(builder);
  });

  it("dokument BLOKÓW wchodzi do WŁAŚCIWEJ strony językowej", () => {
    // Dokument bloków jest rozdzielony per język - podstawienie polskiego pod
    // angielski pokazałoby czytelnikowi EN czas polskiej wersji.
    h.calls = [];
    const pl = { version: 1, blocks: [{ type: "paragraph", text: "PL" }] };
    const en = { version: 1, blocks: [{ type: "paragraph", text: "EN" }] };
    renderHook(() => useBilingualReadingStats(postForm({ blocks_data: { pl, en } as never })));

    const input = lastInput();
    expect(input.pl.docs).toContain(pl);
    expect(input.pl.docs).not.toContain(en);
    expect(input.en.docs).toContain(en);
    expect(input.en.docs).not.toContain(pl);
  });

  it("brak treści nie wysypuje obliczeń - puste wejście, nie undefined", () => {
    h.calls = [];
    const { result } = renderHook(() =>
      useBilingualReadingStats(
        postForm({ content_pl: null, content_en: null, excerpt_pl: null, excerpt_en: null }),
      ),
    );

    const input = lastInput();
    expect(input.pl.html).toBe("");
    expect(input.en.html).toBe("");
    expect(input.pl.extraText).toBeUndefined();
    expect(result.current.pl.minutes).toBeGreaterThanOrEqual(0);
  });

  it("BRAK formularza (wpis się wczytuje) daje zerowe statystyki, nie wyjątek", () => {
    // Karta ustawień renderuje tę podpowiedź, zanim wiersz wpisu dojdzie.
    const { result } = renderHook(() => useBilingualReadingStats(null));
    expect(result.current.pl).toBeDefined();
    expect(result.current.en).toBeDefined();
  });
});

describe("useBilingualReadingStats - ustawienia serwisu", () => {
  it("liczy TYMI SAMYMI ustawieniami, co strona publiczna", () => {
    // Podgląd liczony innym rdzeniem niż strona publiczna kłamałby redaktorowi.
    h.calls = [];
    const custom = { ...DEFAULT_READING_TIME_SETTINGS, wpm_pl: 123, wpm_en: 456 };
    h.settings = custom;
    renderHook(() => useBilingualReadingStats(postForm()));

    expect((h.calls.at(-1) as { settings: unknown }).settings).toEqual(custom);
    h.settings = DEFAULT_READING_TIME_SETTINGS;
  });

  it("wynik jest memoizowany - ten sam formularz nie przelicza w kółko", () => {
    // Podgląd renderuje się przy każdym naciśnięciu klawisza w edytorze.
    h.calls = [];
    const form = postForm();
    const { rerender } = renderHook(() => useBilingualReadingStats(form));
    const afterFirst = h.calls.length;

    rerender();
    rerender();

    expect(h.calls.length).toBe(afterFirst);
  });
});
