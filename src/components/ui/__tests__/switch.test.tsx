// Switch to Radiksowy `role="switch"` z warstwą wizualną SVG („płynny"
// przełącznik z filtrem goo). Kolory idą z tokenów `--to-toggle-*`, więc
// jasny i ciemny motyw oraz ustawienia administratora działają bez zmian.
// Kontrakt: rola i `aria-checked`, przełączanie kliknięciem, SVG ukryty przed
// czytnikiem, a identyfikator filtra jest poprawnym fragmentem URL (inaczej
// `filter="url(#…)"` nie trafia w filtr) i jest unikalny dla każdej instancji.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Switch } from "../switch";

afterEach(cleanup);

describe("Switch", () => {
  it("wystawia rolę switch z nazwą i stanem wyłączonym", () => {
    render(<Switch aria-label="Tryb ciemny" />);
    const toggle = screen.getByRole("switch", { name: "Tryb ciemny" });
    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle).toHaveAttribute("data-state", "unchecked");
    expect(toggle).toHaveAttribute("data-ui-switch", "");
    expect(toggle).toHaveClass("ui-switch", "group", "peer", "focus-visible:ring-2");
  });

  it("przełącza stan kliknięciem i zgłasza nową wartość", () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Powiadomienia" onCheckedChange={onCheckedChange} />);
    const toggle = screen.getByRole("switch", { name: "Powiadomienia" });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(toggle).toHaveAttribute("data-state", "checked");
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it("rysuje jeden suwak, który przesuwa się w stanie włączonym", () => {
    render(<Switch aria-label="Suwak" />);
    const toggle = screen.getByRole("switch", { name: "Suwak" });
    const thumb = toggle.querySelector("[data-ui-switch-thumb]");
    expect(toggle.querySelector("svg")).toBeNull();
    expect(thumb).toHaveAttribute("data-state", "unchecked");
    expect(thumb).toHaveClass("data-[state=checked]:translate-x-4", "h-[18px]", "w-[18px]");
    fireEvent.click(toggle);
    expect(thumb).toHaveAttribute("data-state", "checked");
  });

  it("bierze kolory toru z tokenów motywu", () => {
    render(<Switch aria-label="Kolory" />);
    const toggle = screen.getByRole("switch", { name: "Kolory" });
    expect(toggle).toHaveClass(
      "bg-[var(--to-toggle-off,var(--input))]",
      "data-[state=checked]:bg-[var(--to-toggle-on,var(--primary))]",
    );
  });

  it("w stanie wyłączonym nie reaguje na kliknięcie", () => {
    const onCheckedChange = vi.fn();
    render(<Switch aria-label="Zablokowany" disabled onCheckedChange={onCheckedChange} />);
    const toggle = screen.getByRole("switch", { name: "Zablokowany" });
    expect(toggle).toBeDisabled();
    fireEvent.click(toggle);
    expect(onCheckedChange).not.toHaveBeenCalled();
    expect(toggle).toHaveClass("disabled:cursor-not-allowed", "disabled:opacity-50");
  });

  it("przyjmuje stan początkowy, klasę wywołującego i ref", () => {
    const ref = createRef<HTMLButtonElement>();
    render(<Switch ref={ref} aria-label="Start" defaultChecked className="h-8 w-14" />);
    expect(ref.current).toBe(screen.getByRole("switch", { name: "Start" }));
    expect(ref.current).toHaveAttribute("aria-checked", "true");
    expect(ref.current).toHaveClass("h-8", "w-14");
    expect(ref.current).not.toHaveClass("h-6");
  });
});
