// Bloki kontekstowe wpisu (post-title / post-date / post-author / post-excerpt /
// post-featured-image / post-terms) - ContextBlockViews.
//
// Każdy z nich renderuje się z CurrentPostCtx, a nie z danych bloku, więc ma
// dwa stany, które widzi czytelnik: „kontekst jest" i „kontekstu nie ma albo
// brakuje pola". Drugi stan MUSI znikać bez śladu - szablon wpisu stoi także na
// stronach archiwum i podglądu, gdzie część pól jest pusta.
//
// Najważniejszy kontrakt to data względna: SSR i pierwszy render klienta
// pokazują datę ABSOLUTNĄ (identyczny HTML - hydratacja się nie rozjeżdża),
// a etykieta „3 godziny temu" pojawia się dopiero po montażu.
//
// Granice: router (AppLink czyta `useRouter`) przez wspólną atrapę Link.
// Kontekst wpisu jest prawdziwy (CurrentPostProvider) - to on jest wejściem.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import type { ReactElement } from "react";
import { CurrentPostProvider, type CurrentPostCtx } from "@/lib/content-model/postContext";

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub, useRouter: () => ({ navigate: () => undefined }) };
});

import {
  PostTitleView,
  PostDateView,
  PostAuthorView,
  PostExcerptView,
  PostFeaturedImageView,
  PostTermsView,
} from "../ContextBlockViews";

const NOW = new Date("2026-08-19T12:00:00.000Z");

const CTX: CurrentPostCtx = {
  kind: "post",
  id: "post-1",
  slug: "analiza-rynku",
  title_pl: "Analiza rynku",
  title_en: "Market analysis",
  excerpt_pl: "Zajawka po polsku.",
  excerpt_en: "English excerpt.",
  coverUrl: "https://cdn.test/okladka.jpg",
  publishedAt: "2026-08-19T09:00:00.000Z",
  updatedAt: "2026-08-19T11:00:00.000Z",
  author: {
    name: "Anna Nowak",
    slug: "anna-nowak",
    avatarUrl: "https://cdn.test/anna.jpg",
    bio_pl: "<p>Ekspertka <b>energetyki</b>.</p>",
    bio_en: "Energy expert.",
  },
  categories: [{ slug: "analizy", name: "Analizy" }],
  tags: [
    { slug: "energia", name: "energia" },
    { slug: "gaz", name: "gaz" },
  ],
};

function view(ui: ReactElement, ctx: CurrentPostCtx | null = CTX) {
  return render(<CurrentPostProvider value={ctx}>{ui}</CurrentPostProvider>);
}

const LEAKS = ["undefined", "NaN", "[object Object]", "Invalid Date", "null"];
function assertNoLeak(container: HTMLElement): void {
  for (const leak of LEAKS) expect(container.textContent ?? "").not.toContain(leak);
}

beforeEach(() => {
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PostTitleView", () => {
  it("renderuje tytuł w języku strony na żądanym poziomie nagłówka", () => {
    view(<PostTitleView level={2} lang="en" cls="" />);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Market analysis");
  });

  it("brak tłumaczenia spada na tytuł w drugim języku", () => {
    view(<PostTitleView level={1} lang="en" cls="" />, { ...CTX, title_en: undefined });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Analiza rynku");
  });

  it.each([
    [0, 1],
    [-3, 1],
    [4, 4],
    [9, 4],
  ])("poziom %i jest przycinany do h%i (poza zakresem 1-4 nie powstaje h0/h9)", (level, tag) => {
    view(<PostTitleView level={level} lang="pl" cls="" />);
    expect(screen.getByRole("heading", { level: tag })).toHaveTextContent("Analiza rynku");
  });

  it("BEZ tytułu w obu językach (i bez kontekstu) nie renderuje pustego nagłówka", () => {
    const { container } = view(<PostTitleView level={1} lang="pl" cls="" />, {
      ...CTX,
      title_pl: undefined,
      title_en: undefined,
    });
    expect(container.innerHTML).toBe("");
    const none = view(<PostTitleView level={1} lang="pl" cls="" />, null);
    expect(none.container.innerHTML).toBe("");
  });
});

