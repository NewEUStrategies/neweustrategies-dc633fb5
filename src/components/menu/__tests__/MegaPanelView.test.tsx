// Wspólny widok panelu mega - jeden komponent obsługuje FRONT (SiteMenu)
// i PODGLĄD W ADMINIE (MenuManager). To jest cała stawka tego pliku: jeśli oba
// miejsca rozjadą się w treści, redaktor układa panel „na ślepo" - widzi
// w podglądzie co innego, niż zobaczy czytelnik.
//
// Do 18.08.2026 komponent miał 0 z 7 funkcji w pomiarze.
import { describe, expect, it, afterEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { MegaPanelView } from "@/components/menu/MegaPanelView";
import type { MegaFeaturedPost } from "@/lib/menus/megaFeatured";
import type { MegaColumn } from "@/lib/menus/types";

afterEach(cleanup);

function column(over: Partial<MegaColumn> = {}): MegaColumn {
  return {
    title_pl: "Analizy",
    title_en: "Analyses",
    href: "",
    links: [{ label_pl: "Raporty", label_en: "Reports", href: "/raporty", icon: "" }],
    ...over,
  };
}

function featuredPost(over: Partial<MegaFeaturedPost> = {}): MegaFeaturedPost {
  return {
    id: "post-1",
    slug: "analiza-ue",
    title_pl: "Analiza UE",
    title_en: "EU analysis",
    excerpt_pl: "Skrót po polsku",
    excerpt_en: "English summary",
    cover_image_url: null,
    published_at: "2026-08-01T10:00:00Z",
    post_format: null,
    author_id: null,
    author_display_name: null,
    author_slug: null,
    author_avatar_url: null,
    ...over,
  };
}

describe("kolumny i linki", () => {
  it("pokazuje tytuł kolumny i jej linki w bieżącym języku", () => {
    render(<MegaPanelView cols={[column()]} lang="en" />);
    expect(screen.getByText("Analyses")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /Reports/ })).toHaveAttribute("href", "/raporty");
  });

  it("bez tłumaczenia schodzi na drugi język zamiast pokazać pustkę", () => {
    render(<MegaPanelView cols={[column({ title_en: "", links: [] })]} lang="en" />);
    expect(screen.getByText("Analizy")).toBeTruthy();
  });

  it("nagłówek kolumny z adresem jest LINKIEM, bez adresu zwykłym tekstem", () => {
    // Edytor od dawna pozwalał wskazać stronę dla nagłówka kolumny; dopóki
    // renderer nie czytał `href`, było to ustawienie martwe.
    const withHref = render(<MegaPanelView cols={[column({ href: "/analizy" })]} lang="pl" />);
    expect(withHref.container.querySelectorAll('a[href="/analizy"]').length).toBeGreaterThan(0);
    withHref.unmount();

    const withoutHref = render(<MegaPanelView cols={[column({ href: "" })]} lang="pl" />);
    expect(withoutHref.container.querySelector('a[href="/analizy"]')).toBeNull();
    expect(screen.getByText("Analizy")).toBeTruthy();
  });

  it("kolumna z adresem dostaje stopkę „przejdź do sekcji”", () => {
    render(<MegaPanelView cols={[column({ href: "/analizy" })]} lang="pl" />);
    expect(screen.getByText(/Przejdź do sekcji/)).toBeTruthy();
  });

  it("link bez etykiety w obu językach nie zostawia pustego wiersza", () => {
    render(
      <MegaPanelView
        cols={[column({ links: [{ label_pl: "", label_en: "", href: "/x", icon: "" }] })]}
        lang="pl"
      />,
    );
    expect(screen.queryAllByRole("menuitem")).toHaveLength(0);
  });

  it("adres wykonujący skrypt nie trafia do href", () => {
    render(
      <MegaPanelView
        cols={[
          column({
            links: [{ label_pl: "Zły", label_en: "", href: "javascript:alert(1)", icon: "" }],
          }),
        ]}
        lang="pl"
      />,
    );
    expect(screen.getByRole("menuitem", { name: /Zły/ })).toHaveAttribute("href", "#");
  });

  it("panel bez kolumn nie renderuje niczego", () => {
    const { container } = render(<MegaPanelView cols={[]} lang="pl" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("nagłówek rodzica prowadzi na stronę sekcji", () => {
    render(<MegaPanelView cols={[column()]} lang="pl" parentLabel="Wiedza" parentHref="/wiedza" />);
    expect(screen.getByText(/Przejdź do strony/)).toBeTruthy();
    expect(screen.getAllByRole("link").some((a) => a.getAttribute("href") === "/wiedza")).toBe(
      true,
    );
  });
});

describe("kolumna wyróżniona", () => {
  it("wchodzi przy wąskim panelu (do dwóch kolumn) i pokazuje tytuł, zajawkę i CTA", () => {
    render(<MegaPanelView cols={[column()]} lang="pl" featured={featuredPost()} />);
    expect(screen.getByRole("heading", { name: "Analiza UE" })).toBeTruthy();
    expect(screen.getByText("Skrót po polsku")).toBeTruthy();
    expect(screen.getByText("Czytaj więcej")).toBeTruthy();
    // Plakietka nad kartą + opis przy CTA - dwa miejsca, ta sama etykieta.
    expect(screen.getAllByText("Wyróżniony wpis")).toHaveLength(2);
  });

  it("NIE wchodzi przy szerokim panelu - trzy kolumny wypełniają całą szerokość", () => {
    render(
      <MegaPanelView
        cols={[column(), column({ title_pl: "B" }), column({ title_pl: "C" })]}
        lang="pl"
        featured={featuredPost()}
      />,
    );
    expect(screen.queryByRole("heading", { name: "Analiza UE" })).toBeNull();
  });

  it("format wpisu opisuje CTA, a plakietka zostaje ogólna", () => {
    render(
      <MegaPanelView
        cols={[column()]}
        lang="en"
        featured={featuredPost({ post_format: "video" })}
      />,
    );
    expect(screen.getByText("Video")).toBeTruthy();
    // Plakietka nad kartą nadal mówi „to jest wyróżnienie", nie „to jest wideo".
    expect(screen.getAllByText("Featured")).toHaveLength(1);
  });

  it("nieznany format schodzi na ogólną etykietę, a nie na pustkę", () => {
    render(
      <MegaPanelView
        cols={[column()]}
        lang="pl"
        featured={featuredPost({ post_format: "nieznany" })}
      />,
    );
    expect(screen.getAllByText("Wyróżniony wpis")).toHaveLength(2);
  });

  it("autor z profilem publicznym jest linkiem, autor bez profilu - tekstem", () => {
    const { unmount } = render(
      <MegaPanelView
        cols={[column()]}
        lang="pl"
        featured={featuredPost({
          author_id: "u1",
          author_display_name: "Anna Nowak",
          author_slug: "anna-nowak",
        })}
      />,
    );
    expect(screen.getByRole("menuitem", { name: /Anna Nowak/ })).toHaveAttribute(
      "href",
      "/author/anna-nowak",
    );
    unmount();

    render(
      <MegaPanelView
        cols={[column()]}
        lang="pl"
        featured={featuredPost({ author_id: "u1", author_display_name: "Anna Nowak" })}
      />,
    );
    expect(screen.queryByRole("menuitem", { name: /Anna Nowak/ })).toBeNull();
    expect(screen.getByText("Anna Nowak")).toBeTruthy();
  });

  it("bez awatara pokazuje inicjały imienia i nazwiska", () => {
    render(
      <MegaPanelView
        cols={[column()]}
        lang="pl"
        featured={featuredPost({ author_id: "u1", author_display_name: "Anna Nowak" })}
      />,
    );
    expect(screen.getByText("AN")).toBeTruthy();
  });

  it("autor bez nazwy nie zostawia pustego wiersza - wchodzi opis zastępczy", () => {
    render(
      <MegaPanelView cols={[column()]} lang="en" featured={featuredPost({ author_id: "u1" })} />,
    );
    expect(screen.getByText("Unknown author")).toBeTruthy();
  });

  it("okładka wpisu jest dekoracją (puste alt), a nie treścią do odczytania", () => {
    const { container } = render(
      <MegaPanelView
        cols={[column()]}
        lang="pl"
        featured={featuredPost({ cover_image_url: "https://example.com/cover.jpg" })}
      />,
    );
    const img = container.querySelector('img[src="https://example.com/cover.jpg"]');
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("alt", "");
    expect(img).toHaveAttribute("loading", "lazy");
  });
});

describe("warianty osadzenia", () => {
  it("wariant „live” siada na tle warstwy wypływającej (popover)", () => {
    // Panel nagłówka unosi się NAD stroną, więc musi mieć własne, nieprzezroczyste
    // tło - inaczej prześwituje przez niego treść artykułu.
    const { container } = render(<MegaPanelView cols={[column()]} lang="pl" variant="live" />);
    const root = container.querySelector('[role="menu"]');
    expect(root?.className).toContain("bg-popover");
  });

  it("wariant podglądu w adminie wchodzi w tło karty panelu", () => {
    const { container } = render(<MegaPanelView cols={[column()]} lang="pl" variant="preview" />);
    const root = container.querySelector('[role="menu"]');
    expect(root?.className).toContain("bg-background");
    expect(root?.className).not.toContain("bg-popover");
  });

  it("panel jest menu dla czytnika ekranu, a linki jego pozycjami", () => {
    render(<MegaPanelView cols={[column()]} lang="pl" />);
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem").length).toBeGreaterThan(0);
  });
});
