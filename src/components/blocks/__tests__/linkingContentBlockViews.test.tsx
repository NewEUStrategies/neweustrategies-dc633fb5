// Widoki bloków, których treścią są ODNOŚNIKI: spis treści (TocBlockView),
// cytat do udostępnienia na X (XQuoteShare), podgląd linków
// (LinkPreviewBlockView) i chmura tagów (TagCloudView).
//
// Co dowodzimy i dlaczego:
//   * każda pozycja spisu treści prowadzi do `id`, które NAPRAWDĘ istnieje
//     w tym samym dokumencie (jedna derywacja kotwic dla nagłówka i spisu),
//     z filtrem poziomów i wcięciem względem poziomu minimalnego;
//   * adres intencji X niesie tekst, `via` bez „@" i hashtagi bez „#" -
//     X dokleja „#" sam, więc „#UE" dawało „##UE" (naprawione);
//   * podgląd linków odrzuca niebezpieczne adresy, wybiera etykietę w języku
//     strony z rezerwą w drugim i łączy linki w zdanie albo listę;
//   * chmura tagów linkuje do `/tag/<slug>`, prosi o liczbę z bloku i znika,
//     gdy tagów nie ma.
//
// Granice: zapytanie chmury tagów (`@/lib/queries/blocks`, ma własne testy
// warstwy danych) zastępujemy opcjami zapytania z danymi z testu; reszta to
// publiczny `BlocksRenderer` z prawdziwym i18n i prawdziwy react-query.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import type { Block, BlocksDoc, Json } from "@/lib/blocks/types";
import { renderWithQueryClient } from "@/test/renderWithQueryClient";

const h = vi.hoisted(() => ({
  tags: [] as { slug: string; name: string }[],
  limits: [] as number[],
}));

vi.mock("@/lib/queries/blocks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries/blocks")>();
  return {
    ...actual,
    blockTagsQueryOptions: (limit: number) => {
      h.limits.push(limit);
      return {
        queryKey: ["public", "blocks", "tags", { limit }] as const,
        queryFn: async () => h.tags,
        staleTime: 0,
        gcTime: 0,
      };
    },
  };
});

import { BlocksRenderer } from "../BlocksRenderer";
import { XQuoteShare } from "../XQuoteShare";
import { TagCloudView } from "../TagCloudView";

const doc = (blocks: Block[]): BlocksDoc => ({ version: 1, blocks });

beforeEach(() => {
  h.tags = [];
  h.limits = [];
});

describe("spis treści", () => {
  const HEADINGS: Block[] = [
    { id: "h1", type: "heading", data: { level: 2, text: "Wstęp" } },
    { id: "h2", type: "heading", data: { level: 3, text: "Kontekst" } },
    { id: "h3", type: "heading", data: { level: 4, text: "Przypis techniczny" } },
    { id: "h4", type: "heading", data: { level: 2, text: "Wstęp" } },
  ];

  it("linkuje do kotwic istniejących w dokumencie, filtruje poziomy i wcina podrzędne", () => {
    const { container, getByRole } = render(
      <BlocksRenderer
        doc={doc([
          { id: "toc", type: "toc", data: { ordered: true, minLevel: 2, maxLevel: 3 } },
          ...HEADINGS,
        ])}
      />,
    );
    const nav = getByRole("navigation", { name: "Spis treści" });
    const items = Array.from(nav.querySelectorAll("ol > li"));
    const hrefs = items.map((li) => li.querySelector("a")?.getAttribute("href"));
    expect(items.map((li) => li.textContent)).toEqual(["Wstęp", "Kontekst", "Wstęp"]);
    // Każda pozycja trafia w istniejący nagłówek - także duplikat treści.
    for (const href of hrefs) {
      const target = container.querySelector(`[id="${href?.slice(1)}"]`);
      expect(target?.tagName).toMatch(/^H[2-5]$/);
    }
    expect(new Set(hrefs).size).toBe(3);
    expect(items.map((li) => (li as HTMLElement).style.marginLeft)).toEqual(["0px", "12px", "0px"]);
  });

  it("bez nagłówków w zakresie nie renderuje niczego; własny tytuł nazywa nawigację", () => {
    const { queryByRole, getByRole } = render(
      <BlocksRenderer
        doc={doc([
          { id: "t1", type: "toc", data: { minLevel: 5, maxLevel: 5 } },
          { id: "t2", type: "toc", data: { title: "W tym raporcie", columns: "col-9" } },
          ...HEADINGS,
        ])}
      />,
    );
    expect(queryByRole("navigation", { name: "Spis treści" })).toBeNull();
    const nav = getByRole("navigation", { name: "W tym raporcie" });
    // Domyślnie lista punktowana i poziomy 2-3.
    expect(nav.querySelectorAll("ul > li")).toHaveLength(3);
  });
});

