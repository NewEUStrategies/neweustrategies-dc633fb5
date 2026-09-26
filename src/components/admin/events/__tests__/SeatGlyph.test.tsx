// Atom „miejsce na płótnie" - STAN NIESIONY KSZTAŁTEM, NIE SAMYM KOLOREM.
//
// CO TEN PLIK DOWODZI.
//   1. Każdy z czterech stanów ma WŁASNY znak niezależny od koloru kategorii:
//      zajęte = pełne koło, wolne = sam obrys, rezerwacja = obrys przerywany,
//      blokada = kreskowanie. Miejsce bez kategorii dostaje neutralny token.
//   2. Zaznaczenie to zewnętrzny pierścień, a dostępność - kwadracik, który na
//      pełnym kole ma kolor tła (inaczej zlewa się z wypełnieniem).
//   3. ROVING TABINDEX: tylko miejsce-przystanek ma `tabIndex=0`.
//   4. Kliknięcie z Shift / Cmd / Ctrl ROZSZERZA zaznaczenie; klawisze i fokus
//      idą do płótna z identyfikatorem miejsca.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { SeatGlyph, type SeatGlyphProps } from "@/components/admin/events/atoms/SeatGlyph";

function glyph(over: Partial<SeatGlyphProps> = {}) {
  const props: SeatGlyphProps = {
    seatId: "s-1",
    cx: 10,
    cy: 20,
    r: 8,
    color: "#aa0000",
    status: "available",
    occupied: false,
    accessible: false,
    selected: false,
    tabStop: false,
    label: "Rząd A, miejsce 1",
    onActivate: vi.fn(),
    onKey: vi.fn(),
    onFocusSeat: vi.fn(),
    ...over,
  };
  const view = render(
    <svg>
      <SeatGlyph {...props} />
    </svg>,
  );
  const g = view.container.querySelector("g") as SVGGElement;
  const circles = [...g.querySelectorAll("circle")];
  return { props, g, circles, body: circles.at(-1) as SVGCircleElement };
}

describe("SeatGlyph - znak stanu", () => {
  it("wolne miejsce to sam obrys w kolorze kategorii", () => {
    const { g, body } = glyph();
    expect(body.getAttribute("fill")).toBe("transparent");
    expect(body.getAttribute("stroke")).toBe("#aa0000");
    expect(body.getAttribute("stroke-dasharray")).toBeNull();
    expect(g.getAttribute("data-status")).toBe("available");
    expect(g.getAttribute("data-occupied")).toBe("false");
    expect(g.getAttribute("aria-label")).toBe("Rząd A, miejsce 1");
    expect(g.getAttribute("aria-pressed")).toBe("false");
  });

  it("zajęte miejsce to pełne koło, a bez kategorii - neutralny token", () => {
    expect(glyph({ occupied: true }).body.getAttribute("fill")).toBe("#aa0000");
    const bezKategorii = glyph({ occupied: true, color: null });
    expect(bezKategorii.body.getAttribute("fill")).toBe("currentColor");
    expect(bezKategorii.body.getAttribute("stroke")).toBe("currentColor");
    expect(bezKategorii.g.getAttribute("data-occupied")).toBe("true");
  });

  it("rezerwacja ma obrys przerywany, a blokada - kreskowanie", () => {
    expect(glyph({ status: "held" }).body.getAttribute("stroke-dasharray")).toBe("4 3");
    const blokada = glyph({ status: "blocked", occupied: true });
    expect(blokada.body.getAttribute("fill")).toBe("url(#seat-hatch)");
  });

  it("zaznaczenie dokłada zewnętrzny pierścień", () => {
    expect(glyph().circles).toHaveLength(2);
    const zaznaczone = glyph({ selected: true });
    expect(zaznaczone.circles).toHaveLength(3);
    expect(zaznaczone.circles[0]?.getAttribute("r")).toBe("12");
    expect(zaznaczone.g.getAttribute("aria-pressed")).toBe("true");
  });

  it("dostępność to kwadracik: na pełnym kole w kolorze tła, na pustym - pierwszego planu", () => {
    expect(glyph().g.querySelector("rect")).toBeNull();
    expect(glyph({ accessible: true }).g.querySelector("rect")?.getAttribute("class")).toBe(
      "fill-foreground",
    );
    expect(
      glyph({ accessible: true, occupied: true }).g.querySelector("rect")?.getAttribute("class"),
    ).toBe("fill-background");
  });
});

describe("SeatGlyph - obsługa", () => {
  it("tylko przystanek ma tabIndex 0", () => {
    expect(glyph().g.getAttribute("tabindex")).toBe("-1");
    expect(glyph({ tabStop: true }).g.getAttribute("tabindex")).toBe("0");
  });

  it("kliknięcie zwykłe zastępuje zaznaczenie, z modyfikatorem - rozszerza", () => {
    const { g, props } = glyph();
    fireEvent.click(g);
    fireEvent.click(g, { shiftKey: true });
    fireEvent.click(g, { metaKey: true });
    fireEvent.click(g, { ctrlKey: true });
    expect(vi.mocked(props.onActivate).mock.calls).toEqual([
      ["s-1", false],
      ["s-1", true],
      ["s-1", true],
      ["s-1", true],
    ]);
  });

  it("klawisz i fokus idą do płótna z identyfikatorem miejsca", () => {
    const { g, props } = glyph();
    fireEvent.keyDown(g, { key: "ArrowRight" });
    fireEvent.focus(g);
    expect(vi.mocked(props.onKey).mock.calls[0]?.[0]).toBe("s-1");
    expect(vi.mocked(props.onFocusSeat)).toHaveBeenCalledWith("s-1");
  });
});