describe("PostDateView", () => {
  it("format long pokazuje datę absolutną w strefie witryny i atrybut dateTime", () => {
    const { container } = view(<PostDateView format="long" showUpdated={false} lang="pl" cls="" />);
    const time = container.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe(CTX.publishedAt);
    expect(time?.textContent).toBe("19 sierpnia 2026");
  });

  it("format short pokazuje datę numeryczną", () => {
    const { container } = view(
      <PostDateView format="short" showUpdated={false} lang="pl" cls="" />,
    );
    expect(container.querySelector("time")?.textContent).toBe("19.08.2026");
  });

  it("showUpdated bierze datę aktualizacji, a bez niej wraca do daty publikacji", () => {
    const first = view(<PostDateView format="long" showUpdated lang="pl" cls="" />);
    expect(first.container.querySelector("time")?.getAttribute("dateTime")).toBe(CTX.updatedAt);
    cleanup();
    const second = view(<PostDateView format="long" showUpdated lang="pl" cls="" />, {
      ...CTX,
      updatedAt: undefined,
    });
    expect(second.container.querySelector("time")?.getAttribute("dateTime")).toBe(CTX.publishedAt);
  });

  it("format relative: HTML z serwera ma datę ABSOLUTNĄ (parytet hydratacji)", () => {
    const html = renderToString(
      <CurrentPostProvider value={CTX}>
        <PostDateView format="relative" showUpdated={false} lang="pl" cls="" />
      </CurrentPostProvider>,
    );
    expect(html).toContain("19 sierpnia 2026");
    expect(html).not.toContain("temu");
  });

  it.each([
    ["2026-08-19T09:00:00.000Z", "pl", "3 godziny temu"],
    ["2026-08-17T12:00:00.000Z", "pl", "przedwczoraj"],
    ["2026-06-19T12:00:00.000Z", "en", "2 months ago"],
    ["2024-08-19T12:00:00.000Z", "en", "2 years ago"],
  ] as const)("format relative po montażu: %s -> %s", (publishedAt, lang, label) => {
    const { container } = view(
      <PostDateView format="relative" showUpdated={false} lang={lang} cls="" />,
      { ...CTX, publishedAt },
    );
    expect(container.querySelector("time")?.textContent).toBe(label);
  });

  // NAPRAWIONE 2026-10-18: data nieprawidłowa w formacie „relative" WYWRACAŁA
  // widok po montażu. `new Date("zła").getTime()` to NaN, gałąź „rok" wołała
  // `Intl.RelativeTimeFormat#format(NaN)`, a ta RZUCA RangeError - błąd
  // renderu zabierał cały szablon wpisu do granicy błędu. Teraz data, której
  // nie da się odczytać, schodzi na ścieżkę absolutną (pusta etykieta).
  it("NIEPRAWIDŁOWA data w formacie relative nie wywraca renderu ani nie wycieka", () => {
    const { container } = view(
      <PostDateView format="relative" showUpdated={false} lang="pl" cls="" />,
      { ...CTX, publishedAt: "to-nie-data" },
    );
    const time = container.querySelector("time");
    expect(time?.getAttribute("dateTime")).toBe("to-nie-data");
    assertNoLeak(container);
  });

  it("BEZ daty (i bez kontekstu) nie renderuje pustego znacznika time", () => {
    const { container } = view(
      <PostDateView format="long" showUpdated={false} lang="pl" cls="" />,
      { ...CTX, publishedAt: undefined },
    );
    expect(container.querySelector("time")).toBeNull();
  });
});