describe("cytat do udostępnienia na X", () => {
  const intent = (a: HTMLElement) => new URL(a.getAttribute("href") ?? "");

  it("blok bez tekstu znika; z tekstem buduje adres intencji z `via` bez „@”", () => {
    const { getByRole, container } = render(
      <BlocksRenderer
        doc={doc([
          { id: "e", type: "xquote", data: { text: "" } },
          { id: "x", type: "xquote", data: { text: "Europa to my", via: "@nes_eu" } },
        ])}
        lang="en"
      />,
    );
    expect(container.querySelectorAll("figure")).toHaveLength(1);
    const link = getByRole("link", { name: "Share on X" });
    expect(link.getAttribute("target")).toBe("_blank");
    const url = intent(link);
    expect(url.origin + url.pathname).toBe("https://twitter.com/intent/tweet");
    expect(url.searchParams.get("text")).toBe("Europa to my");
    expect(url.searchParams.get("via")).toBe("nes_eu");
    expect(url.searchParams.has("hashtags")).toBe(false);
    expect(container.querySelector("blockquote")?.textContent).toBe('"Europa to my"');
  });

  it("NAPRAWIONE 2026-10-18: hashtagi tracą „#”, spacje i puste pozycje", () => {
    // WEJŚCIE: „#UE, #polityka energetyczna, ,#". Przed poprawką parametr
    // brzmiał „#UE,#politykaenergetyczna,,#", a X dokleja „#" sam.
    const { getByRole } = render(
      <XQuoteShare text="T" hashtags="#UE, #polityka energetyczna, ,#" url="https://nes.eu/a" />,
    );
    const url = intent(getByRole("link", { name: "Udostępnij na X" }));
    expect(url.searchParams.get("hashtags")).toBe("UE,politykaenergetyczna");
    expect(url.searchParams.get("url")).toBe("https://nes.eu/a");
  });

  it("same separatory w hashtagach nie dodają parametru", () => {
    const { getByRole } = render(<XQuoteShare text="T" hashtags=" #, , " />);
    expect(intent(getByRole("link")).searchParams.has("hashtags")).toBe(false);
  });
});

describe("podgląd linków", () => {
  const ITEMS: Json[] = [
    { url: "https://eur-lex.europa.eu/a", labelPl: "Dyrektywa", labelEn: "Directive" },
    { url: "javascript:alert(1)", labelPl: "Zło" },
    { url: "https://ec.europa.eu/b", labelPl: "Komisja" },
  ];

  it("łączy bezpieczne linki w zdanie z intro w języku strony i rezerwą etykiet", () => {
    const { container, getAllByRole } = render(
      <BlocksRenderer
        doc={doc([
          {
            id: "lp",
            type: "link-preview",
            data: { introEn: "See:", introPl: "Zobacz:", items: ITEMS, preview: false },
          },
        ])}
        lang="en"
      />,
    );
    const links = getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Directive", "https://eur-lex.europa.eu/a"],
      ["Komisja", "https://ec.europa.eu/b"],
    ]);
    expect(container.querySelector("p")?.textContent).toBe("See: Directive, Komisja");
    expect(links.every((a) => a.getAttribute("rel") === "noopener noreferrer")).toBe(true);
  });

  it("układ listy daje pozycje listy; nieznany język renderera traktuje jak polski", () => {
    const { getAllByRole, queryByText } = render(
      <BlocksRenderer
        doc={doc([{ id: "lp", type: "link-preview", data: { layout: "list", items: ITEMS } }])}
        lang="pl"
      />,
    );
    expect(getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Dyrektywa", "Komisja"]);
    // Bez intro nie ma pustego akapitu wstępu.
    expect(queryByText("Zobacz:")).toBeNull();
  });

  it("bez poprawnych adresów nie renderuje niczego", () => {
    const { container } = render(
      <BlocksRenderer
        doc={doc([
          { id: "lp", type: "link-preview", data: { introPl: "Nic", items: [{ url: "ftp://x" }] } },
        ])}
      />,
    );
    expect(container.textContent).toBe("");
  });
});

describe("chmura tagów", () => {
  it("linkuje każdy tag do jego strony i nazywa grupę w języku strony", async () => {
    h.tags = [
      { slug: "ue", name: "UE" },
      { slug: "energia", name: "Energia" },
    ];
    const { findByLabelText, getAllByRole } = renderWithQueryClient(
      <TagCloudView count={12} showCount={false} lang="en" />,
    );
    await findByLabelText("Tags");
    expect(getAllByRole("link").map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["#UE", "/tag/ue"],
      ["#Energia", "/tag/energia"],
    ]);
    // Opcje zapytania liczone są przy każdym renderze - zawsze z liczbą z bloku.
    expect([...new Set(h.limits)]).toEqual([12]);
  });

  it("w rendererze bez tagów nie zostawia pustej grupy", async () => {
    const { container, queryClient } = renderWithQueryClient(
      <BlocksRenderer doc={doc([{ id: "tc", type: "tag-cloud", data: { count: 5 } }])} />,
    );
    await waitFor(() =>
      expect(queryClient.getQueryState(["public", "blocks", "tags", { limit: 5 }])?.status).toBe(
        "success",
      ),
    );
    expect(container.querySelector("[aria-label='Tagi']")).toBeNull();
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });
});
