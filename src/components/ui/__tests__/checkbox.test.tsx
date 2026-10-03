// Checkbox to Radiksowy `button role="checkbox"` z własnym rysunkiem SVG
// (`.lov-check`, kolory z tokenów, więc ten sam wygląd w obu motywach).
// Kontrakt dostępności: rola i `aria-checked` (łącznie ze stanem mieszanym),
// przełączanie kliknięciem, BRAK przełączania klawiszem Enter (zgodnie
// z WAI-ARIA pole wyboru reaguje na spację, a Enter ma wysyłać formularz),
// dekoracyjny SVG ukryty przed czytnikiem i ukryte pole formularza.
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Checkbox } from "../checkbox";

afterEach(cleanup);

describe("Checkbox", () => {
  it("wystawia rolę checkbox z nazwą z etykiety i stanem niezaznaczonym", () => {
    render(
      <>
        <Checkbox id="zgoda" />
        <label htmlFor="zgoda">Zgoda na newsletter</label>
      </>,
    );
    const box = screen.getByRole("checkbox", { name: "Zgoda na newsletter" });
    expect(box.tagName).toBe("BUTTON");
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(box).toHaveAttribute("data-state", "unchecked");
    expect(box).toHaveClass("lov-check", "focus-visible:ring-2", "focus-visible:ring-ring");
  });

  it("przełącza stan kliknięciem i zgłasza nową wartość", () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Przypomnienie" onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole("checkbox", { name: "Przypomnienie" });
    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "true");
    expect(box).toHaveAttribute("data-state", "checked");
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(box);
    expect(box).toHaveAttribute("aria-checked", "false");
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it("nie przełącza się klawiszem Enter, zgodnie z wzorcem WAI-ARIA", () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Zgoda" onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole("checkbox", { name: "Zgoda" });
    box.focus();
    expect(box).toHaveFocus();
    const notPrevented = fireEvent.keyDown(box, { key: "Enter" });
    expect(notPrevented).toBe(false);
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(box).toHaveAttribute("aria-checked", "false");
  });

  it("ogłasza stan mieszany jako aria-checked=mixed", () => {
    render(<Checkbox aria-label="Wszystkie" checked="indeterminate" />);
    const box = screen.getByRole("checkbox", { name: "Wszystkie" });
    expect(box).toHaveAttribute("aria-checked", "mixed");
    expect(box).toHaveAttribute("data-state", "indeterminate");
  });

  it("ukrywa dekoracyjny rysunek przed czytnikiem, a wskaźnik pokazuje tylko po zaznaczeniu", () => {
    function Controlled() {
      const [checked, setChecked] = useState(false);
      return (
        <Checkbox aria-label="Opcja" checked={checked} onCheckedChange={(v) => setChecked(!!v)} />
      );
    }
    render(<Controlled />);
    const box = screen.getByRole("checkbox", { name: "Opcja" });
    const svg = box.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveAttribute("focusable", "false");
    expect(svg).toHaveClass("lov-check__svg");
    expect(box.querySelector(".sr-only")).toBeNull();
    fireEvent.click(box);
    expect(box.querySelector(".sr-only")).toHaveTextContent("✓");
  });

  it("w stanie wyłączonym nie reaguje na kliknięcie", () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox aria-label="Zablokowana" disabled onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole("checkbox", { name: "Zablokowana" });
    expect(box).toBeDisabled();
    fireEvent.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(box).toHaveClass("disabled:cursor-not-allowed", "disabled:opacity-50");
  });

  it("w formularzu oddaje wartość przez ukryte pole i przyjmuje ref oraz klasę", () => {
    const ref = createRef<HTMLButtonElement>();
    const { container } = render(
      <form aria-label="Ustawienia">
        <Checkbox ref={ref} name="powiadomienia" value="tak" defaultChecked className="mt-1" />
      </form>,
    );
    expect(ref.current).toHaveAttribute("role", "checkbox");
    expect(ref.current).toHaveClass("mt-1", "lov-check");
    const hidden = container.querySelector('input[type="checkbox"][name="powiadomienia"]');
    expect(hidden).not.toBeNull();
    expect(hidden).toBeChecked();
    expect(hidden).toHaveAttribute("aria-hidden", "true");
  });
});
