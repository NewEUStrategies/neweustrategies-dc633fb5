// Pełnoekranowy widok Web Story.
//
// Maszyna przewijania ma własne, wyczerpujące testy w `lib/web-stories/viewerNav`.
// Tutaj sprawdzamy to, czego czysta warstwa nie widzi: czy klawiatura i strefy
// dotyku są PODPIĘTE do tej maszyny, czy tło wybiera się zgodnie z regułą i czy
// CTA nie przepuszcza adresu `javascript:`.
//
// Większość przejść wywołujemy tak, jak robi to człowiek: klawiszem albo
// kliknięciem. Wyjątkiem jest ostatni blok, który PRZEJMUJE pętlę
// `requestAnimationFrame` i sam podaje znacznik czasu - inaczej sprawdzenie
// „pasek dobiegł do końca, plansza się zmieniła" wymagałoby czekania sekundami
// i migotałoby przy obciążonym CI.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoryPage } from "@/lib/web-stories/types";
import { StoryViewer } from "@/components/web-stories/StoryViewer";

function page(overrides: Partial<StoryPage> = {}): StoryPage {
  return {
    id: `p${Math.round(1)}`,
    background: "image",
    media_url: "https://cdn.example/1.jpg",
    poster_url: "",
    color: "#141414",
    title_pl: "Tytuł planszy",
    title_en: "Page title",
    caption_pl: "Podpis planszy",
    caption_en: "Page caption",
    cta_label_pl: "",
    cta_label_en: "",
    cta_href: "",
    text_position: "bottom",
    text_align: "left",
    duration_seconds: 6,
    ...overrides,
  };
}

const THREE = [
  page({ id: "a", title_pl: "Plansza pierwsza" }),
  page({ id: "b", title_pl: "Plansza druga" }),
  page({ id: "c", title_pl: "Plansza trzecia" }),
];

afterEach(() => {
  vi.clearAllMocks();
});

