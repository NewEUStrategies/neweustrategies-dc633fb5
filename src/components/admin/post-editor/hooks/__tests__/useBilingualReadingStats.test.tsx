// Podgląd czasu czytania PL/EN obok pola `read_minutes`. Hook stał na 0%,
// a odpowiada za MAPOWANIE źródeł treści na dwie wersje językowe:
//
//   PL  <- content_pl + builder_data + blocks_data.pl + excerpt_pl
//   EN  <- content_en + builder_data + blocks_data.en + excerpt_en
//
// Pomyłka w tym przypisaniu nie wywraca niczego na ekranie - po prostu
// pokazuje redakcji nieprawdziwą liczbę minut, którą ta przepisuje do
// `read_minutes` i która trafia na stronę publiczną oraz do JSON-LD.
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_READING_TIME_SETTINGS, type ReadingTimeSettings } from "@/lib/readingTime";
import type { PostForm } from "../../types";

const h = vi.hoisted(() => ({
  settings: null as unknown,
}));

vi.mock("@/hooks/useReadingTimeSettings", () => ({
  useReadingTimeSettings: () => h.settings as ReadingTimeSettings,
}));

import { useBilingualReadingStats } from "../useBilingualReadingStats";

/** `n` rozróżnialnych słów - liczbę słów sprawdzamy wprost w asercjach. */
function words(n: number): string {
  return Array.from({ length: n }, (_, i) => `slowo${i}`).join(" ");
}

/**
 * Formularz zredukowany do pól, które ten hook czyta. Reszta `PostForm` nie
 * bierze udziału w obliczeniu, więc rzutowanie jest tu uczciwsze niż
 * przepisywanie osiemdziesięciu pól bez znaczenia dla reguły.
 */
function form(over: Partial<PostForm>): PostForm {
  return {
    content_pl: null,
    content_en: null,
    excerpt_pl: null,
    excerpt_en: null,
    builder_data: null,
    blocks_data: null,
    ...over,
  } as PostForm;
}

function blocksDoc(html: string): PostForm["blocks_data"] {
  return {
    pl: { version: 1, blocks: [{ id: "b1", type: "text", data: { html } }] },
    en: { version: 1, blocks: [{ id: "b1", type: "text", data: { html: "" } }] },
  } as unknown as PostForm["blocks_data"];
}

beforeEach(() => {
  h.settings = DEFAULT_READING_TIME_SETTINGS;
});

describe("czas czytania osobno dla każdej wersji językowej", () => {
  it("liczy PL i EN według prędkości właściwej dla języka", () => {
    const { result } = renderHook(() =>
      useBilingualReadingStats(
        form({ content_pl: `<p>${words(440)}</p>`, content_en: `<p>${words(238)}</p>` }),
      ),
    );

    // 440 słów / 220 wpm (PL) i 238 słów / 238 wpm (EN). Wspólne wpm dla obu
    // języków zaniżałoby polski tekst - polska fleksja daje dłuższe słowa.
    expect(result.current.pl).toEqual({ minutes: 2, words: 440, images: 0 });
    expect(result.current.en).toEqual({ minutes: 1, words: 238, images: 0 });
  });

  it("REGRESJA: bloki polskie nie wliczają się do wersji angielskiej", () => {
    const { result } = renderHook(() =>
      useBilingualReadingStats(form({ blocks_data: blocksDoc(words(660)) })),
    );

    // Podanie obu wersji bloków do obu języków pokazałoby przy angielskim
    // tekście czas polskiego - redakcja wpisałaby tę liczbę do `read_minutes`
    // i trafiłaby ona na stronę publiczną oraz do JSON-LD.
    expect(result.current.pl.minutes).toBe(3);
    expect(result.current.pl.words).toBeGreaterThan(660);
    expect(result.current.en.words).toBeLessThan(10);
  });

  it("dokument buildera liczy się do OBU wersji", () => {
    const builder = {
      version: 1,
      sections: [{ id: "s1", type: "text", props: { html: words(440) } }],
    } as unknown as PostForm["builder_data"];

    const { result } = renderHook(() => useBilingualReadingStats(form({ builder_data: builder })));

    // Strona zbudowana builderem jest JEDNA dla obu języków - pominięcie jej
    // w którejkolwiek wersji pokazałoby „0 min" dla pełnego artykułu.
    expect(result.current.pl.words).toBe(result.current.en.words);
    expect(result.current.pl.words).toBeGreaterThan(440);
  });

  it("dolicza zajawkę do treści właściwego języka", () => {
    const { result } = renderHook(() =>
      useBilingualReadingStats(form({ excerpt_pl: words(220), excerpt_en: words(119) })),
    );

    expect(result.current.pl.words).toBe(220);
    expect(result.current.en.words).toBe(119);
  });

  it("bez wczytanego wpisu pokazuje zero, zamiast się wywracać", () => {
    const { result } = renderHook(() => useBilingualReadingStats(null));

    // Hook liczy przy KAŻDYM renderze edytora, także zanim wiersz przyjdzie
    // z bazy - wyjątek tutaj wywala cały panel edycji.
    expect(result.current.pl).toEqual({ minutes: 0, words: 0, images: 0 });
    expect(result.current.en).toEqual({ minutes: 0, words: 0, images: 0 });
  });

  it("przelicza wynik według ustawień z panelu /admin/reading-time", () => {
    h.settings = { ...DEFAULT_READING_TIME_SETTINGS, wpm_pl: 110 } satisfies ReadingTimeSettings;
    const { result } = renderHook(() =>
      useBilingualReadingStats(form({ content_pl: `<p>${words(440)}</p>` })),
    );

    // Ta sama treść, dwa razy wolniejsze czytanie: podgląd w edytorze MUSI
    // pokazywać to samo, co strona publiczna, bo obie liczą tym samym rdzeniem
    // i tymi samymi ustawieniami.
    expect(result.current.pl.minutes).toBe(4);
  });
});

describe("stabilność wyniku między renderami", () => {
  it("nie przelicza wyniku, gdy zmienia się pole spoza treści", () => {
    const shared = { content_pl: `<p>${words(440)}</p>` };
    const { result, rerender } = renderHook(
      (props: { value: PostForm }) => useBilingualReadingStats(props.value),
      { initialProps: { value: form({ ...shared, title_pl: "Tytuł" } as Partial<PostForm>) } },
    );
    const first = result.current;

    rerender({ value: form({ ...shared, title_pl: "Tytuł po zmianie" } as Partial<PostForm>) });

    // Nowy obiekt wyniku przy każdym naciśnięciu klawisza w polu tytułu
    // przerysowywałby karty edytora, które go dostają w propsach - podgląd
    // migałby przez cały czas pisania.
    expect(result.current).toBe(first);
  });

  it("przelicza wynik, gdy zmieni się treść", () => {
    const { result, rerender } = renderHook(
      (props: { value: PostForm }) => useBilingualReadingStats(props.value),
      { initialProps: { value: form({ content_pl: `<p>${words(440)}</p>` }) } },
    );

    rerender({ value: form({ content_pl: `<p>${words(880)}</p>` }) });

    expect(result.current.pl).toEqual({ minutes: 4, words: 880, images: 0 });
  });
});
