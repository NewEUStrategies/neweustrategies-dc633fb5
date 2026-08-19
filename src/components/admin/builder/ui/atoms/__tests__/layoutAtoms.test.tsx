// Atomy „opakowujące": etykieta pola (`PropField`, `Row`) i ramka elementu
// listy (`ItemFrame`). Wyglądają trywialnie, ale to one decydują o dostępności
// paneli - dlatego test pilnuje, że podpowiedź jest renderowana tylko gdy jest
// treścią, a przycisk usuwania ma NAZWĘ ze słownika, nie twardy napis.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PropField } from "../PropField";
import { Row } from "../Row";
import { ItemFrame } from "../ItemFrame";

vi.mock("react-i18next", async () => {
  const { reactI18nextStub } = await import("@/test/i18nStub");
  return reactI18nextStub();
});

describe("PropField", () => {
  it("rysuje etykietę, treść i podpowiedź", () => {
    render(
      <PropField label="Wysokość" hint="Puste = auto">
        <input aria-label="pole" />
      </PropField>,
    );
    expect(screen.getByText("Wysokość")).toBeInTheDocument();
    expect(screen.getByLabelText("pole")).toBeInTheDocument();
    expect(screen.getByText("Puste = auto")).toBeInTheDocument();
  });

  it("bez podpowiedzi nie rysuje pustego akapitu", () => {
    const { container } = render(
      <PropField label="Wysokość">
        <input aria-label="pole" />
      </PropField>,
    );
    expect(container.querySelector("p")).toBeNull();
  });

  it("tryb inline układa etykietę i kontrolkę w jednym rzędzie", () => {
    const { container, rerender } = render(
      <PropField label="Widoczne" inline>
        <input aria-label="pole" />
      </PropField>,
    );
    const wrapper = () => container.firstElementChild as HTMLElement;
    expect(wrapper().className).toContain("flex");
    rerender(
      <PropField label="Widoczne">
        <input aria-label="pole" />
      </PropField>,
    );
    expect(wrapper().className).toContain("space-y-1");
  });

  it("etykieta może być węzłem, nie tylko napisem", () => {
    render(
      <PropField label={<strong>Kolor tła</strong>}>
        <input aria-label="pole" />
      </PropField>,
    );
    // Panele wstawiają w etykietę znaczniki („dziedziczone", ikona pomocy),
    // więc typ `ReactNode` jest tu kontraktem, nie luźnym typowaniem.
    expect(screen.getByText("Kolor tła").tagName).toBe("STRONG");
  });
});

describe("Row", () => {
  it("rysuje etykietę, treść i podpowiedź", () => {
    render(
      <Row label="Odstęp" hint="w pikselach">
        <input aria-label="pole" />
      </Row>,
    );
    expect(screen.getByText("Odstęp")).toBeInTheDocument();
    expect(screen.getByLabelText("pole")).toBeInTheDocument();
    expect(screen.getByText("w pikselach")).toBeInTheDocument();
  });

  it("bez podpowiedzi nie rysuje pustego akapitu", () => {
    const { container } = render(
      <Row label="Odstęp">
        <input aria-label="pole" />
      </Row>,
    );
    expect(container.querySelector("p")).toBeNull();
  });
});

describe("ItemFrame", () => {
  it("rysuje tytuł, treść i przycisk usuwania z klucza słownika", () => {
    render(
      <ItemFrame title="Slajd 1" onRemove={vi.fn()}>
        <input aria-label="pole" />
      </ItemFrame>,
    );
    expect(screen.getByText("Slajd 1")).toBeInTheDocument();
    expect(screen.getByLabelText("pole")).toBeInTheDocument();
    // Klucz, nie napis: twardy tekst wypadłby z tłumaczenia interfejsu.
    expect(screen.getByRole("button", { name: "builder.common.delete" })).toBeInTheDocument();
  });

  it("klik usuwa dokładnie raz", () => {
    const onRemove = vi.fn();
    render(
      <ItemFrame title="Slajd 1" onRemove={onRemove}>
        <span>x</span>
      </ItemFrame>,
    );
    fireEvent.click(screen.getByRole("button", { name: "builder.common.delete" }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
