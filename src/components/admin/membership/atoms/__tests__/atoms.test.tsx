// Kontrakt DOSTĘPNOŚCI atomów panelu członkostwa.
//
// Trzy atomy wyniesione z pliku trasy `/admin/membership` (898 linii). Panel ma
// cztery sekcje i kilkanaście pól w karcie warstwy, więc bez struktury
// nagłówków i legend czytnik czyta go jako jedną płaską listę - a to panel,
// w którym ustawia się, co dokładnie dostaje płacący członek.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Layers } from "lucide-react";

import { FieldGroupRule } from "@/components/admin/membership/atoms/FieldGroupRule";
import { KpiTile } from "@/components/admin/membership/atoms/KpiTile";
import { SectionCard } from "@/components/admin/membership/atoms/SectionCard";

describe("KpiTile - licznik czytelny bez ikony", () => {
  it("etykieta i wartość tworzą parę opis-wartość", () => {
    render(<KpiTile icon={Layers} label="Warstwy" value="4 / 6" />);

    expect(screen.getByText("Warstwy").tagName).toBe("DT");
    expect(screen.getByText("4 / 6").tagName).toBe("DD");
  });

  it("ikona jest dekoracją", () => {
    const { container } = render(<KpiTile icon={Layers} label="Nadania" value="12" />);

    expect(container.querySelector("svg")).toHaveAttribute("aria-hidden");
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("kreska zamiast wartości też jest treścią (brak warstwy domyślnej)", () => {
    render(<KpiTile icon={Layers} label="Domyślna" value="-" />);

    expect(screen.getByText("-")).toBeInTheDocument();
    expect(screen.getByText("Domyślna")).toBeInTheDocument();
  });
});

describe("SectionCard - sekcje panelu tworzą spis treści", () => {
  it("tytuł sekcji to nagłówek drugiego poziomu", () => {
    render(
      <SectionCard icon={Layers} title="Katalog warstw">
        <p>treść</p>
      </SectionCard>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Katalog warstw" })).toBeInTheDocument();
    expect(screen.getByText("treść")).toBeInTheDocument();
  });

  it("opis jest opcjonalny - bez niego nie ma pustego akapitu", () => {
    const { container } = render(
      <SectionCard icon={Layers} title="Bez opisu">
        <p>treść</p>
      </SectionCard>,
    );

    expect(container.querySelectorAll("p")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("Bez opisu");
  });

  it("opis pokazuje się razem z tytułem, gdy jest", () => {
    render(
      <SectionCard icon={Layers} title="Nadania" description="Członkostwo poza planem">
        <p>treść</p>
      </SectionCard>,
    );

    expect(screen.getByText("Członkostwo poza planem")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Nadania" })).toBeInTheDocument();
  });

  it("`padded={false}` zdejmuje odstęp, ale NIE strukturę", () => {
    render(
      <SectionCard icon={Layers} title="Siatka" padded={false}>
        <p>karty</p>
      </SectionCard>,
    );

    expect(screen.getByRole("heading", { level: 2, name: "Siatka" })).toBeInTheDocument();
    expect(screen.getByText("karty")).toBeInTheDocument();
  });
});

describe("FieldGroupRule - grupa pól ma nazwę grupy", () => {
  it("podpis grupy to legenda zbioru pól", () => {
    render(
      <FieldGroupRule label="Nazwy">
        <input aria-label="Nazwa PL" />
      </FieldGroupRule>,
    );

    const group = screen.getByRole("group", { name: /Nazwy/ });
    expect(group.tagName).toBe("FIELDSET");
    expect(screen.getByLabelText("Nazwa PL")).toBeInTheDocument();
  });

  it("kreska po podpisie jest dekoracją", () => {
    const { container } = render(
      <FieldGroupRule label="Możliwości">
        <span>pola</span>
      </FieldGroupRule>,
    );

    expect(container.querySelector("[aria-hidden]")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Możliwości/ })).toBeInTheDocument();
  });

  it("dwie grupy obok siebie są rozróżnialne po nazwie", () => {
    render(
      <>
        <FieldGroupRule label="Status">
          <input aria-label="Ranga" />
        </FieldGroupRule>
        <FieldGroupRule label="Benefity">
          <input aria-label="Punkt" />
        </FieldGroupRule>
      </>,
    );

    expect(screen.getByRole("group", { name: /Status/ })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Benefity/ })).toBeInTheDocument();
  });
});
