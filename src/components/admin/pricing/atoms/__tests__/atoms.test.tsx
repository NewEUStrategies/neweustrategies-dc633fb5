// Kontrakt DOSTĘPNOŚCI atomów panelu cennika.
//
// Te atomy powstały ze scalenia kopii rozsianych po pliku trasy
// `/admin/pricing` (1821 linii): trójkąt przycisków kolejności istniał tam trzy
// razy, komunikat pustej listy - cztery. Skoro jeden atom obsługuje teraz
// wszystkie te miejsca, jego kontrakt musi być sprawdzony RAZ i twardo:
// przycisk bez tekstu ma mieć nazwę, pusta lista ma być ogłoszona, a licznik
// ma dać się odczytać bez patrzenia na ikonę.
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Users } from "lucide-react";

import { EmptyHint } from "@/components/admin/pricing/atoms/EmptyHint";
import { FieldGroup } from "@/components/admin/pricing/atoms/FieldGroup";
import { PricingKpi } from "@/components/admin/pricing/atoms/PricingKpi";
import { RowOrderControls } from "@/components/admin/pricing/atoms/RowOrderControls";

const LABELS = { moveUp: "W górę", moveDown: "W dół", delete: "Usuń" };

function renderControls(overrides: Partial<Parameters<typeof RowOrderControls>[0]> = {}) {
  const onMoveUp = vi.fn();
  const onMoveDown = vi.fn();
  const onDelete = vi.fn();
  render(
    <RowOrderControls
      labels={LABELS}
      canMoveUp
      canMoveDown
      onMoveUp={onMoveUp}
      onMoveDown={onMoveDown}
      onDelete={onDelete}
      {...overrides}
    />,
  );
  return { onMoveUp, onMoveDown, onDelete };
}

describe("RowOrderControls - dostępna nazwa przycisku bez tekstu", () => {
  it("każdy z trzech przycisków ma nazwę do odczytania", () => {
    renderControls();

    expect(screen.getByRole("button", { name: "W górę" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "W dół" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Usuń" })).toBeInTheDocument();
  });

  it("ikony są ukryte dla czytnika - nazwa nie dubluje się", () => {
    renderControls();

    const up = screen.getByRole("button", { name: "W górę" });
    expect(up.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(up).toHaveAccessibleName("W górę");
  });

  it("podpowiedź dla myszki (`title`) zostaje obok nazwy dla czytnika", () => {
    renderControls();

    expect(screen.getByRole("button", { name: "Usuń" })).toHaveAttribute("title", "Usuń");
  });
});

describe("RowOrderControls - kiedy przycisk jest wyłączony", () => {
  it("PIERWSZY wiersz nie może iść w górę, ale może w dół", () => {
    renderControls({ canMoveUp: false });

    expect(screen.getByRole("button", { name: "W górę" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "W dół" })).toBeEnabled();
  });

  it("OSTATNI wiersz nie może iść w dół, ale może w górę", () => {
    renderControls({ canMoveDown: false });

    expect(screen.getByRole("button", { name: "W dół" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "W górę" })).toBeEnabled();
  });

  it("trwający zapis kolejności wyłącza OBIE strzałki, ale nie kosz", () => {
    // Dwa nałożone przesunięcia przenumerowałyby listę na podstawie starego
    // stanu - kolejność w panelu i u klienta rozjechałyby się.
    renderControls({ pending: true });

    expect(screen.getByRole("button", { name: "W górę" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "W dół" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Usuń" })).toBeEnabled();
  });

  it("trwające usuwanie wyłącza WYŁĄCZNIE kosz", () => {
    renderControls({ deletePending: true });

    expect(screen.getByRole("button", { name: "Usuń" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "W górę" })).toBeEnabled();
  });
});

describe("RowOrderControls - kliknięcia trafiają we właściwą akcję", () => {
  it("strzałki i kosz wołają swoje procedury, nie cudze", () => {
    const { onMoveUp, onMoveDown, onDelete } = renderControls();

    fireEvent.click(screen.getByRole("button", { name: "W górę" }));
    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(onMoveDown).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "W dół" }));
    fireEvent.click(screen.getByRole("button", { name: "Usuń" }));
    expect(onMoveDown).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("wyłączona strzałka NIE woła procedury", () => {
    const { onMoveUp } = renderControls({ canMoveUp: false });

    fireEvent.click(screen.getByRole("button", { name: "W górę" }));

    expect(onMoveUp).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "W górę" })).toBeDisabled();
  });
});

describe("EmptyHint - pusta lista jest OGŁOSZONA, nie milczy", () => {
  it("komunikat ma rolę statusu", () => {
    render(<EmptyHint>Brak segmentów</EmptyHint>);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Brak segmentów");
    expect(status.tagName).toBe("P");
  });

  it("treść przechodzi bez zmian (także złożona)", () => {
    render(
      <EmptyHint>
        <span>Brak pytań</span>
      </EmptyHint>,
    );

    expect(screen.getByRole("status")).toHaveTextContent("Brak pytań");
    expect(screen.getByText("Brak pytań")).toBeInTheDocument();
  });
});

describe("PricingKpi - licznik czytelny bez patrzenia na ikonę", () => {
  it("etykieta i wartość tworzą parę opis-wartość", () => {
    render(<PricingKpi icon={Users} label="Segmenty" value={4} tone="sky" />);

    expect(screen.getByText("Segmenty").tagName).toBe("DT");
    expect(screen.getByText("4").tagName).toBe("DD");
  });

  it("ikona jest dekoracją, nie treścią", () => {
    const { container } = render(
      <PricingKpi icon={Users} label="Warstwy" value="3/6" tone="primary" />,
    );

    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
    expect(screen.getByText("3/6")).toBeInTheDocument();
  });

  it("każda tonacja daje własny pierścień, więc kafelki są rozróżnialne", () => {
    const { container: sky } = render(<PricingKpi icon={Users} label="a" value={1} tone="sky" />);
    const { container: amber } = render(
      <PricingKpi icon={Users} label="b" value={2} tone="amber" />,
    );

    expect(sky.querySelector("dl")!.className).toContain("ring-sky-500/20");
    expect(amber.querySelector("dl")!.className).toContain("ring-amber-500/20");
  });
});

describe("FieldGroup - grupa pól ma nazwę grupy", () => {
  it("nagłówek grupy to legenda zbioru pól, nie luźny akapit", () => {
    render(
      <FieldGroup icon={Users} title="Segment" accent="bg-primary">
        <input aria-label="Nazwa" />
      </FieldGroup>,
    );

    const group = screen.getByRole("group", { name: /Segment/ });
    expect(group.tagName).toBe("FIELDSET");
    expect(screen.getByLabelText("Nazwa")).toBeInTheDocument();
  });

  it("znacznik i ikona są ukryte dla czytnika", () => {
    const { container } = render(
      <FieldGroup icon={Users} title="Cena" accent="bg-amber-500">
        <span>pole</span>
      </FieldGroup>,
    );

    expect(container.querySelectorAll('[aria-hidden="true"]')).toHaveLength(2);
    expect(screen.getByRole("group", { name: /Cena/ })).toBeInTheDocument();
  });
});