describe("StoryViewer - warunki brzegowe", () => {
  it("historia bez plansz nie renderuje niczego", () => {
    const { container } = render(<StoryViewer pages={[]} lang="pl" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("startuje od wskazanej planszy", () => {
    render(<StoryViewer pages={THREE} lang="pl" startIndex={1} />);
    expect(screen.getByText("Plansza druga")).toBeInTheDocument();
  });

  it("start spoza zakresu przycina się do ostatniej planszy", () => {
    // `?page=12` w historii o trzech planszach przychodzi z adresu.
    render(<StoryViewer pages={THREE} lang="pl" startIndex={12} />);
    expect(screen.getByText("Plansza trzecia")).toBeInTheDocument();
  });

  it("ujemny start przycina się do pierwszej planszy", () => {
    render(<StoryViewer pages={THREE} lang="pl" startIndex={-4} />);
    expect(screen.getByText("Plansza pierwsza")).toBeInTheDocument();
  });

  it("rysuje jeden pasek postępu na planszę", () => {
    const { container } = render(<StoryViewer pages={THREE} lang="pl" />);
    expect(container.querySelectorAll(".flex-1.h-0\\.5")).toHaveLength(3);
  });
});

describe("StoryViewer - klawiatura", () => {
  it("strzałka w prawo przechodzi na następną planszę", () => {
    render(<StoryViewer pages={THREE} lang="pl" />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("Plansza druga")).toBeInTheDocument();
  });

  it("strzałka w lewo wraca na poprzednią", () => {
    render(<StoryViewer pages={THREE} lang="pl" startIndex={2} />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("Plansza druga")).toBeInTheDocument();
  });

  it("strzałka w lewo na PIERWSZEJ planszy nie zamyka historii", () => {
    const onClose = vi.fn();
    render(<StoryViewer pages={THREE} lang="pl" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "ArrowLeft" });
    expect(screen.getByText("Plansza pierwsza")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("strzałka w prawo na OSTATNIEJ planszy zamyka historię DOKŁADNIE raz", () => {
    // Reguła zakończenia serii. Gdyby ostatnia plansza „zostawała", widok
    // wisiałby na niej, a autoodtwarzanie mieliłoby klatki w nieskończoność.
    const onClose = vi.fn();
    render(<StoryViewer pages={THREE} lang="pl" startIndex={2} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape zamyka historię", () => {
    const onClose = vi.fn();
    render(<StoryViewer pages={THREE} lang="pl" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("spacja przełącza pauzę i BLOKUJE domyślne przewinięcie strony", () => {
    // Bez `preventDefault` przeglądarka przewinęłaby stronę pod pełnoekranową
    // historią - użytkownik wróciłby z niej w zupełnie inne miejsce.
    render(<StoryViewer pages={THREE} lang="pl" />);
    expect(screen.getByLabelText("Pauza")).toBeInTheDocument();

    // `fireEvent` zwraca `false`, gdy zdarzenie zostało anulowane - to jest
    // asercja o `preventDefault`, tylko opakowana w `act`, więc widać też
    // skutek dla stanu komponentu.
    const notPrevented = fireEvent.keyDown(window, { key: " " });
    expect(notPrevented).toBe(false);
    expect(screen.getByLabelText("Wznów")).toBeInTheDocument();
  });

  it("obca klawisza nie rusza historii", () => {
    const onClose = vi.fn();
    render(<StoryViewer pages={THREE} lang="pl" onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.getByText("Plansza pierwsza")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("nasłuch klawiatury znika po odmontowaniu", () => {
    const onClose = vi.fn();
    const { unmount } = render(<StoryViewer pages={THREE} lang="pl" onClose={onClose} />);
    unmount();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("StoryViewer - strefy dotyku i przyciski", () => {
  it("strefa po prawej przechodzi dalej", () => {
    render(<StoryViewer pages={THREE} lang="pl" />);
    fireEvent.click(screen.getByLabelText("Następna"));
    expect(screen.getByText("Plansza druga")).toBeInTheDocument();
  });

  it("strefa po lewej cofa", () => {
    render(<StoryViewer pages={THREE} lang="pl" startIndex={1} />);
    fireEvent.click(screen.getByLabelText("Poprzednia"));
    expect(screen.getByText("Plansza pierwsza")).toBeInTheDocument();
  });

  it("przycisk zamknięcia woła `onClose`", () => {
    const onClose = vi.fn();
    render(<StoryViewer pages={THREE} lang="pl" onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("Zamknij"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("przycisk pauzy przełącza etykietę", () => {
    render(<StoryViewer pages={THREE} lang="pl" />);
    fireEvent.click(screen.getByLabelText("Pauza"));
    expect(screen.getByLabelText("Wznów")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Wznów"));
    expect(screen.getByLabelText("Pauza")).toBeInTheDocument();
  });

  it("brak `onClose` nie wywraca zamykania", () => {
    render(<StoryViewer pages={THREE} lang="pl" />);
    expect(() => fireEvent.click(screen.getByLabelText("Zamknij"))).not.toThrow();
  });
});

describe("StoryViewer - tło planszy", () => {
  it("plansza wideo gra film z plakatem", () => {
    const { container } = render(
      <StoryViewer
        pages={[page({ background: "video", media_url: "https://cdn/x.mp4", poster_url: "p.jpg" })]}
        lang="pl"
      />,
    );
    const video = container.querySelector("video");
    expect(video).toHaveAttribute("src", "https://cdn/x.mp4");
    expect(video).toHaveAttribute("poster", "p.jpg");
  });

  it("plansza wideo BEZ adresu spada na jednolite tło", () => {
    const { container } = render(
      <StoryViewer pages={[page({ background: "video", media_url: "" })]} lang="pl" />,
    );
    expect(container.querySelector("video")).toBeNull();
    expect(container.querySelector(".bg-neutral-900")).toBeInTheDocument();
  });

  it("plansza kolorowa maluje tło kolorem", () => {
    const { container } = render(
      <StoryViewer pages={[page({ background: "color", color: "rgb(1, 2, 3)" })]} lang="pl" />,
    );
    expect(container.querySelector('[style*="rgb(1, 2, 3)"]')).toBeInTheDocument();
  });

  it("plansza obrazkowa BEZ adresu nie renderuje pustego obrazka", () => {
    // `<img src="">` w części przeglądarek rysuje ikonę zepsutego obrazka
    // na pełnym ekranie.
    const { container } = render(
      <StoryViewer pages={[page({ background: "image", media_url: "" })]} lang="pl" />,
    );
    expect(container.querySelector("img")).toBeNull();
  });
});

describe("StoryViewer - treść i wezwanie do działania", () => {
  it("pokazuje tytuł i podpis w języku strony", () => {
    render(<StoryViewer pages={[page()]} lang="en" />);
    expect(screen.getByText("Page title")).toBeInTheDocument();
    expect(screen.getByText("Page caption")).toBeInTheDocument();
  });

  it("okno ma etykietę dostępności w języku strony", () => {
    const { rerender } = render(<StoryViewer pages={[page()]} lang="pl" />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Historia");
    rerender(<StoryViewer pages={[page()]} lang="en" />);
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-label", "Web story");
  });

  it("plansza bez tytułu i podpisu renderuje się bez pustych nagłówków", () => {
    const { container } = render(
      <StoryViewer
        pages={[page({ title_pl: "", title_en: "", caption_pl: "", caption_en: "" })]}
        lang="pl"
      />,
    );
    expect(container.querySelector("h2")).toBeNull();
  });

  it("CTA pojawia się, gdy ma i etykietę, i adres", () => {
    render(
      <StoryViewer
        pages={[page({ cta_label_pl: "Czytaj raport", cta_href: "/raporty/2026" })]}
        lang="pl"
      />,
    );
    expect(screen.getByRole("link", { name: "Czytaj raport" })).toHaveAttribute(
      "href",
      "/raporty/2026",
    );
  });

  it("CTA bez adresu się nie pojawia", () => {
    render(
      <StoryViewer pages={[page({ cta_label_pl: "Czytaj raport", cta_href: "" })]} lang="pl" />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("CTA z adresem `javascript:` jest BLOKOWANE przy renderze", () => {
    // Obrona w głąb: strona mogła nie przejść przez `StoryPageSchema`
    // (np. pochodzi z cache sprzed walidacji). Sanityzacja przy renderze jest
    // ostatnią barierą przed trwałym XSS-em na stronie publicznej.
    render(
      <StoryViewer
        pages={[page({ cta_label_pl: "Kliknij", cta_href: "javascript:alert(1)" })]}
        lang="pl"
      />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("CTA na adres zewnętrzny otwiera się w nowej karcie", () => {
    render(
      <StoryViewer
        pages={[page({ cta_label_pl: "Źródło", cta_href: "https://ec.europa.eu/x" })]}
        lang="pl"
      />,
    );
    const link = screen.getByRole("link", { name: "Źródło" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("CTA wewnętrzne zostaje w tej samej karcie", () => {
    render(
      <StoryViewer pages={[page({ cta_label_pl: "Dalej", cta_href: "/tracker" })]} lang="pl" />,
    );
    expect(screen.getByRole("link", { name: "Dalej" })).not.toHaveAttribute("target");
  });

  it.each([
    ["top", "top-16"],
    ["center", "top-1/2"],
    ["bottom", "bottom-10"],
  ] as const)("położenie tekstu %s", (position, expected) => {
    const { container } = render(
      <StoryViewer pages={[page({ text_position: position })]} lang="pl" />,
    );
    expect(container.innerHTML).toContain(expected);
  });

  it.each([
    ["center", "text-center"],
    ["right", "text-right"],
    ["left", "text-left"],
  ] as const)("wyrównanie tekstu %s", (align, expected) => {
    const { container } = render(<StoryViewer pages={[page({ text_align: align })]} lang="pl" />);
    expect(container.innerHTML).toContain(expected);
  });
});

describe("StoryViewer - autoodtwarzanie", () => {
  /**
   * Przejmuje pętlę klatek: zamiast czekać sekundami na `requestAnimationFrame`,
   * test sam podaje znacznik czasu. Dzięki temu przejście „pasek dobiegł do
   * końca" jest deterministyczne, a nie zależne od obciążenia maszyny CI.
   */
  function captureFrames(): { run: (elapsedMs: number) => void } {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    return {
      run: (elapsedMs: number) => {
        const tick = frames[frames.length - 1];
        if (tick === undefined) throw new Error("test: pętla klatek nie została zaplanowana");
        act(() => tick(performance.now() + elapsedMs));
      },
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dobiegnięcie paska postępu przechodzi na następną planszę", () => {
    const loop = captureFrames();
    render(<StoryViewer pages={THREE} lang="pl" />);
    loop.run(60_000);
    expect(screen.getByText("Plansza druga")).toBeInTheDocument();
  });

  it("dobiegnięcie na OSTATNIEJ planszy zamyka historię", () => {
    // Ta sama reguła końca serii, co przy strzałce - tylko wywołana czasem.
    const onClose = vi.fn();
    const loop = captureFrames();
    render(<StoryViewer pages={THREE} lang="pl" startIndex={2} onClose={onClose} />);
    loop.run(60_000);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("częściowy postęp NIE przewija planszy", () => {
    const loop = captureFrames();
    render(<StoryViewer pages={THREE} lang="pl" />);
    loop.run(100);
    expect(screen.getByText("Plansza pierwsza")).toBeInTheDocument();
  });

  it("pauza wstrzymuje przewijanie mimo upływu czasu", () => {
    // Bez tej gałęzi wstrzymana historia i tak przeskoczyłaby dalej przy
    // pierwszej klatce po wznowieniu.
    const loop = captureFrames();
    render(<StoryViewer pages={THREE} lang="pl" />);
    fireEvent.click(screen.getByLabelText("Pauza"));
    loop.run(60_000);
    expect(screen.getByText("Plansza pierwsza")).toBeInTheDocument();
  });

  it("plansza o krótkim czasie i tak dostaje minimum dwóch sekund", () => {
    const loop = captureFrames();
    render(<StoryViewer pages={[page({ duration_seconds: 0 }), page({ id: "d2" })]} lang="pl" />);
    loop.run(1_000);
    expect(screen.getByText("Tytuł planszy")).toBeInTheDocument();
  });
});