describe("PostAuthorView", () => {
  it("autor ze slugiem linkuje do profilu, a biogram jest czystym tekstem bez HTML", () => {
    const { container } = view(<PostAuthorView showAvatar showBio lang="pl" cls="" />);
    expect(screen.getByRole("link", { name: "Anna Nowak" })).toHaveAttribute(
      "href",
      "/author/anna-nowak",
    );
    expect(screen.getByRole("img", { name: "Anna Nowak" })).toHaveAttribute(
      "src",
      "https://cdn.test/anna.jpg",
    );
    expect(container.textContent).toContain("Ekspertka energetyki.");
    expect(container.querySelector("b")).toBeNull();
  });

  it("biogram jest w języku strony", () => {
    const { container } = view(<PostAuthorView showAvatar={false} showBio lang="en" cls="" />);
    expect(container.textContent).toContain("Energy expert.");
    expect(container.querySelector("img")).toBeNull();
  });

  it("autor BEZ sluga jest tekstem, nie martwym odnośnikiem; showBio=false chowa biogram", () => {
    const { container } = view(<PostAuthorView showAvatar showBio={false} lang="pl" cls="" />, {
      ...CTX,
      author: { name: "Gość redakcji" },
    });
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toBe("Gość redakcji");
  });

  it("autor BEZ nazwy (albo bez autora) znika", () => {
    const { container } = view(<PostAuthorView showAvatar showBio lang="pl" cls="" />, {
      ...CTX,
      author: { slug: "x" },
    });
    expect(container.innerHTML).toBe("");
  });
});

describe("PostExcerptView", () => {
  it("zajawka z linkiem „czytaj dalej” prowadzi do wpisu i niesie tytuł w języku strony", () => {
    view(<PostExcerptView showMore lang="en" cls="" />);
    expect(screen.getByText(/English excerpt\./)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Read the full analysis: Market analysis" }),
    ).toHaveAttribute("href", "/post/analiza-rynku");
  });

  it("polska wersja linku i zapas tytułu na drugi język", () => {
    view(<PostExcerptView showMore lang="pl" cls="" />, { ...CTX, title_pl: undefined });
    expect(
      screen.getByRole("link", { name: "Przeczytaj całą analizę: Market analysis" }),
    ).toBeTruthy();
  });

  it("showMore=false albo brak sluga nie dokłada linku", () => {
    view(<PostExcerptView showMore={false} lang="pl" cls="" />);
    expect(screen.queryByRole("link")).toBeNull();
    cleanup();
    view(<PostExcerptView showMore lang="pl" cls="" />, { ...CTX, slug: undefined });
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("BEZ zajawki w języku strony blok znika", () => {
    const { container } = view(<PostExcerptView showMore lang="en" cls="" />, {
      ...CTX,
      excerpt_en: undefined,
    });
    expect(container.innerHTML).toBe("");
  });
});

describe("PostFeaturedImageView", () => {
  it("okładka dostaje proporcje z ustawień i tytuł jako tekst alternatywny", () => {
    const { container } = view(<PostFeaturedImageView aspect="16/9" rounded cls="" />);
    const figure = container.querySelector("figure") as HTMLElement;
    expect(figure.style.aspectRatio).toBe("16 / 9");
    expect(screen.getByRole("img", { name: "Analiza rynku" })).toBeTruthy();
  });

  it("BEZ okładki blok znika", () => {
    const { container } = view(<PostFeaturedImageView aspect="4/3" rounded={false} cls="" />, {
      ...CTX,
      coverUrl: undefined,
    });
    expect(container.innerHTML).toBe("");
  });
});

describe("PostTermsView", () => {
  it("kategorie linkują pod /category/<slug> z samą nazwą", () => {
    view(<PostTermsView taxonomy="categories" cls="" />);
    expect(screen.getByRole("link", { name: "Analizy" })).toHaveAttribute(
      "href",
      "/category/analizy",
    );
  });

  it("tagi linkują pod /tag/<slug> i dostają znak #", () => {
    view(<PostTermsView taxonomy="tags" cls="" />);
    const links = screen.getAllByRole("link");
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["#energia", "/tag/energia"],
      ["#gaz", "/tag/gaz"],
    ]);
  });

  it("PUSTA taksonomia (albo brak kontekstu) nie renderuje pustej listy", () => {
    const { container } = view(<PostTermsView taxonomy="tags" cls="" />, { ...CTX, tags: [] });
    expect(container.querySelector("ul")).toBeNull();
    const none = view(<PostTermsView taxonomy="categories" cls="" />, null);
    expect(none.container.innerHTML).toBe("");
  });
});
