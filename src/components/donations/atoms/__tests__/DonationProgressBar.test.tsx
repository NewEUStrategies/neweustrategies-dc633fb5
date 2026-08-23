// Pasek postępu zbiórki (atom). RYZYKIEM jest tu OBIETNICA: wypełniony pasek
// czyta się jako „cel prawie osiągnięty", więc każdy procent, który tu wjeżdża,
// jest komunikatem o pieniądzach.
//
// CO TEN PLIK DOWODZI.
//   1. Poziomy wariant steruje SZEROKOŚCIĄ, pionowy (termometr) WYSOKOŚCIĄ -
//      to były trzy osobne kopie inline w widoku i nikt ich nie porównywał.
//   2. Atom NIE przycina wartości: 150 rysuje pasek 150%. Przycinanie jest
//      decyzją modelu (`computeProgressPct`), więc gdyby ktoś pominął model,
//      pasek wyjdzie poza tor - i ten test to pokazuje.
//   3. Akcent nadpisuje tło inline; jego brak zostawia klasę motywu.
//   4. Nakładka toru (etykieta procentu w termometrze) renderuje się PO
//      wypełnieniu, wewnątrz toru - inaczej absolutne pozycjonowanie ucieka.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE. Skąd bierze się liczba procenta (i że bez celu
// jest to liczba darczyńców × 5) dowodzi `donationsWidgetModel.test.ts`.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { DonationProgressBar } from "../DonationProgressBar";

afterEach(cleanup);

function fillOf(container: HTMLElement) {
  return container.querySelector<HTMLElement>(".transition-all")!;
}

describe("DonationProgressBar", () => {
  it("DECYZJA: wariant poziomy steruje szerokością wypełnienia", () => {
    const { container } = render(
      <DonationProgressBar pct={42} trackClassName="mt-3 h-3 rounded-full bg-muted" />,
    );
    const fill = fillOf(container);
    expect(fill.style.width).toBe("42%");
    expect(fill.style.height).toBe("");
    expect(fill.className).toContain("h-full");
  });

  it("DECYZJA: wariant pionowy (termometr) steruje WYSOKOŚCIĄ, nie szerokością", () => {
    const { container } = render(
      <DonationProgressBar pct={42} orientation="vertical" trackClassName="h-56 w-14" />,
    );
    const fill = fillOf(container);
    expect(fill.style.height).toBe("42%");
    expect(fill.style.width).toBe("");
    expect(fill.className).toContain("w-full");
  });

  it("DECYZJA: atom NIE przycina procentu - 150 rysuje pasek poza torem", () => {
    const { container } = render(<DonationProgressBar pct={150} trackClassName="tor" />);
    expect(fillOf(container).style.width).toBe("150%");
  });

  it("DECYZJA: zero renderuje pasek o zerowej szerokości, a nie brak paska", () => {
    const { container } = render(<DonationProgressBar pct={0} trackClassName="tor" />);
    expect(fillOf(container)).not.toBeNull();
    expect(fillOf(container).style.width).toBe("0%");
  });

  it("DECYZJA: akcent nadpisuje tło inline, jego brak zostawia kolor motywu", () => {
    const { container: withAccent } = render(
      <DonationProgressBar pct={10} accent="#c0392b" trackClassName="tor" />,
    );
    expect(fillOf(withAccent).style.background).toBe("#c0392b");
    cleanup();
    const { container: plain } = render(<DonationProgressBar pct={10} trackClassName="tor" />);
    expect(fillOf(plain).style.background).toBe("");
    expect(fillOf(plain).className).toContain("bg-primary");
  });

  it("DECYZJA: pusty akcent jest traktowany jak brak akcentu", () => {
    const { container } = render(<DonationProgressBar pct={10} accent="" trackClassName="tor" />);
    expect(fillOf(container).style.background).toBe("");
  });

  it("DECYZJA: klasy toru przychodzą propsem - każdy wariant ma inny tor", () => {
    const { container } = render(
      <DonationProgressBar pct={10} trackClassName="h-2 overflow-hidden rounded-full bg-muted" />,
    );
    expect(container.firstElementChild!.className).toBe(
      "h-2 overflow-hidden rounded-full bg-muted",
    );
  });

  it("DECYZJA: nakładka toru renderuje się W TORZE, zaraz po wypełnieniu", () => {
    const { container } = render(
      <DonationProgressBar pct={10} orientation="vertical" trackClassName="tor">
        <span data-testid="etykieta">10%</span>
      </DonationProgressBar>,
    );
    const track = container.firstElementChild!;
    expect(track.children).toHaveLength(2);
    expect(track.children[1].getAttribute("data-testid")).toBe("etykieta");
  });
});
