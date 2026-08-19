// Karty i sekcje huba eksperta: „W mediach" oraz kafel materiału.
//
// Katalog `components/experts` stał na 5% - to była największa pojedyncza
// dziura modułu 7 po pokryciu warstwy danych. Oba komponenty niosą reguły
// widoczne wyłącznie dla czytelnika: sekcja znika bez danych (a nie pokazuje
// pustego nagłówka), a linki zewnętrzne muszą mieć komplet atrybutów
// bezpieczeństwa i SEO.
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import type { ExpertMaterial, MediaMention } from "@/lib/experts/types";

vi.mock("@tanstack/react-router", async () => {
  const { RouterLinkStub } = await import("@/test/routerLinkStub");
  return { Link: RouterLinkStub };
});

const { ExpertInTheNews } = await import("@/components/experts/ExpertInTheNews");
const { ExpertMaterialCard } = await import("@/components/experts/ExpertMaterialCard");

const t = realT("pl");

function mention(overrides: Partial<MediaMention> = {}): MediaMention {
  return {
    id: "m1",
    outlet: "Rzeczpospolita",
    title: "Komentarz o pakiecie energetycznym",
    url: "https://rp.example/artykul",
    kind: "quote",
    language: "pl",
    published_on: "2026-07-15",
    cover_url: null,
    ...overrides,
  } as MediaMention;
}

function material(overrides: Partial<ExpertMaterial> = {}): ExpertMaterial {
  return {
    id: "x1",
    kind: "article",
    href: "/blog/analiza",
    title_pl: "Analiza pakietu",
    title_en: "Package analysis",
    excerpt_pl: "Streszczenie analizy",
    excerpt_en: "Analysis summary",
    cover_url: null,
    date: "2026-07-01",
    isCoauthor: false,
    ...overrides,
  } as ExpertMaterial;
}

afterEach(async () => {
  await i18n.changeLanguage("pl");
  vi.clearAllMocks();
});

describe("ExpertInTheNews", () => {
  it("bez wzmianek sekcja ZNIKA, zamiast pokazywać pusty nagłówek", () => {
    // Ekspert bez obecności medialnej nie może mieć na stronie sekcji
    // „W mediach" z pustą listą - to wygląda na awarię, nie na brak danych.
    const { container } = render(<ExpertInTheNews mentions={[]} lang="pl" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("pokazuje nagłówek sekcji i wpis", () => {
    render(<ExpertInTheNews mentions={[mention()]} lang="pl" />);
    expect(
      screen.getByRole("heading", { name: new RegExp(String(t("expert.inTheNews"))) }),
    ).toBeInTheDocument();
    expect(screen.getByText("Rzeczpospolita")).toBeInTheDocument();
    expect(screen.getByText("Komentarz o pakiecie energetycznym")).toBeInTheDocument();
  });

  it("link zewnętrzny otwiera się w nowej karcie i NIE przekazuje rangi", () => {
    // `nofollow` na cudzych publikacjach jest decyzją SEO: hub eksperta nie
    // ma być narzędziem do budowania rangi zewnętrznych serwisów.
    render(<ExpertInTheNews mentions={[mention()]} lang="pl" />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://rp.example/artykul");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("nofollow"));
  });

  it("wzmianka BEZ adresu nie udaje linku", () => {
    render(<ExpertInTheNews mentions={[mention({ url: null })]} lang="pl" />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Rzeczpospolita")).toBeInTheDocument();
  });

  it("data jest zapisana maszynowo w atrybucie, a czytelnie w treści", () => {
    // `<time dateTime>` jest tym, co czyta crawler i czytnik ekranu; format
    // widoczny zależy od języka.
    const { container } = render(<ExpertInTheNews mentions={[mention()]} lang="pl" />);
    expect(container.querySelector("time")).toHaveAttribute("datetime", "2026-07-15");
  });

  it("okładka wzmianki ma pusty tekst alternatywny i leniwe ładowanie", () => {
    const { container } = render(
      <ExpertInTheNews
        mentions={[mention({ cover_url: "https://cdn.example/x.jpg" })]}
        lang="pl"
      />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
  });

  it("okładka złożona z samych spacji jest traktowana jak jej brak", () => {
    const { container } = render(
      <ExpertInTheNews mentions={[mention({ cover_url: "   " })]} lang="pl" />,
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("renderuje wszystkie wzmianki", () => {
    render(
      <ExpertInTheNews
        mentions={[mention(), mention({ id: "m2", outlet: "Politico", url: null })]}
        lang="pl"
      />,
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });
});

describe("ExpertMaterialCard", () => {
  it("prowadzi pod adres materiału", () => {
    render(<ExpertMaterialCard material={material()} lang="pl" t={t} />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/blog/analiza");
  });

  it("tytuł i streszczenie idą w języku strony", () => {
    const { rerender } = render(<ExpertMaterialCard material={material()} lang="pl" t={t} />);
    expect(screen.getByText("Analiza pakietu")).toBeInTheDocument();
    expect(screen.getByText("Streszczenie analizy")).toBeInTheDocument();

    rerender(<ExpertMaterialCard material={material()} lang="en" t={t} />);
    expect(screen.getByText("Package analysis")).toBeInTheDocument();
  });

  it("brak tytułu angielskiego spada na polski", () => {
    // Pusty tytuł kafla to kafel, w który nie da się celowo kliknąć.
    render(<ExpertMaterialCard material={material({ title_en: "" })} lang="en" t={t} />);
    expect(screen.getByText("Analiza pakietu")).toBeInTheDocument();
  });

  it("materiał bez streszczenia nie zostawia pustego akapitu", () => {
    const { container } = render(
      <ExpertMaterialCard
        material={material({ excerpt_pl: "", excerpt_en: "" })}
        lang="pl"
        t={t}
      />,
    );
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("materiał bez daty nie zostawia pustej stopki", () => {
    const { container } = render(
      <ExpertMaterialCard material={material({ date: null, excerpt_pl: "" })} lang="pl" t={t} />,
    );
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it.each(["article", "report", "video", "podcast", "event"] as const)(
    "typ %s ma własną ikonę i etykietę",
    (kind) => {
      render(<ExpertMaterialCard material={material({ kind })} lang="pl" t={t} />);
      expect(screen.getByText(String(t(`expert.kind.${kind}`)))).toBeInTheDocument();
    },
  );

  it("materiał BEZ okładki dostaje zastępczą ikonę typu, nie pusty prostokąt", () => {
    const { container } = render(<ExpertMaterialCard material={material()} lang="pl" t={t} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelectorAll("svg").length).toBeGreaterThan(0);
  });

  it("okładka ma PUSTY tekst alternatywny - tytuł stoi obok", () => {
    const { container } = render(
      <ExpertMaterialCard
        material={material({ cover_url: "https://cdn.example/ok.jpg" })}
        lang="pl"
        t={t}
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
  });

  it("współautorstwo jest oznaczone osobną odznaką", () => {
    // Bez tego rozróżnienia hub eksperta przypisywałby mu cudze publikacje
    // jako własne.
    render(<ExpertMaterialCard material={material({ isCoauthor: true })} lang="pl" t={t} />);
    expect(screen.getByText(String(t("expert.coauthor")))).toBeInTheDocument();
  });

  it("bez współautorstwa odznaki nie ma", () => {
    render(<ExpertMaterialCard material={material()} lang="pl" t={t} />);
    expect(screen.queryByText(String(t("expert.coauthor")))).not.toBeInTheDocument();
  });
});
