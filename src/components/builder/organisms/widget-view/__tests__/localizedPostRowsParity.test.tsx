// Projekcja wierszy postów na język klucza (P2.5, HW-3b) - kontrakt
// z ODBIORCAMI, nie z samą funkcją.
//
// `localizePostListRows` i `localizeSliderPostRows` wpiekają w pole języka
// klucza łańcuch fallbacków widoku i zdejmują pola drugiego języka. Ich
// poprawność ma jedną miarę: widok wyrenderowany z wiersza zrzutowanego jest
// BAJT W BAJT tym samym znacznikiem, co z pełnego wiersza. Inaczej hydratacja
// strony z odwodnionym stanem nowego kształtu rozjechałaby się z HTML-em
// renderowanym ze starego (izolat sprzed wdrożenia) albo z podglądem edytora.
//
// Wiersze celowo brzegowe: tytuł tylko w jednym języku, pusty napis zamiast
// `null`, zajawka obecna tylko w drugim języku (post-lista NIE schodzi na
// drugi język zajawki, slider schodzi), wszystko puste.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactElement } from "react";
import type { WidgetContent } from "@/lib/builder/types";

vi.mock("@/integrations/supabase/client", () => {
  // Zapytania nie mają prawa wyjść do sieci: cache jest zasiany i świeży.
  const fail = () => {
    throw new Error("niespodziewane zapytanie - cache powinien wystarczyć");
  };
  return { supabase: { from: fail, rpc: fail } };
});
vi.mock("@/lib/builder/contentRefs", () => ({ useResolvedPostRefs: () => new Map() }));

import { PostListView } from "../PostListView";
import { PostsSliderWidget } from "../PostsSliderWidget";
import { localizePostListRows, postListQueryOptions } from "@/lib/builder/postListQuery";
import { localizeSliderPostRows, sliderPostsQueryOptions } from "@/lib/builder/sliderPostsQuery";

type Lang = "pl" | "en";

const BASE = {
  cover_image_url: null,
  published_at: "2026-01-02T00:00:00Z",
  post_format: null,
  author_id: null,
  author_display_name: null,
  author_avatar_url: null,
  author_slug: null,
};

const ROWS = [
  {
    ...BASE,
    id: "p1",
    slug: "oba",
    title_pl: "Tytuł polski",
    title_en: "English title",
    excerpt_pl: "Zajawka polska",
    excerpt_en: "English excerpt",
  },
  {
    ...BASE,
    id: "p2",
    slug: "tylko-en",
    title_pl: "",
    title_en: "Only English",
    excerpt_pl: null,
    excerpt_en: "English only excerpt",
  },
  {
    ...BASE,
    id: "p3",
    slug: "tylko-pl",
    title_pl: "Tylko polski",
    title_en: null,
    excerpt_pl: "Tylko polska zajawka",
    excerpt_en: "",
  },
  {
    ...BASE,
    id: "p4",
    slug: "pusty",
    title_pl: null,
    title_en: "",
    excerpt_pl: "",
    excerpt_en: null,
  },
];

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
}

function html(qc: QueryClient, ui: ReactElement): string {
  const { container, unmount } = render(
    <QueryClientProvider client={qc}>{ui}</QueryClientProvider>,
  );
  // `useId` liczy w obrębie procesu testu - szum licznika, nie różnica danych.
  const out = container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_r_");
  unmount();
  return out;
}

afterEach(cleanup);

describe("PostListView: wiersz zrzutowany na język = ten sam znacznik", () => {
  const variants = ["card", "list", "minimal", "ranked", "numbered"];

  for (const lang of ["pl", "en"] as const) {
    for (const variant of variants) {
      it(`${lang}, wariant ${variant}`, () => {
        const c: WidgetContent = { variant, limit: 4, columns: 2 };
        const key = postListQueryOptions(c, lang).queryKey;
        const full = client();
        full.setQueryData(key, ROWS);
        const projected = client();
        projected.setQueryData(key, localizePostListRows(ROWS, lang));

        const expected = html(full, <PostListView c={c} lang={lang} />);
        expect(expected).toContain(lang === "pl" ? "Tylko polski" : "Only English");
        expect(html(projected, <PostListView c={c} lang={lang} />)).toBe(expected);
      });
    }
  }

  it("projekcja zdejmuje pola drugiego języka i wpieka fallback tytułu", () => {
    const pl = localizePostListRows(ROWS, "pl");
    for (const row of pl) {
      expect(row).not.toHaveProperty("title_en");
      expect(row).not.toHaveProperty("excerpt_en");
    }
    expect(pl.map((r) => r.title_pl)).toEqual([
      "Tytuł polski",
      "Only English",
      "Tylko polski",
      null,
    ]);
    // Zajawka post-listy NIE schodzi na drugi język.
    expect(pl.map((r) => r.excerpt_pl)).toEqual([
      "Zajawka polska",
      null,
      "Tylko polska zajawka",
      "",
    ]);
    const en = localizePostListRows(ROWS, "en");
    expect(en.map((r) => r.title_en)).toEqual([
      "English title",
      "Only English",
      "Tylko polski",
      null,
    ]);
    expect(en.map((r) => r.excerpt_en)).toEqual([
      "English excerpt",
      "English only excerpt",
      "",
      null,
    ]);
    for (const row of en) {
      expect(row).not.toHaveProperty("title_pl");
      expect(row).not.toHaveProperty("excerpt_pl");
    }
  });
});

describe("PostsSliderWidget: wiersz zrzutowany na język = ten sam slajd", () => {
  async function sliderHtml(qc: QueryClient, c: WidgetContent, lang: Lang): Promise<string> {
    const view = render(
      <QueryClientProvider client={qc}>
        <PostsSliderWidget c={c} lang={lang} />
      </QueryClientProvider>,
    );
    // SliderRender jest leniwy - czekamy na złożony slider.
    await waitFor(() => expect(view.container.querySelector(".eh-slider")).not.toBeNull(), {
      timeout: 15_000,
    });
    const out = view.container.innerHTML.replace(/_r_[0-9a-z]+_/g, "_r_");
    view.unmount();
    return out;
  }

  for (const lang of ["pl", "en"] as const) {
    it(`${lang}: karty slidera (wszystkie slajdy w DOM)`, async () => {
      // `multi-card` renderuje KAŻDY slajd, więc porównanie obejmuje wszystkie
      // cztery wiersze, a nie tylko bieżący.
      const c: WidgetContent = { source: "posts", variant: "multi-card", autoplay: false };
      const key = sliderPostsQueryOptions(c, lang).queryKey;
      const full = client();
      full.setQueryData(key, ROWS);
      const projected = client();
      projected.setQueryData(key, localizeSliderPostRows(ROWS, lang));

      const expected = await sliderHtml(full, c, lang);
      // Slider (inaczej niż post-lista) schodzi na zajawkę drugiego języka.
      expect(expected).toContain(lang === "pl" ? "English only excerpt" : "Tylko polska zajawka");
      expect(await sliderHtml(projected, c, lang)).toBe(expected);
    });
  }
});
