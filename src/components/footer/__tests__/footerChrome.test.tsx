// Drobnica chrome stopki: pasek praw autorskich, powrót na górę, szkielet
// nagłówka. Trzy pliki, każdy na okrągłym ZERZE do 18.08.2026 - a wszystkie
// trzy stoją na ścieżce KAŻDEJ strony serwisu.
//
// Stawka nie jest kosmetyczna:
//   * linki prawne w stopce są wymogiem operatora płatności i muszą być
//     osiągalne z każdej strony, niezależnie od dokumentu buildera,
//   * przycisk powrotu jest jedyną nawigacją klawiaturową z dołu długiego
//     artykułu, więc jego nazwa dostępna musi iść ze SŁOWNIKA,
//   * szkielet nagłówka trzyma wysokość paska przed hydracją - inaczej treść
//     podskakuje pod kursorem czytelnika (CLS).
import { describe, expect, it, afterEach, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@/lib/i18n";
import { realT } from "@/test/i18nReal";
import { RouterLinkStub } from "@/test/routerLinkStub";

vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: RouterLinkStub,
}));

const { CopyrightBar } = await import("@/components/footer/CopyrightBar");
const { BackToTop } = await import("@/components/footer/BackToTop");
const { HeaderSkeleton } = await import("@/components/header/HeaderSkeleton");
const { defaultFooterChrome } = await import("@/lib/theme/footerSettings");

type FooterChrome = ReturnType<typeof defaultFooterChrome>;

function chrome(over: Partial<FooterChrome> = {}): FooterChrome {
  return { ...defaultFooterChrome(), ...over };
}

afterEach(() => {
  cleanup();
  window.scrollY = 0;
});

describe("CopyrightBar", () => {
  it("wstawia BIEŻĄCY rok w miejsce znacznika {year}", () => {
    // Rok w stopce to jedyna treść, która „psuje się" sama z upływem czasu -
    // dlatego jest znacznikiem, a nie napisem wpisanym raz w panelu.
    render(<CopyrightBar chrome={chrome({ copyright_pl: "© {year} NES" })} lang="pl" />);
    expect(screen.getByText(`© ${new Date().getFullYear()} NES`)).toBeTruthy();
  });

  it("bez własnej treści pokazuje sam rok, a z wyłączonym rokiem - nic", () => {
    const { unmount } = render(<CopyrightBar chrome={chrome()} lang="pl" />);
    expect(screen.getByText(`© ${new Date().getFullYear()}`)).toBeTruthy();
    unmount();

    render(<CopyrightBar chrome={chrome({ show_year: false })} lang="pl" />);
    expect(screen.queryByText(/©/)).toBeNull();
  });

  it("bierze treść z wersji językowej strony", () => {
    render(
      <CopyrightBar
        chrome={chrome({ copyright_pl: "Wszelkie prawa", copyright_en: "All rights" })}
        lang="en"
      />,
    );
    expect(screen.getByText("All rights")).toBeTruthy();
  });

  it("linki prawne są ZAWSZE - niezależnie od dokumentu buildera", () => {
    // Wymóg operatora płatności: regulamin i polityka prywatności muszą być
    // osiągalne z każdej strony, także gdy redakcja opróżni stopkę w builderze.
    render(<CopyrightBar chrome={chrome()} lang="pl" />);
    const nav = screen.getByRole("navigation", { name: "Informacje prawne" });
    const hrefy = within(nav)
      .getAllByRole("link")
      .map((a) => a.getAttribute("href"));
    expect(hrefy).toContain("/regulamin");
    expect(hrefy).toContain("/polityka-prywatnosci");
  });

  it("nazwy linków prawnych idą za językiem", () => {
    render(<CopyrightBar chrome={chrome()} lang="en" />);
    const nav = screen.getByRole("navigation", { name: "Legal" });
    expect(within(nav).getByRole("link", { name: "Terms & conditions" })).toBeTruthy();
  });

  it("wariant ciemny i jasny różnią się tłem, wyśrodkowany - układem", () => {
    const { container: dark } = render(
      <CopyrightBar chrome={chrome({ layout: "dark" })} lang="pl" />,
    );
    expect(dark.firstElementChild?.className).toContain("bg-foreground");
    cleanup();

    const { container: light } = render(
      <CopyrightBar chrome={chrome({ layout: "light" })} lang="pl" />,
    );
    expect(light.firstElementChild?.className).toContain("bg-muted");
    cleanup();

    const { container: centered } = render(
      <CopyrightBar chrome={chrome({ layout: "centered" })} lang="pl" />,
    );
    expect(centered.innerHTML).toContain("text-center");
  });

  it("separator da się wyłączyć - to jedyna kreska nad stopką", () => {
    const { container: withSep } = render(<CopyrightBar chrome={chrome()} lang="pl" />);
    expect(withSep.firstElementChild?.className).toContain("border-t");
    cleanup();

    const { container: withoutSep } = render(
      <CopyrightBar chrome={chrome({ show_separator: false })} lang="pl" />,
    );
    expect(withoutSep.firstElementChild?.className).not.toContain("border-t");
  });
});

