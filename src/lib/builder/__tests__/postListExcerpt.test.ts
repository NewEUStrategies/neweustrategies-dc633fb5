// Predykat „widget renderuje zajawkę" (P3.7b, T2) - tabela przypadków.
//
// Predykat siedzi w kluczu zapytania post-listy (`withExcerpt`) i decyduje, czy
// wiersze w stanie `$tsr` niosą `excerpt_*`. Fałsz w miejscu, w którym widok
// zajawkę rysuje, to znikająca zajawka - dlatego tabela niżej wypisuje każdą
// gałąź widoku jawnie, a kopia `getBool` ma test równoważności z oryginałem.
// Kontrakt z samym znacznikiem (render pełnych i zrzutowanych wierszy) jest
// w `widget-view/__tests__/localizedPostRowsParity.test.tsx`.
import { describe, expect, it } from "vitest";
import type { WidgetContent } from "@/lib/builder/types";
import { getBool } from "@/components/builder/organisms/widget-view/frame";
import {
  excerptFrameBool,
  postListExcerptToggle,
  postListRendersExcerpt,
} from "@/lib/builder/postListExcerpt";
import { postListInput, postListQueryOptions } from "@/lib/builder/postListQuery";

const TOGGLES: unknown[] = [
  "0",
  "1",
  "",
  " no ",
  "YES",
  "false",
  "true",
  true,
  false,
  0,
  1,
  2,
  null,
  undefined,
];
const VARIANTS = [
  "card",
  "list",
  "minimal",
  "overlay",
  "ranked",
  "numbered",
  "classic",
  "flex-grid",
  "boxed-grid",
  "boxed-list",
  "nieznany",
  "",
];

describe("postListExcerptToggle - semantyka `getStr(c, 'showExcerpt') !== '0'` widoku", () => {
  it('wyłącza WYŁĄCZNIE napis "0"', () => {
    for (const v of TOGGLES) {
      expect(postListExcerptToggle({ showExcerpt: v } as WidgetContent), String(v)).toBe(v !== "0");
    }
  });
});

describe("excerptFrameBool = getBool z widget-view/frame.ts", () => {
  it("ta sama odpowiedź dla każdej wartości i obu domyślnych", () => {
    for (const v of TOGGLES) {
      for (const dflt of [true, false]) {
        const c = { showExcerpt: v } as WidgetContent;
        expect(excerptFrameBool(c, "showExcerpt", dflt), `${String(v)}/${dflt}`).toBe(
          getBool(c, "showExcerpt", dflt),
        );
      }
    }
  });
});

describe("postListRendersExcerpt - tabela wariant x przełącznik x powierzchnia", () => {
  /** Oczekiwanie wypisane z gałęzi `PostListView` (komentarze przy przypadkach). */
  function expected(variant: string, toggle: unknown, surface: "list" | "carousel"): boolean {
    // `excerpt()` widoku: globalny przełącznik - tylko napis "0" wyłącza.
    if (toggle === "0") return false;
    // Karuzela: każdy wariant przez `PostCard` z zajawką.
    if (surface === "carousel") return true;
    // `ranked`: indeks, tytuł i autor - bez zajawki.
    if (variant === "ranked") return false;
    // `numbered`: `showExcerpt && excerpt(p)` z `getBool(c, "showExcerpt", true)`.
    if (variant === "numbered")
      return getBool({ showExcerpt: toggle } as WidgetContent, "showExcerpt", true);
    // Reszta (także `overlay`: wiersz bez okładki spada na kartę z zajawką).
    return true;
  }

  for (const surface of ["list", "carousel"] as const) {
    it(`powierzchnia ${surface}`, () => {
      for (const variant of VARIANTS) {
        for (const toggle of TOGGLES) {
          const c = { variant, showExcerpt: toggle } as WidgetContent;
          const label = `${variant}/${String(toggle)}`;
          expect(postListRendersExcerpt(c, surface), label).toBe(
            expected(variant || "card", toggle, surface),
          );
          // Ten sam predykat w kluczu zapytania.
          expect(postListInput(c, "pl", surface).withExcerpt, label).toBe(
            postListRendersExcerpt(c, surface),
          );
        }
      }
    });
  }

  it("brak wariantu = karta (jak `getStr(c, 'variant') || 'card'` widoku)", () => {
    expect(postListRendersExcerpt({}, "list")).toBe(true);
    expect(postListRendersExcerpt({ variant: 7 } as WidgetContent, "list")).toBe(true);
  });
});

describe("klucz post-listy z `withExcerpt` (P3.7b, T2)", () => {
  it("`withExcerpt` jest ostatnim polem wejścia i rozdziela klucze", () => {
    const ranked: WidgetContent = { variant: "ranked", limit: 5 };
    const input = postListInput(ranked, "pl", "list");
    expect(Object.keys(input).at(-1)).toBe("withExcerpt");
    expect(input.withExcerpt).toBe(false);
    // Ten sam widget na karuzeli renderuje zajawkę - inny wpis cache.
    expect(postListQueryOptions(ranked, "pl", "list").queryKey).not.toEqual(
      postListQueryOptions(ranked, "pl", "carousel").queryKey,
    );
    // Widgety, które oba zajawkę rysują, dzielą klucz bez względu na powierzchnię.
    const card: WidgetContent = { variant: "card", limit: 5 };
    expect(postListQueryOptions(card, "pl", "list").queryKey).toEqual(
      postListQueryOptions(card, "pl", "carousel").queryKey,
    );
  });
});
