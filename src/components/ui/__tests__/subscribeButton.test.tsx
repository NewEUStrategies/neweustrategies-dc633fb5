// SubscribeButton stoi w kilku formularzach zapisu. Kontrakt: domyślnie
// wysyła formularz, w trakcie wysyłki jest wyłączony i ogłasza zajętość
// (`aria-busy`), a zamiast etykiety pokazuje etykietę ładowania albo wielokropek.
// Kolory idą z tokenów marki przez klasę `.btn-bubbly`, wspólną dla motywów.
import { createRef, type FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import DefaultSubscribeButton, { SubscribeButton } from "../subscribe-button";

afterEach(cleanup);

describe("SubscribeButton", () => {
  it("domyślnie jest przyciskiem wysyłki formularza z etykietą w środku", () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    render(
      <form aria-label="Newsletter" onSubmit={onSubmit}>
        <SubscribeButton>Zapisz się</SubscribeButton>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Zapisz się" });
    expect(button).toHaveAttribute("type", "submit");
    expect(button).toHaveClass("btn-bubbly");
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button.querySelector(".btn-bubbly__label")).toHaveTextContent("Zapisz się");
    fireEvent.click(button);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("w trakcie wysyłki jest wyłączony, ogłasza zajętość i pokazuje etykietę ładowania", () => {
    const onClick = vi.fn();
    render(
      <SubscribeButton loading loadingLabel="Zapisywanie" onClick={onClick}>
        Zapisz się
      </SubscribeButton>,
    );
    const button = screen.getByRole("button", { name: "Zapisywanie" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Zapisz się")).toBeNull();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("bez etykiety ładowania pokazuje wielokropek zamiast pustego przycisku", () => {
    render(
      <SubscribeButton loading aria-label="Zapisz się">
        Zapisz się
      </SubscribeButton>,
    );
    const button = screen.getByRole("button", { name: "Zapisz się" });
    expect(button).toHaveTextContent("…");
    expect(button).toHaveAttribute("aria-busy", "true");
  });

  it("respektuje jawne wyłączenie bez ogłaszania zajętości", () => {
    render(<SubscribeButton disabled>Zapisz się</SubscribeButton>);
    const button = screen.getByRole("button", { name: "Zapisz się" });
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute("aria-busy");
  });

  it("pozwala zmienić typ, dołożyć klasę i przyjąć ognisko przez ref", () => {
    const ref = createRef<HTMLButtonElement>();
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    render(
      <form aria-label="Formularz" onSubmit={onSubmit}>
        <DefaultSubscribeButton ref={ref} type="button" className="w-full">
          Dalej
        </DefaultSubscribeButton>
      </form>,
    );
    const button = screen.getByRole("button", { name: "Dalej" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("btn-bubbly", "w-full");
    ref.current?.focus();
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
