// Label to natywny `<label>` z Radiksa. Kontrakt: nadaje polu nazwę
// dostępności przez `htmlFor`, kliknięcie przenosi ognisko na pole, a wygląd
// wyłączonego pola sąsiada (`peer-disabled`) idzie z klasy prymitywu.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Label } from "../label";

afterEach(cleanup);

describe("Label", () => {
  it("nadaje powiązanemu polu nazwę dostępności", () => {
    render(
      <>
        <Label htmlFor="email">Adres e-mail</Label>
        <input id="email" type="email" />
      </>,
    );
    const label = screen.getByText("Adres e-mail");
    expect(label.tagName).toBe("LABEL");
    expect(label).toHaveAttribute("for", "email");
    expect(screen.getByRole("textbox", { name: "Adres e-mail" })).toHaveAttribute("id", "email");
  });

  it("przełącza powiązane pole wyboru po kliknięciu etykiety", () => {
    render(
      <>
        <input id="zgoda" type="checkbox" />
        <Label htmlFor="zgoda">Akceptuję regulamin</Label>
      </>,
    );
    const checkbox = screen.getByRole("checkbox", { name: "Akceptuję regulamin" });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(screen.getByText("Akceptuję regulamin"));
    expect(checkbox).toBeChecked();
  });

  it("blokuje zaznaczanie tekstu etykiety przy podwójnym kliknięciu, ale przepuszcza własny handler", () => {
    const onMouseDown = vi.fn();
    render(<Label onMouseDown={onMouseDown}>Zgoda</Label>);
    const label = screen.getByText("Zgoda");
    const doubleClick = fireEvent.mouseDown(label, { detail: 2 });
    expect(onMouseDown).toHaveBeenCalledTimes(1);
    expect(doubleClick).toBe(false);
    const singleClick = fireEvent.mouseDown(label, { detail: 1 });
    expect(singleClick).toBe(true);
  });

  it("niesie klasy stanu wyłączonego sąsiada i scala klasę wywołującego", () => {
    const ref = createRef<HTMLLabelElement>();
    render(
      <Label ref={ref} className="font-semibold text-destructive">
        Telefon
      </Label>,
    );
    expect(ref.current).toBeInstanceOf(HTMLLabelElement);
    expect(ref.current).toHaveClass(
      "text-sm",
      "leading-none",
      "peer-disabled:cursor-not-allowed",
      "peer-disabled:opacity-70",
      "font-semibold",
      "text-destructive",
    );
    expect(ref.current).not.toHaveClass("font-medium");
  });
});