describe("BackToTop", () => {
  function scrollTo(y: number) {
    window.scrollY = y;
    fireEvent.scroll(window);
  }

  it("jest niewidoczny na górze strony i nie da się go kliknąć omyłkowo", () => {
    render(<BackToTop />);
    const button = screen.getByRole("button", { name: realT("pl")("footer.back_to_top") });
    expect(button.className).toContain("opacity-0");
    expect(button.className).toContain("pointer-events-none");
  });

  it("pojawia się po przekroczeniu progu przewijania", () => {
    render(<BackToTop />);
    const button = screen.getByRole("button", { name: realT("pl")("footer.back_to_top") });
    scrollTo(401);
    expect(button.className).toContain("opacity-100");
    expect(button.className).not.toContain("pointer-events-none");
  });

  it("próg jest konfigurowalny (ustawienie stopki), a granica NIE jest inkluzywna", () => {
    render(<BackToTop thresholdPx={100} />);
    const button = screen.getByRole("button", { name: realT("pl")("footer.back_to_top") });
    scrollTo(100);
    expect(button.className).toContain("opacity-0");
    scrollTo(101);
    expect(button.className).toContain("opacity-100");
  });

  it("chowa się z powrotem po powrocie na górę", () => {
    render(<BackToTop />);
    const button = screen.getByRole("button", { name: realT("pl")("footer.back_to_top") });
    scrollTo(500);
    expect(button.className).toContain("opacity-100");
    scrollTo(0);
    expect(button.className).toContain("opacity-0");
  });

  it("kliknięcie przewija na samą górę", () => {
    const scrollSpy = vi.fn();
    const original = window.scrollTo;
    window.scrollTo = scrollSpy as unknown as typeof window.scrollTo;
    try {
      render(<BackToTop />);
      fireEvent.click(screen.getByRole("button", { name: realT("pl")("footer.back_to_top") }));
      expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
    } finally {
      window.scrollTo = original;
    }
  });

  it("nazwa dostępna idzie ze SŁOWNIKA, w obu językach", async () => {
    // Przycisk jest samą ikoną - bez nazwy ze słownika czytnik ekranu
    // przeczytałby „przycisk", a w wersji angielskiej polski tekst.
    const i18n = (await import("@/lib/i18n")).default;
    render(<BackToTop />);
    expect(screen.getByRole("button", { name: "Wróć na górę" })).toBeTruthy();
    cleanup();

    await i18n.changeLanguage("en");
    render(<BackToTop />);
    expect(screen.getByRole("button", { name: "Back to top" })).toBeTruthy();
    await i18n.changeLanguage("pl");
  });

  it("respektuje prośbę systemu o ograniczenie ruchu", () => {
    // Płynne przewijanie przez całą wysokość dokumentu jest dla części
    // czytelników objawowe (migrena przedsionkowa, choroba lokomocyjna).
    // Z ustawieniem „ogranicz ruch" skok ma być natychmiastowy.
    const scrollSpy = vi.fn();
    const originalScroll = window.scrollTo;
    const originalMatch = window.matchMedia;
    window.scrollTo = scrollSpy as unknown as typeof window.scrollTo;
    window.matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      render(<BackToTop />);
      fireEvent.click(screen.getByRole("button", { name: realT("pl")("footer.back_to_top") }));
      expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: "auto" });
    } finally {
      window.scrollTo = originalScroll;
      window.matchMedia = originalMatch;
    }
  });

  it("bez zgłoszonej preferencji przewija płynnie - zachowanie bez zmian", () => {
    const scrollSpy = vi.fn();
    const originalScroll = window.scrollTo;
    const originalMatch = window.matchMedia;
    window.scrollTo = scrollSpy as unknown as typeof window.scrollTo;
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      render(<BackToTop />);
      fireEvent.click(screen.getByRole("button", { name: realT("pl")("footer.back_to_top") }));
      expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    } finally {
      window.scrollTo = originalScroll;
      window.matchMedia = originalMatch;
    }
  });

  it("odmontowanie zdejmuje nasłuch przewijania", () => {
    // Nasłuch zostawiony po odmontowaniu narastałby przy każdej nawigacji SPA -
    // chrome nie jest przeładowywane między trasami.
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<BackToTop />);
    unmount();
    expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
    remove.mockRestore();
  });
});

describe("HeaderSkeleton", () => {
  it("trzyma wysokość paska nawigacji przed hydracją", () => {
    // 64 px (h-16) to ta sama wysokość, co prawdziwy nagłówek - bez tego
    // treść strony podskakuje w momencie dojechania ustawień.
    const { container } = render(<HeaderSkeleton />);
    expect(container.querySelector(".h-16")).not.toBeNull();
  });

  it("jest ukryty przed czytnikiem ekranu i oznaczony jako szkielet", () => {
    const { container } = render(<HeaderSkeleton />);
    const root = container.firstElementChild!;
    expect(root).toHaveAttribute("aria-hidden", "true");
    expect(root).toHaveAttribute("data-skeleton", "header");
  });

  it("nie zawiera ani jednego elementu interaktywnego", () => {
    // Placeholder z linkiem albo przyciskiem łapałby fokus z klawiatury
    // i prowadziłby donikąd.
    render(<HeaderSkeleton />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });
});
