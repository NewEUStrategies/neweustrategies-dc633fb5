// Kontrakt dostępności atomu `LabeledField` - bramka po defekcie.
//
// DEFEKT NAPRAWIONY 19.08.2026. W panelach cennika i członkostwa 42 pola stały
// w układzie `<Label>Nazwa PL</Label><Input />`: etykieta OBOK pola, bez
// `htmlFor`, bez `id`, bez zagnieżdżenia. Dla osoby widzącej wyglądało to
// poprawnie; czytnik ekranu ogłaszał 42 pola BEZ NAZWY - w formularzach, w
// których redakcja ustawia ceny, benefity, rabat retencyjny i wygaśnięcie
// dostępu. Widać to było wprost w testach: pól nie dało się znaleźć po
// etykiecie, tylko po wpisanej wartości albo po pozycji na liście.
//
// Te testy są bramką: gdyby ktoś wrócił do luźnej pary etykieta-pole, plik
// natychmiast to pokaże.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { LabeledField } from "@/components/admin/pricing/atoms/LabeledField";

describe("LabeledField - etykieta powiązana z polem", () => {
  it("pole daje się znaleźć PO ETYKIECIE, nie po wartości", () => {
    render(
      <LabeledField label="Nazwa po polsku">
        {(field) => <input {...field} defaultValue="Członek" />}
      </LabeledField>,
    );

    expect(screen.getByLabelText("Nazwa po polsku")).toBeInTheDocument();
    expect(screen.getByLabelText("Nazwa po polsku")).toHaveValue("Członek");
  });

  it("etykieta wskazuje TO pole - `htmlFor` zgadza się z `id`", () => {
    render(
      <LabeledField label="Ranga">{(field) => <input {...field} type="number" />}</LabeledField>,
    );

    const input = screen.getByLabelText("Ranga");
    expect(input.id).toBeTruthy();
    expect(document.querySelector(`label[for="${input.id}"]`)).toBeInTheDocument();
  });

  it("DWA pola obok siebie mają RÓŻNE identyfikatory", () => {
    // Wspólny identyfikator wiązałby obie etykiety z pierwszym polem - druga
    // para wyglądałaby poprawnie i nie działała.
    render(
      <>
        <LabeledField label="Nazwa PL">{(field) => <input {...field} />}</LabeledField>
        <LabeledField label="Nazwa EN">{(field) => <input {...field} />}</LabeledField>
      </>,
    );

    const pl = screen.getByLabelText("Nazwa PL");
    const en = screen.getByLabelText("Nazwa EN");
    expect(pl.id).not.toBe(en.id);
    expect(pl).not.toBe(en);
  });

  it("PODPOWIEDŹ jest podłączona przez `aria-describedby`, nie luźnym akapitem", () => {
    render(
      <LabeledField label="Zdanie zaufania" hint="Rozdzielaj kropką środkową">
        {(field) => <input {...field} />}
      </LabeledField>,
    );

    const input = screen.getByLabelText("Zdanie zaufania");
    expect(input).toHaveAccessibleDescription("Rozdzielaj kropką środkową");
  });

  it("bez podpowiedzi pole nie dostaje pustego opisu ani pustego akapitu", () => {
    const { container } = render(
      <LabeledField label="Badge">{(field) => <input {...field} />}</LabeledField>,
    );

    expect(screen.getByLabelText("Badge")).not.toHaveAttribute("aria-describedby");
    expect(container.querySelector("p")).toBeNull();
  });

  it("klasa układu przechodzi na kontener, nie na pole", () => {
    const { container } = render(
      <LabeledField label="Ikona" className="space-y-1">
        {(field) => <input {...field} />}
      </LabeledField>,
    );

    expect(container.firstElementChild).toHaveClass("space-y-1");
    expect(screen.getByLabelText("Ikona")).not.toHaveClass("space-y-1");
  });

  it("etykieta i podpowiedź są kompaktowe", () => {
    render(
      <LabeledField label="Skrót" hint="Maksymalnie 3 znaki">
        {(field) => <input {...field} />}
      </LabeledField>,
    );

    const label = document.querySelector('label[for]');
    expect(label).toHaveClass("text-[10px]");
    expect(screen.getByText("Maksymalnie 3 znaki")).toHaveClass("text-[10px]");
  });
});
