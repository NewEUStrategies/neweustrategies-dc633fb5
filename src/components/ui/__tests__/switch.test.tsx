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

  it("ukrywa warstwę SVG przed czytnikiem i wiąże ją z filtrem o poprawnym identyfikatorze", () => {
    render(<Switch aria-label="Filtr" />);
    const toggle = screen.getByRole("switch", { name: "Filtr" });
    const svg = toggle.querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).toHaveClass("pointer-events-none");
    expect(svg?.style.fill).toBe("var(--to-toggle-thumb, #ffffff)");
    const filter = toggle.querySelector("filter");
    const id = filter?.getAttribute("id") ?? "";
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
    expect(svg).toHaveAttribute("filter", `url(#${id})`);
    expect(toggle.querySelectorAll("circle")).toHaveLength(3);
  });

  it("nadaje każdej instancji osobny filtr, żeby przełączniki nie dzieliły stanu wizualnego", () => {
    render(
      <>
        <Switch aria-label="Pierwszy" />
        <Switch aria-label="Drugi" />
      </>,
    );
    const ids = screen
      .getAllByRole("switch")
      .map((toggle) => toggle.querySelector("filter")?.getAttribute("id"));
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
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
