// Powierzchnie prezentacyjne wpisu, które stały na ZERZE pokrycia. Każda z nich
// jest widoczna dla czytelnika i każda ma warunek „kiedy w ogóle się pokazuję" -
// bo w tym module „brak sekcji" jest świadomą decyzją produktową (zero szumu),
// a nie stanem awaryjnym. Test bez asercji na TEN warunek nie dowodzi niczego.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
  useRouter: () => ({ preloadRoute: vi.fn(), navigate: vi.fn() }),
}));

vi.mock("react-i18next", async () => {
  const fixtures = await import("@/test/postExperience/fixtures");
  return fixtures.reactI18nextStub();
});

import { CategoryBadges } from "@/components/post/CategoryBadges";
import { CustomMetaList } from "@/components/post/CustomMetaList";
import { PrintBriefHeader } from "@/components/post/PrintBriefHeader";
import { PostOrganizationCard } from "@/components/post/PostOrganizationCard";
import { accentFor } from "@/components/post/relatedVisuals";
import { DARK_TEXT, LIGHT_TEXT } from "@/lib/post/badgeContrast";
import { SITE_NAME } from "@/lib/seo/meta";
import type { CustomMetaDef } from "@/lib/customMeta";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CategoryBadges", () => {
  const items = [
    { slug: "obrona", name_pl: "Obrona", name_en: "Defence", color: "#0f172a" },
    { slug: "energia", name_pl: "Energia", name_en: "Energy", color: null },
  ];

  it("renderuje pigułkę na kategorię, każdą jako link do archiwum", () => {
    render(<CategoryBadges items={items} lang="pl" />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute("href", "/category/obrona");
  });

  it("PUSTA lista nie renderuje niczego (zero szumu nad tytułem)", () => {
    const { container } = render(<CategoryBadges items={[]} lang="pl" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("wariant angielski bierze nazwy EN i prefiks `/en/`", () => {
    render(<CategoryBadges items={items} lang="en" />);
    expect(screen.getByRole("link", { name: "Defence" })).toHaveAttribute(
      "href",
      "/en/category/obrona",
    );
    expect(screen.getByRole("link", { name: "Energy" })).toBeInTheDocument();
  });

  it("kolor kategorii daje tło ORAZ czytelny napis (kontrast, nie przypadek)", () => {
    render(<CategoryBadges items={items} lang="pl" />);
    const colored = screen.getByRole("link", { name: "Obrona" });
    expect(colored.getAttribute("style")).toContain("background-color");
    expect(colored.getAttribute("style")).toContain(LIGHT_TEXT);
  });

  it("BRAK koloru daje neutralną pigułkę motywu, bez atrybutu style", () => {
    render(<CategoryBadges items={items} lang="pl" />);
    const plain = screen.getByRole("link", { name: "Energia" });
    expect(plain).not.toHaveAttribute("style");
    expect(plain.className).toContain("bg-foreground/85");
  });

  it("jasny kolor kategorii dostaje CIEMNY napis", () => {
    render(
      <CategoryBadges
        items={[{ slug: "x", name_pl: "Jasna", name_en: "Light", color: "#ffffff" }]}
        lang="pl"
      />,
    );
    expect(screen.getByRole("link", { name: "Jasna" }).getAttribute("style")).toContain(DARK_TEXT);
  });
});

describe("CustomMetaList", () => {
  // Wartości są kluczowane po `def.key`, NIE po `def.id` - fixture odwzorowuje
  // prawdziwy wiersz `post_custom_meta_defs`, inaczej test „dowodziłby", że pola
  // własne się nie renderują.
  function def(overrides: Partial<CustomMetaDef>): CustomMetaDef {
    return {
      id: "d-1",
      tenant_id: "ten_1",
      key: "region",
      label_pl: "Region",
      label_en: "Region",
      icon: "MapPin",
      position: 0,
      ...overrides,
    };
  }

  const defs: CustomMetaDef[] = [
    def({ id: "d-region", key: "region" }),
    def({ id: "d-zakres", key: "zakres", label_pl: "Zakres", label_en: "Scope", icon: "Clock" }),
  ];

  it("renderuje pozycję na każdą WYPEŁNIONĄ wartość", () => {
    render(<CustomMetaList defs={defs} values={{ region: "CEE", zakres: "2026" }} lang="pl" />);
    expect(screen.getByText("CEE")).toBeInTheDocument();
    expect(screen.getByText("2026")).toBeInTheDocument();
  });

  it("BRAK wartości (null) nie renderuje sekcji - pola własne są opcjonalne", () => {
    const { container } = render(<CustomMetaList defs={defs} values={null} lang="pl" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("PUSTA wartość pola jest pomijana, wypełnione zostają", () => {
    render(<CustomMetaList defs={defs} values={{ region: "", zakres: "2026" }} lang="pl" />);
    expect(screen.getByText("2026")).toBeInTheDocument();
    expect(screen.queryByText("CEE")).toBeNull();
  });

  it("pusta lista definicji nie renderuje niczego", () => {
    const { container } = render(<CustomMetaList defs={[]} values={{ region: "CEE" }} lang="pl" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("wariant `inline` jest LISTĄ, `stacked` listą DEFINICJI (różna semantyka)", () => {
    const { container: inline } = render(
      <CustomMetaList defs={defs} values={{ region: "CEE" }} lang="pl" />,
    );
    expect(inline.querySelector("ul")).not.toBeNull();

    const { container: stacked } = render(
      <CustomMetaList defs={defs} values={{ region: "CEE" }} lang="pl" variant="stacked" />,
    );
    expect(stacked.querySelector("dl")).not.toBeNull();
  });

  it("etykieta pola jest brana z języka strony", () => {
    render(<CustomMetaList defs={defs} values={{ zakres: "2026" }} lang="en" variant="stacked" />);
    expect(screen.getByText("Scope")).toBeInTheDocument();
    expect(screen.queryByText("Zakres")).toBeNull();
  });

  it("NIEZNANA nazwa ikony degraduje do neutralnej, nie wywala listy", () => {
    const weird = [def({ id: "d-x", key: "x", icon: "NieMaTakiej", label_pl: "Pole" })];
    const { container } = render(
      <CustomMetaList defs={weird} values={{ x: "wartość" }} lang="pl" />,
    );
    expect(screen.getByText("wartość")).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("własna klasa dokłada się do listy", () => {
    const { container } = render(
      <CustomMetaList defs={defs} values={{ region: "CEE" }} lang="pl" className="mt-4" />,
    );
    expect(container.querySelector("ul")?.className).toContain("mt-4");
    expect(container.querySelector("ul")?.className).toContain("inline-flex");
  });
});

describe("PrintBriefHeader", () => {
  it("rama i stopka są UKRYTE dla czytnika ekranu (to warstwa wydruku)", () => {
    const { container } = render(<PrintBriefHeader lang="pl" url="https://nes.eu/post/a" />);
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden).toHaveLength(2);
    expect(container.querySelector("header")).toHaveAttribute("aria-hidden", "true");
  });

  it("niesie markę i typ dokumentu w języku strony", () => {
    render(<PrintBriefHeader lang="pl" url="https://nes.eu/post/a" />);
    expect(screen.getAllByText(SITE_NAME).length).toBeGreaterThan(0);
    expect(screen.getByText("Analiza")).toBeInTheDocument();
  });

  it("wariant angielski zmienia typ dokumentu", () => {
    render(<PrintBriefHeader lang="en" url="https://nes.eu/post/a" />);
    expect(screen.getByText("Analysis")).toBeInTheDocument();
    expect(screen.queryByText("Analiza")).toBeNull();
  });

  it("linia źródła niesie PEŁNY adres, stopka wersję bez schematu", () => {
    const { container } = render(<PrintBriefHeader lang="pl" url="https://nes.eu/post/a" />);
    expect(container.textContent).toContain("https://nes.eu/post/a");
    expect(container.querySelector(".print-brief-footer")?.textContent).toContain("nes.eu/post/a");
  });

  it("stopka nie powtarza schematu `https://`", () => {
    const { container } = render(<PrintBriefHeader lang="pl" url="https://nes.eu/a" />);
    const footer = container.querySelector(".print-brief-footer")?.textContent ?? "";
    expect(footer).not.toContain("https://");
    expect(footer).toContain("nes.eu/a");
  });

  it("obie warstwy mają klasę `print-only` (ekran ich nie pokazuje)", () => {
    const { container } = render(<PrintBriefHeader lang="pl" url="https://nes.eu/a" />);
    expect(container.querySelectorAll(".print-only")).toHaveLength(2);
    expect(container.querySelector(".print-brief-header")).not.toBeNull();
  });
});

describe("PostOrganizationCard", () => {
  it("renderuje nazwę organizacji z MIGAWKI wiersza wpisu", () => {
    render(<PostOrganizationCard post={{ organization_name: "Fundacja NES" }} />);
    expect(screen.getByText("Fundacja NES")).toBeInTheDocument();
    expect(screen.getByRole("complementary")).toBeInTheDocument();
  });

  it("BRAK nazwy nie renderuje karty (atrybucja jest opcjonalna)", () => {
    const { container } = render(<PostOrganizationCard post={{}} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("nazwa z samych spacji też nie renderuje karty", () => {
    const { container } = render(<PostOrganizationCard post={{ organization_name: "   " }} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("logo jest obrazem z opisem alternatywnym niosącym nazwę", () => {
    render(
      <PostOrganizationCard
        post={{ organization_name: "Fundacja NES", organization_logo_url: "https://cdn/logo.png" }}
      />,
    );
    const img = screen.getByRole("img");
    expect(img).toHaveAttribute("src", "https://cdn/logo.png");
    expect(img.getAttribute("alt")).toContain("Fundacja NES");
  });

  it("BRAK logo daje ikonę zastępczą, nie pusty obraz", () => {
    const { container } = render(
      <PostOrganizationCard post={{ organization_name: "Fundacja NES" }} />,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("link do strony organizacji NIE dostaje rel=sponsored (to nie relacja opłacona)", () => {
    render(
      <PostOrganizationCard
        post={{ organization_name: "Fundacja NES", organization_website: "https://nes.org" }}
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.getAttribute("rel")).not.toContain("sponsored");
  });

  it("link otwiera się w nowej karcie z zabezpieczeniem `noopener`", () => {
    render(
      <PostOrganizationCard
        post={{ organization_name: "NES", organization_website: "https://nes.org" }}
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
  });

  it("BRAK adresu strony nie renderuje linku", () => {
    render(<PostOrganizationCard post={{ organization_name: "NES", organization_website: "" }} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("NES")).toBeInTheDocument();
  });
});

describe("accentFor - deterministyczna paleta rekomendacji", () => {
  it("ten sam identyfikator daje ZAWSZE ten sam akcent (stabilność między renderami)", () => {
    const a = accentFor("post-1");
    const b = accentFor("post-1");
    expect(a.token).toBe(b.token);
    expect(a.Icon).toBe(b.Icon);
  });

  it("różne identyfikatory rozkładają się po palecie, nie na jeden slot", () => {
    const tokens = new Set(Array.from({ length: 24 }, (_, i) => accentFor(`post-${i}`).token));
    expect(tokens.size).toBeGreaterThan(1);
    expect(tokens.size).toBeLessThanOrEqual(6);
  });

  it("każdy akcent niesie PEŁNY zestaw klas (tło, obramowanie, tekst) i ikonę", () => {
    const accent = accentFor("post-7");
    expect(accent.bgClass).toMatch(/^bg-/);
    expect(accent.borderClass).toMatch(/^border-/);
    expect(accent.textClass).toMatch(/^text-/);
    // Ikony lucide to obiekty `forwardRef`, nie funkcje - liczy się, że komponent
    // JEST, nie jakiej jest postaci.
    expect(accent.Icon).toBeTruthy();
  });

  it("pusty identyfikator też daje poprawny akcent, nie undefined", () => {
    const accent = accentFor("");
    // Paleta ma sześć slotów: pięć tokenów kategorii i token marki.
    expect(accent.token.startsWith("--")).toBe(true);
    expect(accent.Icon).toBeDefined();
  });
});

describe("MobileArticleActions", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("renderuje DWA przyciski rzędu: odsłuchaj i pobierz", async () => {
    vi.doMock("@/components/audio/ArticleListenButton", () => ({
      ArticleListenButton: () => <button type="button">Odsłuchaj artykuł</button>,
    }));
    const { MobileArticleActions } = await import("@/components/post/MobileArticleActions");
    render(<MobileArticleActions lang="pl" postId="p1" title="Analiza" audioUrl={null} />);
    expect(screen.getByRole("button", { name: "Odsłuchaj artykuł" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pobierz artykuł" })).toBeInTheDocument();
  });

  it("przycisk pobierania woła druk przeglądarki (ścieżka Zapisz jako PDF)", async () => {
    vi.doMock("@/components/audio/ArticleListenButton", () => ({
      ArticleListenButton: () => null,
    }));
    const print = vi.fn();
    Object.defineProperty(window, "print", { value: print, configurable: true, writable: true });
    const { MobileArticleActions } = await import("@/components/post/MobileArticleActions");
    render(<MobileArticleActions lang="pl" postId="p1" title="Analiza" />);

    await act(async () => {
      screen.getByRole("button", { name: "Pobierz artykuł" }).click();
    });

    expect(print).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Pobierz artykuł" })).toBeEnabled();
  });

  it("pasek jest UKRYTY W DRUKU i ograniczony do mobile", async () => {
    vi.doMock("@/components/audio/ArticleListenButton", () => ({
      ArticleListenButton: () => null,
    }));
    const { MobileArticleActions } = await import("@/components/post/MobileArticleActions");
    const { container } = render(<MobileArticleActions lang="pl" postId="p1" title="Analiza" />);
    const bar = container.querySelector("[data-mobile-article-actions]");
    expect(bar?.className).toContain("no-print");
    expect(bar?.className).toContain("sm:hidden");
  });

  it("wariant angielski zmienia etykietę pobierania", async () => {
    vi.doMock("@/components/audio/ArticleListenButton", () => ({
      ArticleListenButton: () => null,
    }));
    const { MobileArticleActions } = await import("@/components/post/MobileArticleActions");
    render(<MobileArticleActions lang="en" postId="p1" title="Analysis" />);
    expect(screen.getByRole("button", { name: "Download article" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pobierz artykuł" })).toBeNull();
  });
});

describe("PostFeedback", () => {
  const submit = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    submit.mockReset();
    submit.mockResolvedValue(undefined);
    window.localStorage.clear();
  });

  async function mount(lang: "pl" | "en" = "pl") {
    vi.doMock("@tanstack/react-start", () => ({ useServerFn: () => submit }));
    vi.doMock("@/lib/content/feedback.functions", () => ({ submitPostFeedback: {} }));
    const { PostFeedback } = await import("@/components/post/PostFeedback");
    return render(<PostFeedback postId="p1" lang={lang} />);
  }

  it("pyta o przydatność i daje DWIE odpowiedzi", async () => {
    await mount();
    expect(screen.getByText("Czy ta analiza była przydatna?")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("głos ZA wysyła `helpful: true` i przechodzi w podziękowanie", async () => {
    await mount();
    await act(async () => {
      screen.getByRole("button", { name: /Tak, przydatna/ }).click();
    });
    expect(submit).toHaveBeenCalledWith({ data: { postId: "p1", helpful: true } });
    await waitFor(() => expect(screen.getByText("Dziękujemy za opinię.")).toBeInTheDocument());
  });

  it("głos PRZECIW wysyła `helpful: false`", async () => {
    await mount();
    await act(async () => {
      screen.getByRole("button", { name: /Nie/ }).click();
    });
    expect(submit).toHaveBeenCalledWith({ data: { postId: "p1", helpful: false } });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("po głosie zapisuje blokadę w magazynie, więc drugi głos nie idzie", async () => {
    await mount();
    await act(async () => {
      screen.getByRole("button", { name: /Tak, przydatna/ }).click();
    });
    await waitFor(() => expect(window.localStorage.getItem("post-feedback:p1")).toBe("up"));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("ZAPISANY głos z poprzedniej wizyty od razu pokazuje podziękowanie", async () => {
    window.localStorage.setItem("post-feedback:p1", "down");
    await mount();
    await waitFor(() => expect(screen.getByText("Dziękujemy za opinię.")).toBeInTheDocument());
    expect(submit).not.toHaveBeenCalled();
  });

  it("BŁĄD wysyłki cicho wraca do stanu wyjściowego (feedback nie straszy czytelnika)", async () => {
    submit.mockRejectedValue(new Error("network"));
    await mount();
    await act(async () => {
      screen.getByRole("button", { name: /Tak, przydatna/ }).click();
    });
    await waitFor(() =>
      expect(screen.getByText("Czy ta analiza była przydatna?")).toBeInTheDocument(),
    );
    expect(window.localStorage.getItem("post-feedback:p1")).toBeNull();
  });

  it("sekcja ogłasza zmiany czytnikowi ekranu i jest ukryta w druku", async () => {
    const { container } = await mount();
    const root = container.firstElementChild;
    expect(root).toHaveAttribute("aria-live", "polite");
    expect(root?.className).toContain("no-print");
  });

  it("wariant angielski używa angielskich pytań i odpowiedzi", async () => {
    await mount("en");
    expect(screen.getByText("Was this analysis useful?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Yes, useful/ })).toBeInTheDocument();
  });
});
