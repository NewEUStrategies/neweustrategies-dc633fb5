// Progress to pasek postępu Radiksa. Kontrakt: rola `progressbar` z wartością
// dla czytnika ekranu, wskaźnik przesunięty o brakujący procent, a brak
// wartości oznacza stan nieokreślony (pasek pusty, bez `aria-valuenow`).
// Kolory toru i wskaźnika idą z tokenu `primary`, wspólnego dla motywów.
//
// Do 2026-10-03 opakowanie wyjmowało `value` z propsów i nie oddawało go
// korzeniowi Radiksa: pasek przy 40% ogłaszał się czytnikowi jako nieokreślony,
// a ruszał się tylko obraz. Pierwszy test pilnuje, że wartość dochodzi.
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Progress } from "../progress";

afterEach(cleanup);

function indicatorOf(bar: HTMLElement): HTMLElement {
  const indicator = bar.firstElementChild;
  expect(indicator).not.toBeNull();
  return indicator as HTMLElement;
}

describe("Progress", () => {
  it("ogłasza pasek rolą progressbar z zakresem i przesuwa wskaźnik o brakujący procent", () => {
    render(<Progress value={40} aria-label="Wysyłanie pliku" />);
    const bar = screen.getByRole("progressbar", { name: "Wysyłanie pliku" });
    expect(bar).toHaveAttribute("aria-valuemin", "0");
    expect(bar).toHaveAttribute("aria-valuemax", "100");
    expect(bar).toHaveAttribute("aria-valuenow", "40");
    expect(bar).toHaveAttribute("data-state", "loading");
    expect(indicatorOf(bar).style.transform).toBe("translateX(-60%)");
  });

  it("przy wartości maksymalnej pokazuje pełny pasek", () => {
    render(<Progress value={100} aria-label="Gotowe" />);
    const bar = screen.getByRole("progressbar", { name: "Gotowe" });
    expect(bar).toHaveAttribute("data-state", "complete");
    expect(indicatorOf(bar).style.transform).toBe("translateX(-0%)");
  });

  it("bez wartości przechodzi w stan nieokreślony z pustym paskiem", () => {
    render(<Progress aria-label="Przetwarzanie" />);
    const bar = screen.getByRole("progressbar", { name: "Przetwarzanie" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("data-state", "indeterminate");
    expect(indicatorOf(bar).style.transform).toBe("translateX(-100%)");
  });

  it("bierze kolory toru i wskaźnika z tokenu motywu i scala klasę wywołującego", () => {
    const ref = createRef<HTMLDivElement>();
    render(<Progress ref={ref} value={10} className="h-1" aria-label="Pasek" />);
    expect(ref.current).toBe(screen.getByRole("progressbar"));
    expect(ref.current).toHaveClass("bg-primary/20", "rounded-full", "h-1");
    expect(ref.current).not.toHaveClass("h-2");
    expect(indicatorOf(ref.current as HTMLElement)).toHaveClass("bg-primary", "transition-all");
  });
});
