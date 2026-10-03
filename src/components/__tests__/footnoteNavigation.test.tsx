// Kontrakt nawigacji przypisów: marker w treści -> sekcja końcowa,
// numer w sekcji -> powrót do markera. Oba skoki przechwycone (preventDefault)
// i wykonane płynnym scrollem z offsetem pod sticky header.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, cleanup, render, screen, fireEvent } from "@testing-library/react";
import { FootnotesList } from "@/components/Footnotes";
import { FootnoteTooltips } from "@/components/Footnotes";
import { useRef } from "react";

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={ref}>
        <p>
          Treść
          <sup className="fn-ref">
            <a href="#fn-1" id="fnref-1" data-fn="1" title="Nota">
              [1]
            </a>
          </sup>
        </p>
      </div>
      <FootnotesList notes={[{ id: 1, html: "Nota źródłowa" }]} lang="pl" />
      <FootnoteTooltips notes={[{ id: 1, html: "Nota źródłowa" }]} containerRef={ref} />
    </div>
  );
}

describe("nawigacja przypisów", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });

  it("klik w marker przewija do wpisu w sekcji przypisów", () => {
    render(<Harness />);
    const marker = screen.getByRole("link", { name: "[1]" });
    fireEvent.click(marker);
    expect(window.scrollTo).toHaveBeenCalled();
    expect(document.getElementById("fn-1")).not.toBeNull();
  });

  it("klik w numer w sekcji wraca do markera w treści", () => {
    render(<Harness />);
    const back = screen.getAllByTitle("Wróć do czytanego fragmentu")[0];
    fireEvent.click(back);
    expect(window.scrollTo).toHaveBeenCalled();
    expect(document.getElementById("fnref-1")).not.toBeNull();
  });

  it("pokazuje pelna tresc tooltipu bez clampowania poza kontenerem wpisu", () => {
    render(<Harness />);
    const marker = screen.getByRole("link", { name: "[1]" });
    fireEvent.mouseEnter(marker);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("[1]Nota źródłowa");
    expect(tooltip.parentElement).toBe(document.body);
    expect(tooltip).not.toHaveClass("truncate", "line-clamp-1", "line-clamp-2", "line-clamp-3");
  });
});

// SKRÓTY, CHOWANIE DYMKA I WERSJA ANGIELSKA. Nawigacja przejmuje WYŁĄCZNIE
// zwykły klik lewym przyciskiem - klik z Ctrl/Cmd/Shift/Alt (nowa karta, nowe
// okno) i środkowy przycisk muszą zostać przeglądarce, inaczej czytelnik nie
// otworzy przypisu w nowej karcie. Dymek chowa się z opóźnieniem (żeby dało
// się na niego najechać) i nie otwiera się dla markera bez noty. Żadna z tych
// gałęzi nie miała wykonania.
describe("nawigacja przypisów - granice", () => {
  beforeEach(() => {
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Cmd", { metaKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
    ["środkowy przycisk", { button: 1 }],
  ])("klik z %s zostaje przeglądarce", (_label, init) => {
    render(<Harness />);
    const marker = screen.getByRole("link", { name: "[1]" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, ...init });
    marker.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  it("klik poza odsyłaczem przypisu niczego nie przejmuje", () => {
    render(<Harness />);
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    screen.getByText("Treść").dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });

  it("dymek chowa się z opóźnieniem, a powrót na marker je anuluje", () => {
    vi.useFakeTimers();
    render(<Harness />);
    const marker = screen.getByRole("link", { name: "[1]" });
    fireEvent.mouseEnter(marker);
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.mouseLeave(marker);
    act(() => {
      vi.advanceTimersByTime(100);
    });
    fireEvent.mouseEnter(marker);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByRole("tooltip")).toBeTruthy();

    fireEvent.mouseLeave(marker);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("fokus z klawiatury otwiera dymek tak samo jak najechanie", () => {
    render(<Harness />);
    fireEvent.focusIn(screen.getByRole("link", { name: "[1]" }));
    expect(screen.getByRole("tooltip")).toHaveTextContent("Nota źródłowa");
  });

  it("marker bez noty (np. usuniętej) nie otwiera pustego dymka", () => {
    function Orphan() {
      const ref = useRef<HTMLDivElement>(null);
      return (
        <div>
          <div ref={ref}>
            <a href="#fn-9" data-fn="9">
              [9]
            </a>
            <span>bez odsyłacza</span>
          </div>
          <FootnoteTooltips notes={[{ id: 1, html: "Nota" }]} containerRef={ref} />
        </div>
      );
    }
    render(<Orphan />);
    fireEvent.mouseEnter(screen.getByRole("link", { name: "[9]" }));
    fireEvent.mouseEnter(screen.getByText("bez odsyłacza"));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("lista przypisów po angielsku i pusta lista - brak sekcji", () => {
    const { container, rerender } = render(
      <FootnotesList notes={[{ id: 2, html: "<b>Source</b>" }]} lang="en" />,
    );
    expect(screen.getByRole("heading", { name: "Source notes:" })).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Back to reference 2" })).toHaveLength(2);
    rerender(<FootnotesList notes={[]} lang="en" />);
    expect(container.firstChild).toBeNull();
  });
});
