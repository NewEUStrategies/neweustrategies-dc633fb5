// Badge to etykieta statusu. Każdy wariant bierze kolor z pary tokenów
// motywu, więc test pilnuje klas każdego z czterech wariantów i wariantu
// domyślnego - to one decydują o czytelności w jasnym i ciemnym motywie.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Badge } from "../badge";

afterEach(cleanup);

const VARIANTS = [
  ["default", ["border-transparent", "bg-primary", "text-primary-foreground"]],
  ["secondary", ["border-transparent", "bg-secondary", "text-secondary-foreground"]],
  ["destructive", ["border-transparent", "bg-destructive", "text-destructive-foreground"]],
  ["outline", ["text-foreground"]],
] as const;

describe("Badge", () => {
  it("bez wariantu przyjmuje wariant podstawowy z kolorem marki", () => {
    render(<Badge>Nowe</Badge>);
    const badge = screen.getByText("Nowe");
    expect(badge.tagName).toBe("DIV");
    expect(badge).toHaveClass(
      "inline-flex",
      "text-xs",
      "font-semibold",
      "bg-primary",
      "text-primary-foreground",
    );
  });

  it.each(VARIANTS)("wariant %s bierze kolory z tokenów motywu", (variant, classes) => {
    render(<Badge variant={variant}>Status</Badge>);
    expect(screen.getByText("Status")).toHaveClass(...classes);
  });

  it("wariant obrysowy nie dostaje wypełnienia tłem", () => {
    render(<Badge variant="outline">Szkic</Badge>);
    const badge = screen.getByText("Szkic");
    expect(badge).toHaveClass("border");
    expect(badge).not.toHaveClass("bg-primary");
    expect(badge).not.toHaveClass("border-transparent");
  });

  it("niesie widoczny pierścień ogniska i przyjmuje atrybuty dostępności", () => {
    render(
      <Badge role="status" aria-label="Opublikowano" className="uppercase">
        OK
      </Badge>,
    );
    const badge = screen.getByRole("status", { name: "Opublikowano" });
    expect(badge).toHaveClass("focus:ring-2", "focus:ring-ring", "uppercase");
  });
});
