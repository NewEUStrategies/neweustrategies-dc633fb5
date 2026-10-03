// Textarea dzieli klasę `.input` z `Input` i `FloatingInput`, więc pierścień
// ogniska, ramka i parzystość jasnego i ciemnego motywu są identyczne
// w każdym formularzu.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Textarea } from "../textarea";

afterEach(cleanup);

describe("Textarea", () => {
  it("renderuje wielowierszowe pole tekstowe z klasą motywu", () => {
    render(<Textarea aria-label="Wiadomość" />);
    const field = screen.getByRole("textbox", { name: "Wiadomość" });
    expect(field.tagName).toBe("TEXTAREA");
    expect(field).toHaveClass("input");
  });

  it("dokłada klasę wywołującego bez zdejmowania klasy motywu", () => {
    render(<Textarea aria-label="Opis" className="min-h-32 resize-none" />);
    expect(screen.getByRole("textbox")).toHaveClass("input", "min-h-32", "resize-none");
  });

  it("zgłasza wpisany tekst i przyjmuje ognisko przez ref", () => {
    const onChange = vi.fn();
    const ref = createRef<HTMLTextAreaElement>();
    render(<Textarea aria-label="Komentarz" ref={ref} onChange={onChange} />);
    ref.current?.focus();
    const field = screen.getByRole("textbox", { name: "Komentarz" });
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: "Pierwszy wiersz\nDrugi wiersz" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(field).toHaveValue("Pierwszy wiersz\nDrugi wiersz");
  });

  it("wystawia wyłączenie, wymagalność i błąd czytnikowi ekranu", () => {
    render(<Textarea aria-label="Uzasadnienie" disabled required aria-invalid="true" />);
    const field = screen.getByRole("textbox", { name: "Uzasadnienie" });
    expect(field).toBeDisabled();
    expect(field).toBeRequired();
    expect(field).toBeInvalid();
  });
});
