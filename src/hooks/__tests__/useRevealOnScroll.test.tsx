// Wejście wykresu: kontrakt haka `useRevealOnScroll`.
//
// Test pilnuje przede wszystkim tego, czego nie widać na demo - że hak NIGDY
// nie zostawia elementu uzbrojonego (czyli niewidocznego) w sytuacji, w której
// nic go już nie odpali. Animacja, która się nie odegra, jest drobiazgiem;
// treść, która się nie pokaże, jest awarią.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { revealClassName, useRevealOnScroll } from "@/hooks/useRevealOnScroll";

type ObserverCallback = (entries: { isIntersecting: boolean }[]) => void;

let ostatniObserwator: { callback: ObserverCallback; disconnected: boolean } | null = null;

function zainstalujObserwatora(): void {
  class FakeIO {
    callback: ObserverCallback;
    constructor(cb: ObserverCallback) {
      this.callback = cb;
      ostatniObserwator = { callback: cb, disconnected: false };
    }
    observe(): void {}
    disconnect(): void {
      if (ostatniObserwator !== null) ostatniObserwator.disconnected = true;
    }
    unobserve(): void {}
  }
  vi.stubGlobal("IntersectionObserver", FakeIO);
}

/** Pudełko elementu - `happy-dom` sam z siebie zwraca same zera. */
function ustawPudelko(rect: { top: number; height: number }): void {
  Element.prototype.getBoundingClientRect = function (): DOMRect {
    return {
      x: 0,
      y: rect.top,
      top: rect.top,
      left: 0,
      right: 400,
      bottom: rect.top + rect.height,
      width: 400,
      height: rect.height,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

function ustawRuch(ograniczony: boolean): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: ograniczony && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function Sonda({ enabled, onMount }: { enabled: boolean; onMount?: boolean }) {
  const { ref, state } = useRevealOnScroll<HTMLDivElement>(enabled, { onMount });
  return <div ref={ref} data-testid="sonda" className={revealClassName(state)} />;
}

const klasy = (root: HTMLElement): string =>
  root.querySelector("[data-testid='sonda']")?.getAttribute("class") ?? "";

const oryginalnyRect = Element.prototype.getBoundingClientRect;

beforeEach(() => {
  ostatniObserwator = null;
  zainstalujObserwatora();
  ustawRuch(false);
  ustawPudelko({ top: 40, height: 300 });
});

afterEach(() => {
  vi.unstubAllGlobals();
  Element.prototype.getBoundingClientRect = oryginalnyRect;
});

describe("useRevealOnScroll - wejście przy montowaniu", () => {
  it("element w polu widzenia RUSZA SIĘ, zamiast zostać w stanie końcowym", async () => {
    // Sedno zmiany. Wcześniej wykres nad foldem - czyli ten najczęściej
    // oglądany - nie animował się nigdy: hak widział go w viewporcie
    // i zostawiał "static".
    const { container } = render(<Sonda enabled onMount />);
    expect(klasy(container)).toContain("neh-armed");
    await waitFor(() => expect(klasy(container)).toContain("neh-run"));
  });

  it("uzbrojenie zapada PRZED pierwszym malowaniem", () => {
    // Gdyby uzbrojenie szło zwykłym efektem, przeglądarka zdążyłaby namalować
    // stan końcowy i dopiero potem go schować - czyli wykres mrugnąłby pełną
    // linią, zanim zacząłby się rysować. Klasa musi być na miejscu już
    // w pierwszym renderze widocznym po commicie.
    const { container } = render(<Sonda enabled onMount />);
    expect(klasy(container)).toBe("neh-armed");
  });

  it("bez `onMount` element w polu widzenia zostaje nieruszony", () => {
    const { container } = render(<Sonda enabled />);
    ostatniObserwator?.callback([{ isIntersecting: true }]);
    expect(klasy(container)).toBe("");
  });

  it("ograniczony ruch nie uzbraja niczego", () => {
    ustawRuch(true);
    const { container } = render(<Sonda enabled onMount />);
    expect(klasy(container)).toBe("");
  });

  it("wyłączona animacja nie uzbraja niczego", () => {
    const { container } = render(<Sonda enabled={false} onMount />);
    expect(klasy(container)).toBe("");
  });

  it("element schowany (zerowe pudełko) zostaje widoczny, nie uzbrojony", () => {
    // `display: none`, zwinięta zakładka. Uzbrojony nigdy by się nie odegrał,
    // bo ścieżka montażowa nie ma obserwatora, który by go dopilnował - więc
    // hak ma go w ogóle nie ruszać.
    ustawPudelko({ top: 0, height: 0 });
    const { container } = render(<Sonda enabled onMount />);
    expect(klasy(container)).toBe("");
  });

  it("element poza widokiem idzie ŚCIEŻKĄ SCROLLOWĄ, nie montażową", async () => {
    ustawPudelko({ top: 5000, height: 300 });
    const { container } = render(<Sonda enabled onMount />);
    // Montaż go nie tknął - czeka na obserwatora.
    expect(klasy(container)).toBe("");
    act(() => ostatniObserwator?.callback([{ isIntersecting: false }]));
    await waitFor(() => expect(klasy(container)).toBe("neh-armed"));
    act(() => ostatniObserwator?.callback([{ isIntersecting: true }]));
    await waitFor(() => expect(klasy(container)).toContain("neh-run"));
  });

  it("brak IntersectionObservera zostawia treść widoczną", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    const { container } = render(<Sonda enabled onMount />);
    expect(klasy(container)).toBe("");
  });

  it("wyłączenie animacji w trakcie życia komponentu ROZBRAJA stan", async () => {
    const { container, rerender } = render(<Sonda enabled onMount />);
    await waitFor(() => expect(klasy(container)).toContain("neh-run"));
    rerender(<Sonda enabled={false} onMount />);
    // Bez tego element uzbrojony wcześniej zostawał niewidoczny aż do remontu,
    // czyli wyłączenie animacji KASOWAŁO treść zamiast ją pokazać.
    expect(klasy(container)).toBe("");
  });
});
