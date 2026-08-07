// DegreeBadge (atom): odznaka „1°/2°/3°".
//
// Kontrakt, którego pilnujemy:
//   - stopień 0 („poza zasięgiem") nie renderuje NICZEGO - brak wiedzy nie
//     jest informacją, którą warto pokazywać,
//   - cyfra jest skrótem wizualnym, a czytnik ekranu dostaje pełne zdanie
//     (odznaka „2°" bez kontekstu jest bezużyteczna niewidomemu),
//   - teksty idą ze SŁOWNIKA (żadnego defaultValue w kodzie - patrz bramka
//     networkI18nKeys.gate).
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { translateKey as k } from "@/test/network/fixtures";

vi.mock("react-i18next", async () => (await import("@/test/network/fixtures")).reactI18nextStub());

import { DegreeBadge } from "@/components/network/atoms/DegreeBadge";

describe("DegreeBadge", () => {
  it.each([
    [1, "first"],
    [2, "second"],
    [3, "third"],
  ] as const)("stopień %i renderuje skrót i pełny opis ze słownika", (degree, suffix) => {
    render(<DegreeBadge degree={degree} />);
    expect(screen.getByText(k(`network.degree.short.${suffix}`))).toBeInTheDocument();
    expect(screen.getByText(k(`network.degree.description.${suffix}`))).toBeInTheDocument();
  });

  it("stopień 0 nie renderuje niczego", () => {
    const { container } = render(<DegreeBadge degree={0} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opis jedzie też w title (ten sam komunikat dla myszy)", () => {
    const { container } = render(<DegreeBadge degree={2} />);
    const badge = container.querySelector("[data-degree='2']");
    expect(badge).toHaveAttribute("title", k("network.degree.description.second"));
  });

  it("cyfra jest ukryta przed czytnikiem ekranu, zdanie - nie", () => {
    const { container } = render(<DegreeBadge degree={3} />);
    const short = screen.getByText(k("network.degree.short.third"));
    expect(short).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector(".sr-only")).toHaveTextContent(
      k("network.degree.description.third"),
    );
  });

  it("rozmiar `sm` jest wariantem tego samego atomu, nie osobnym komponentem", () => {
    const { container } = render(<DegreeBadge degree={1} size="sm" />);
    expect(container.querySelector("[data-degree='1']")?.className).toContain("h-5");
  });
});
