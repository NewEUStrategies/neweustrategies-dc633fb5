// Button to kontrolka, z której składa się większość interfejsu. Kontrakt
// motywu: każdy wariant bierze kolor wyłącznie z par tokenów (`bg-primary` /
// `text-primary-foreground` itd.), które zmieniają wartość w jasnym i ciemnym
// motywie, więc test pilnuje, że KAŻDY wariant i KAŻDY rozmiar dostaje swoje
// klasy, a nie surowy kolor. Do tego gałąź `asChild` (Slot) i cel dotykowy
// 44 px (`pointer-coarse:min-h-11`) na każdym rozmiarze.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button, buttonVariants } from "../button";

afterEach(cleanup);

const VARIANTS = [
  ["default", ["bg-primary", "text-primary-foreground", "hover:bg-primary/90"]],
  ["destructive", ["bg-destructive", "text-destructive-foreground", "hover:bg-destructive/90"]],
  ["outline", ["border", "border-input", "bg-background", "hover:bg-accent"]],
  ["secondary", ["bg-secondary", "text-secondary-foreground", "hover:bg-secondary/80"]],
  ["ghost", ["hover:bg-accent", "hover:text-accent-foreground"]],
  ["link", ["text-primary", "underline-offset-4", "hover:underline"]],
] as const;

const SIZES = [
  ["default", ["h-8", "px-3", "pointer-coarse:min-h-11"]],
  ["sm", ["h-7", "px-2.5", "text-xs", "pointer-coarse:min-h-11"]],
  ["lg", ["h-9", "px-6", "pointer-coarse:min-h-11"]],
  ["icon", ["h-8", "w-8", "pointer-coarse:min-h-11", "pointer-coarse:min-w-11"]],
] as const;

describe("Button", () => {
  it("renderuje natywny przycisk z wariantem i rozmiarem domyślnym", () => {
    render(<Button>Zapisz</Button>);
    const button = screen.getByRole("button", { name: "Zapisz" });
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveAttribute("data-slot", "button");
    expect(button).toHaveClass(
      "bg-primary",
      "text-primary-foreground",
      "h-8",
      "focus-visible:ring-2",
      "focus-visible:ring-ring",
    );
  });

  it.each(VARIANTS)("wariant %s bierze kolory z tokenów motywu", (variant, classes) => {
    render(<Button variant={variant}>Akcja</Button>);
    expect(screen.getByRole("button", { name: "Akcja" })).toHaveClass(...classes);
  });

  it("nie miesza tła wariantu wypełnionego z wariantem przezroczystym", () => {
    render(
      <>
        <Button variant="ghost">Duch</Button>
        <Button variant="link">Link</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Duch" })).not.toHaveClass("bg-primary");
    expect(screen.getByRole("button", { name: "Link" })).not.toHaveClass("bg-primary");
  });

  it.each(SIZES)("rozmiar %s spełnia cel dotykowy 44 px na ekranie dotykowym", (size, classes) => {
    render(
      <Button size={size} aria-label="Przycisk">
        x
      </Button>,
    );
    expect(screen.getByRole("button", { name: "Przycisk" })).toHaveClass(...classes);
  });

  it("z asChild przenosi klasy na dziecko zamiast zagnieżdżać przycisk w linku", () => {
    render(
      <Button asChild variant="outline" size="lg">
        <a href="/wydarzenia">Wydarzenia</a>
      </Button>,
    );
    const link = screen.getByRole("link", { name: "Wydarzenia" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/wydarzenia");
    expect(link).toHaveAttribute("data-slot", "button");
    expect(link).toHaveClass("border-input", "bg-background", "h-9");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("wywołuje handler kliknięcia i przyjmuje ognisko przez ref", () => {
    const onClick = vi.fn();
    const ref = createRef<HTMLButtonElement>();
    render(
      <Button ref={ref} onClick={onClick}>
        Wyślij
      </Button>,
    );
    ref.current?.focus();
    const button = screen.getByRole("button", { name: "Wyślij" });
    expect(button).toHaveFocus();
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("w stanie wyłączonym blokuje kliknięcie i niesie klasy przygaszenia", () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Niedostępne
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Niedostępne" });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
    expect(button).toHaveClass("disabled:pointer-events-none", "disabled:opacity-50");
  });

  it("scala klasę wywołującego z klasą wariantu, rozstrzygając konflikt na korzyść wywołującego", () => {
    render(<Button className="h-12 rounded-full">Duży</Button>);
    const button = screen.getByRole("button", { name: "Duży" });
    expect(button).toHaveClass("h-12", "rounded-full", "bg-primary");
    expect(button).not.toHaveClass("h-8");
    expect(button).not.toHaveClass("rounded-md");
  });

  it("udostępnia funkcję wariantów innym prymitywom, np. akcjom okna dialogowego", () => {
    const classes = buttonVariants({ variant: "destructive", size: "sm" }).split(" ");
    expect(classes).toEqual(expect.arrayContaining(["bg-destructive", "h-7", "text-xs"]));
    expect(buttonVariants().split(" ")).toEqual(expect.arrayContaining(["bg-primary", "h-8"]));
  });
});
