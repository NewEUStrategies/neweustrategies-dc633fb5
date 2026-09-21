// Stopka wpisu: pasek tagów, karta autora i przejście do sąsiednich wpisów.
//
// CO TU JEST PRZYPINANE I DLACZEGO. Ten komponent nie liczy niczego, ale
// decyduje o trzech rzeczach, które łatwo zepsuć niezauważenie:
//
//   1. TRZY PASKI TO TRZY NIEZALEŻNE PRZEŁĄCZNIKI z ustawień układu. Każdy
//      ma WŁASNĄ flagę i własny warunek na dane (pusta lista tagów, brak
//      autora, brak sąsiadów). Test bierze każdy z osobna, bo wspólny
//      przypadek „wszystko włączone" przepuściłby pasek, który ignoruje
//      swoją flagę.
//
//   2. ADRES SĄSIEDNIEGO WPISU JEST SKLEJANY Z DWÓCH KOLUMN
//      (`parent_path` + `slug`) i musi stracić wiodący ukośnik - inaczej
//      trasa `/$` dostaje pusty pierwszy segment i odnośnik prowadzi w bok.
//      To jedyna logika w tym pliku, więc ma tu własne przypadki: z gałęzią
//      nadrzędną i bez niej.
//
//   3. GDY SĄSIAD ISTNIEJE TYLKO Z JEDNEJ STRONY, druga kolumna siatki
//      musi zostać pusta, a nie zniknąć - inaczej „następny" przeskakuje
//      na miejsce „poprzedniego".
//
// `Link` jest atrapą wystawiającą sklejony `_splat` w atrybucie: prawdziwy
// `<Link>` bez routera rzuca, a wspólna atrapa repo (`routerLinkStub`) nie
// pokazuje parametru splat, czyli akurat tej wartości, o którą tu chodzi.
// `react-i18next` jest podmieniony na PRAWDZIWY tłumacz (`realT`), żeby
// asercje mierzyły słownik `@/lib/i18n-public`.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  lang: "pl" as "pl" | "en",
  /** Prawdziwy `getFixedT`, wstrzyknięty pod importami - fabryka nic nie importuje. */
  fixedT: null as null | typeof realT,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: h.fixedT?.(h.lang), i18n: { language: h.lang }, ready: true }),
  initReactI18next: { type: "3rdParty" as const, init: () => {} },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    className,
    children,
  }: {
    to?: unknown;
    params?: { _splat?: string };
    preload?: unknown;
    className?: string;
    children?: ReactNode;
  }) => (
    <a href={`/${params?._splat ?? ""}`} data-to={String(to)} className={className}>
      {children}
    </a>
  ),
}));

import { PostFooterBars } from "@/components/PostFooterBars";
import { defaultPostLayoutSettings, type PostLayoutSettings } from "@/lib/postLayouts";
import { realT } from "@/test/i18nReal";
import "@/lib/i18n-public";

h.fixedT = realT;

type FooterProps = Parameters<typeof PostFooterBars>[0];

/** Ustawienia z WYŁĄCZONYMI paskami - każdy test włącza tylko swój. */
function settings(over: Partial<PostLayoutSettings> = {}): PostLayoutSettings {
  return {
    ...defaultPostLayoutSettings(),
    show_post_tags_bar: false,
    show_author_card: false,
    show_prev_next: false,
    prev_next_mobile_hide: false,
    ...over,
  };
}

function renderFooter(over: Partial<FooterProps> = {}) {
  return render(<PostFooterBars settings={settings()} lang={h.lang} {...over} />);
}

beforeEach(() => {
  h.lang = "pl";
});

describe("każdy pasek ma własny przełącznik", () => {
  it("z wyłączonymi paskami stopka jest pusta, mimo kompletu danych", () => {
    // Dane są, flagi nie - to jest dowód, że o widoczności decyduje
    // ustawienie układu, a nie obecność treści.
    const { container } = renderFooter({
      tags: [{ slug: "energia", name: "Energia" }],
      author: { display_name: "Anna Nowak", bio: "Analityczka", avatar_url: "/media/anna.jpg" },
      prev: { slug: "poprzedni", title: "Poprzedni wpis" },
      next: { slug: "nastepny", title: "Następny wpis" },
    });

    expect(container.querySelector("div")?.children).toHaveLength(0);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByText("Anna Nowak")).toBeNull();
  });

  it("włączony pasek tagów bez tagów NIE rysuje pustej listy", () => {
    renderFooter({ settings: settings({ show_post_tags_bar: true }), tags: [] });

    expect(screen.queryByText(realT("pl")("postFooter.tags"))).toBeNull();
  });

  it("włączona karta autora bez autora nic nie rysuje", () => {
    const { container } = renderFooter({ settings: settings({ show_author_card: true }) });

    expect(container.querySelector("div")?.children).toHaveLength(0);
  });

  it("włączone przejścia bez sąsiadów nie rysują pustej nawigacji", () => {
    renderFooter({ settings: settings({ show_prev_next: true }), prev: null, next: null });

    expect(screen.queryByRole("navigation")).toBeNull();
  });
});

