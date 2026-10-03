// Avatar pokazuje zdjęcie dopiero, gdy przeglądarka je wczyta, a do tego czasu
// (i po błędzie) zastępczy inicjał na tle `bg-muted` - tokenie wspólnym dla
// jasnego i ciemnego motywu. Dzięki temu nie ma ani pustego kółka, ani
// ikony zepsutego obrazka.
//
// DLACZEGO PODMIENIAM `Image`. Radix sprawdza wczytanie przez `new Image()`
// i pola `complete` / `naturalWidth`, a happy-dom nie dekoduje obrazków (każdy
// kończy jako błąd). Atrapa udaje WYŁĄCZNIE dekoder przeglądarki - prymityw
// Radiksa i opakowanie zostają prawdziwe. Przywracana w `afterEach`.
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { Avatar, AvatarFallback, AvatarImage } from "../avatar";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function stubDecodedImages() {
  const Native = window.Image;
  class DecodedImage extends Native {
    get complete() {
      return true;
    }
    get naturalWidth() {
      return 64;
    }
  }
  vi.stubGlobal("Image", DecodedImage);
}

describe("Avatar", () => {
  it("pokazuje okrągły kontener z inicjałami, gdy zdjęcie się nie wczytało", () => {
    render(
      <Avatar data-testid="avatar">
        <AvatarImage src="https://example.test/brak.png" alt="Anna Nowak" />
        <AvatarFallback>AN</AvatarFallback>
      </Avatar>,
    );
    const root = screen.getByTestId("avatar");
    expect(root.tagName).toBe("SPAN");
    expect(root).toHaveClass("relative", "flex", "h-10", "w-10", "rounded-full", "overflow-hidden");
    expect(screen.queryByRole("img")).toBeNull();
    const fallback = screen.getByText("AN");
    expect(fallback).toHaveClass("bg-muted", "rounded-full", "items-center", "justify-center");
  });

  it("po wczytaniu pokazuje zdjęcie z tekstem alternatywnym i chowa inicjały", () => {
    stubDecodedImages();
    const imageRef = createRef<HTMLImageElement>();
    render(
      <Avatar>
        <AvatarImage ref={imageRef} src="https://example.test/anna.png" alt="Anna Nowak" />
        <AvatarFallback>AN</AvatarFallback>
      </Avatar>,
    );
    const image = screen.getByRole("img", { name: "Anna Nowak" });
    expect(image).toHaveAttribute("src", "https://example.test/anna.png");
    expect(image).toHaveClass("aspect-square", "h-full", "w-full");
    expect(imageRef.current).toBe(image);
    expect(screen.queryByText("AN")).toBeNull();
  });

  it("bez adresu zdjęcia od razu pokazuje inicjały", () => {
    render(
      <Avatar>
        <AvatarImage alt="Bez zdjęcia" />
        <AvatarFallback>BZ</AvatarFallback>
      </Avatar>,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("BZ")).toBeInTheDocument();
  });

  it("z opóźnieniem nie mruga inicjałami, zanim zdjęcie zdąży się wczytać", () => {
    vi.useFakeTimers();
    render(
      <Avatar>
        <AvatarFallback delayMs={300}>OP</AvatarFallback>
      </Avatar>,
    );
    expect(screen.queryByText("OP")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(screen.getByText("OP")).toBeInTheDocument();
  });

  it("scala klasy wywołującego na korzeniu i zastępstwie oraz przekazuje ref korzenia", () => {
    const rootRef = createRef<HTMLSpanElement>();
    const fallbackRef = createRef<HTMLSpanElement>();
    render(
      <Avatar ref={rootRef} className="h-16 w-16">
        <AvatarFallback ref={fallbackRef} className="bg-primary text-primary-foreground">
          XL
        </AvatarFallback>
      </Avatar>,
    );
    expect(rootRef.current).toHaveClass("h-16", "w-16", "rounded-full");
    expect(rootRef.current).not.toHaveClass("h-10");
    expect(fallbackRef.current).toHaveClass("bg-primary", "text-primary-foreground");
    expect(fallbackRef.current).not.toHaveClass("bg-muted");
  });
});
