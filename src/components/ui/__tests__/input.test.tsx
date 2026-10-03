// Input to jedno pole tekstowe całej platformy. Kontrakt: wygląd (ramka,
// pierścień, stany) idzie z semantycznej klasy `.input`, wspólnej z
// `FloatingInput`, więc jasny i ciemny motyw wyglądają identycznie wszędzie.
// Klasa wywołującego dokłada układ, ale nie zdejmuje `.input`.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Input } from "../input";

afterEach(cleanup);

describe("Input", () => {
  it("renderuje pole tekstowe z klasą motywu i celem dotykowym 44 px", () => {
    render(<Input aria-label="Imię" />);
    const input = screen.getByRole("textbox", { name: "Imię" });
    expect(input.tagName).toBe("INPUT");
    expect(input).toHaveClass("input", "pointer-coarse:min-h-11");
  });

  it("przekazuje typ pola, więc e-mail i hasło dostają właściwą semantykę", () => {
    const { container } = render(
      <>
        <Input type="email" aria-label="E-mail" />
        <Input type="password" aria-label="Hasło" />
      </>,
    );
    expect(screen.getByRole("textbox", { name: "E-mail" })).toHaveAttribute("type", "email");
    const password = container.querySelector('input[type="password"]');
    expect(password).toHaveAttribute("aria-label", "Hasło");
  });

  it("dokłada klasę wywołującego bez zdejmowania klasy motywu", () => {
    render(<Input aria-label="Pole" className="w-48 mt-2" />);
    expect(screen.getByRole("textbox")).toHaveClass("input", "w-48", "mt-2");
  });

  it("zgłasza wpisaną wartość i przyjmuje ognisko przez ref", () => {
    const onChange = vi.fn();
    const ref = createRef<HTMLInputElement>();
    render(<Input aria-label="Miasto" ref={ref} onChange={onChange} />);
    ref.current?.focus();
    const input = screen.getByRole("textbox", { name: "Miasto" });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: "Kraków" } });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue("Kraków");
  });

  it("wystawia stan wyłączenia i błędu czytnikowi ekranu", () => {
    render(<Input aria-label="Kod" disabled aria-invalid="true" aria-describedby="blad" />);
    const input = screen.getByRole("textbox", { name: "Kod" });
    expect(input).toBeDisabled();
    expect(input).toBeInvalid();
    expect(input).toHaveAttribute("aria-describedby", "blad");
  });
});