describe("pasek tagów", () => {
  it("wypisuje etykietę ze słownika i wszystkie tagi z hashem", () => {
    renderFooter({
      settings: settings({ show_post_tags_bar: true }),
      tags: [
        { slug: "energia", name: "Energia" },
        { slug: "cee", name: "CEE" },
      ],
    });

    expect(screen.getByText(realT("pl")("postFooter.tags"))).toBeInTheDocument();
    expect(screen.getByText("#Energia")).toBeInTheDocument();
    expect(screen.getByText("#CEE")).toBeInTheDocument();
  });

  it("po angielsku etykieta idzie z angielskiego słownika", () => {
    h.lang = "en";
    renderFooter({
      settings: settings({ show_post_tags_bar: true }),
      tags: [{ slug: "energy", name: "Energy" }],
    });

    expect(screen.getByText("Tags")).toBeInTheDocument();
    expect(screen.queryByText(realT("pl")("postFooter.tags"))).toBeNull();
  });
});

describe("karta autora", () => {
  it("pokazuje nazwę, notę i zdjęcie z opisem alternatywnym", () => {
    renderFooter({
      settings: settings({ show_author_card: true }),
      author: {
        display_name: "Anna Nowak",
        bio: "Analityczka polityki energetycznej.",
        avatar_url: "https://example.com/media/anna.jpg",
      },
    });

    expect(screen.getByText("Anna Nowak")).toBeInTheDocument();
    expect(screen.getByText("Analityczka polityki energetycznej.")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Anna Nowak" })).toHaveAttribute(
      "src",
      "https://example.com/media/anna.jpg",
    );
  });

  it("autor bez zdjęcia nie zostawia pustej ramki obrazu", () => {
    renderFooter({
      settings: settings({ show_author_card: true }),
      author: { display_name: "Anna Nowak", avatar_url: null, bio: null },
    });

    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("Analityczka polityki energetycznej.")).toBeNull();
  });

  it("autor bez nazwy dostaje zapasowy podpis, a nie pusty wiersz", () => {
    renderFooter({
      settings: settings({ show_author_card: true }),
      author: { display_name: null, avatar_url: "https://example.com/media/x.jpg", bio: null },
    });

    expect(screen.getByText("Author")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Author" })).toBeInTheDocument();
  });
});

describe("przejścia do sąsiednich wpisów", () => {
  it("skleja adres z gałęzi nadrzędnej i sluga, bez wiodącego ukośnika", () => {
    // Wiodący ukośnik dałby trasie `/$` pusty pierwszy segment.
    renderFooter({
      settings: settings({ show_prev_next: true }),
      prev: { slug: "poprzedni", title: "Poprzedni wpis", parent_path: "/analizy" },
      next: { slug: "nastepny", title: "Następny wpis", parent_path: "/analizy" },
    });

    expect(screen.getByRole("link", { name: /Poprzedni wpis/ })).toHaveAttribute(
      "href",
      "/analizy/poprzedni",
    );
    expect(screen.getByRole("link", { name: /Następny wpis/ })).toHaveAttribute(
      "href",
      "/analizy/nastepny",
    );
  });

  it("wpis bez gałęzi nadrzędnej trafia prosto pod swój slug", () => {
    renderFooter({
      settings: settings({ show_prev_next: true }),
      prev: { slug: "poprzedni", title: "Poprzedni wpis" },
    });

    expect(screen.getByRole("link", { name: /Poprzedni wpis/ })).toHaveAttribute(
      "href",
      "/poprzedni",
    );
  });

  it("brakujący sąsiad zostawia PUSTE miejsce w siatce, nie przesuwa drugiego", () => {
    const { container } = renderFooter({
      settings: settings({ show_prev_next: true }),
      prev: null,
      next: { slug: "nastepny", title: "Następny wpis" },
    });

    const nav = screen.getByRole("navigation");
    expect(nav.children).toHaveLength(2);
    expect(nav.children[0].tagName).toBe("SPAN");
    expect(container.querySelectorAll("a")).toHaveLength(1);
  });

  it("nawigacja ma dostępną nazwę ze słownika, także po angielsku", () => {
    h.lang = "en";
    renderFooter({
      settings: settings({ show_prev_next: true }),
      next: { slug: "next-post", title: "Next post" },
    });

    expect(screen.getByRole("navigation", { name: "Post navigation" })).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
  });

  it("ukrycie na telefonie dokłada klasy responsywne, a nie chowa paska w ogóle", () => {
    renderFooter({
      settings: settings({ show_prev_next: true, prev_next_mobile_hide: true }),
      next: { slug: "nastepny", title: "Następny wpis" },
    });

    expect(screen.getByRole("navigation").className).toContain("hidden md:grid");
  });

  it("bez ukrywania na telefonie klasy responsywnej nie ma", () => {
    // Kontrola dodatnia do przypadku wyżej.
    renderFooter({
      settings: settings({ show_prev_next: true, prev_next_mobile_hide: false }),
      next: { slug: "nastepny", title: "Następny wpis" },
    });

    expect(screen.getByRole("navigation").className).not.toContain("hidden md:grid");
  });
});
