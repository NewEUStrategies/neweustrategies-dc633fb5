// InteractiveCircleWidget: pozycje rozłożone na okręgu/półokręgu z panelem
// środkowym sterowanym hoverem, klikiem lub autoplayem. Testujemy tryby
// wyzwalania (hover vs click), pauzę autoplayu na hover kontenera, pozycje
// z linkiem (kotwica zamiast przycisku), animacje (rotate/pulse), kolory
// niestandardowe i fallbacki etykiet (#N).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { InteractiveCircleWidget } from "../InteractiveCircleWidget";
import type { Json, WidgetNode, WidgetContent } from "@/lib/builder/types";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

let nextId = 0;
function renderCircle(content: WidgetContent, lang: "pl" | "en" = "pl") {
  const node: WidgetNode = {
    id: `ic-${nextId++}`,
    kind: "widget",
    type: "interactive-circle",
    content,
  };
  return render(<InteractiveCircleWidget node={node} lang={lang} />);
}

// Jawny typ Json[]: elementy o różnych kluczach (PL vs EN) inaczej rozszerzają
// się do unii z niejawnym `undefined`, której nie przyjmuje indeks Json.
const items: Json[] = [
  { icon: "star", label_pl: "Energia", title_pl: "Sektor energii", desc_pl: "<p>Opis energii</p>" },
  {
    icon: "globe",
    label_pl: "Handel",
    title_pl: "Wymiana handlowa",
    desc_pl: "<p>Opis handlu</p>",
  },
  { label_en: "Defence EN", title_en: "Defence title" },
];

describe("InteractiveCircleWidget - wyzwalanie pozycji", () => {
  it("activates items on hover (default trigger) and updates the center panel", () => {
    renderCircle({ items, title_pl: "Koło kompetencji", desc_pl: "<p>Opis koła</p>" });

    expect(screen.getByText("Koło kompetencji")).toBeInTheDocument();
    // Aktywna domyślnie pierwsza pozycja.
    expect(screen.getByText("Sektor energii")).toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Handel" }));
    expect(screen.getByText("Wymiana handlowa")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Handel" })).toHaveAttribute("aria-pressed", "true");
  });

  it("with trigger=click hover does nothing and click activates", () => {
    renderCircle({ items, trigger: "click" });

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Handel" }));
    // Hover nie przełącza w trybie click.
    expect(screen.getByText("Sektor energii")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Handel" }));
    expect(screen.getByText("Wymiana handlowa")).toBeInTheDocument();
  });

  it("renders an anchor for items with href and falls back to #N labels", () => {
    renderCircle({
      items: [{ href: "https://example.com/x", title_pl: "Linkowana" }],
      layout: "full",
    });
    const link = screen.getByRole("link", { name: "#1" });
    expect(link).toHaveAttribute("href", "https://example.com/x");
    fireEvent.click(link);
    expect(screen.getByText("Linkowana")).toBeInTheDocument();
  });

  it("uses EN labels with PL fallback and renders sanitized descriptions", () => {
    renderCircle({ items, title_en: "Competence circle", desc_en: "<p>EN desc</p>" }, "en");
    expect(screen.getByText("Competence circle")).toBeInTheDocument();
    expect(screen.getByText("EN desc")).toBeInTheDocument();
    // Pozycja 3 ma tylko label_en.
    expect(screen.getByRole("button", { name: "Defence EN" })).toBeInTheDocument();
    // Pozycje 1-2 spadają do PL.
    expect(screen.getByRole("button", { name: "Energia" })).toBeInTheDocument();
  });
});

describe("InteractiveCircleWidget - autoplay", () => {
  it("advances the active item on the interval and pauses while hovered", () => {
    vi.useFakeTimers();
    const { container } = renderCircle({
      items,
      autoplay: "on",
      intervalMs: 2000,
      layout: "full",
    });

    expect(screen.getByText("Sektor energii")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("Wymiana handlowa")).toBeInTheDocument();

    // Hover na kontenerze pauzuje pętlę...
    fireEvent.mouseEnter(container.firstElementChild as Element);
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByText("Wymiana handlowa")).toBeInTheDocument();

    // ...a opuszczenie wznawia (przechodzi na pozycję 3 -> potem wraca do 1).
    fireEvent.mouseLeave(container.firstElementChild as Element);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("Defence title")).toBeInTheDocument();
  });

  it("pauses on focus capture and resumes on blur", () => {
    vi.useFakeTimers();
    const { container } = renderCircle({ items, autoplay: "on", intervalMs: 2000 });
    const root = container.firstElementChild as Element;

    fireEvent.focus(screen.getByRole("button", { name: "Energia" }));
    act(() => {
      vi.advanceTimersByTime(6000);
    });
    // Fokus wewnątrz -> pauza (wciąż pozycja 1).
    expect(screen.getByText("Sektor energii")).toBeInTheDocument();

    fireEvent.blur(root);
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText("Wymiana handlowa")).toBeInTheDocument();
  });
});

describe("InteractiveCircleWidget - warianty wizualne", () => {
  it("renders the full circle with rotate animation and custom colors", () => {
    const { container } = renderCircle({
      items,
      layout: "full",
      animation: "rotate",
      circleColor: "#ff0000",
      itemBg: "#111111",
      itemColor: "#eeeeee",
      activeBg: "#222222",
      activeColor: "#ffffff",
      size: 1200, // clamp do 900
      itemSize: 20, // clamp do 40
      activeScale: 3, // clamp do 1.6
      circleThickness: 99, // clamp do 8
    });

    const svg = container.querySelector('svg[viewBox="0 0 100 100"]');
    expect(svg?.getAttribute("class")).toContain("animate-[spin_18s_linear_infinite]");
    const circle = svg?.querySelector("circle");
    expect(circle).toHaveAttribute("stroke", "#ff0000");
    expect(circle).toHaveAttribute("stroke-width", "8");

    const active = screen.getByRole("button", { name: "Energia" });
    expect(active.style.background).toBe("#222222");
    expect(active.style.transform).toContain("scale(1.6)");
    const inactive = screen.getByRole("button", { name: "Handel" });
    expect(inactive.style.background).toBe("#111111");
  });

  it("renders the semi arc with a pulse halo on the active item", () => {
    const { container } = renderCircle({ items, animation: "pulse" });
    // Półokrąg -> łuk <path> zamiast <circle> w svg tła (ikony Lucide mają
    // własne circle, stąd zawężenie do svg z viewBox 0 0 100 100).
    const arcSvg = container.querySelector('svg[viewBox="0 0 100 100"]') as SVGSVGElement;
    expect(arcSvg.querySelector("path")).not.toBeNull();
    expect(arcSvg.querySelector("circle")).toBeNull();
    expect(container.querySelector(".animate-ping")).not.toBeNull();
    expect(arcSvg.getAttribute("class")).toContain("animate-pulse");
  });

  it("renders a single item centered on the semi arc without crashing", () => {
    renderCircle({ items: [items[0]] });
    expect(screen.getByRole("button", { name: "Energia" })).toBeInTheDocument();
  });
});
