// Karta to rodzina sześciu kontenerów. Kontrakt: tło i kolor tekstu idą
// z par tokenów `bg-card` / `text-card-foreground` (jedno źródło prawdy dla
// jasnego i ciemnego motywu), każdy element przyjmuje klasę wywołującego
// i przekazuje ref do węzła DOM.
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "../card";

afterEach(cleanup);

describe("Card", () => {
  it("składa nagłówek, opis, treść i stopkę w jednej karcie w kolejności dokumentu", () => {
    render(
      <Card data-testid="karta">
        <CardHeader data-testid="naglowek">
          <CardTitle>Raport kwartalny</CardTitle>
          <CardDescription>Dane za III kwartał</CardDescription>
        </CardHeader>
        <CardContent data-testid="tresc">Treść raportu</CardContent>
        <CardFooter data-testid="stopka">Stopka</CardFooter>
      </Card>,
    );
    const card = screen.getByTestId("karta");
    expect(card).toHaveClass("rounded-xl", "border", "bg-card", "text-card-foreground", "shadow");
    expect(Array.from(card.children).map((c) => c.getAttribute("data-testid"))).toEqual([
      "naglowek",
      "tresc",
      "stopka",
    ]);
    expect(screen.getByTestId("naglowek")).toHaveClass("flex", "flex-col", "p-6");
    expect(screen.getByText("Raport kwartalny")).toHaveClass("font-semibold", "tracking-tight");
    expect(screen.getByText("Dane za III kwartał")).toHaveClass("text-muted-foreground");
    expect(screen.getByTestId("tresc")).toHaveClass("p-6", "pt-0");
    expect(screen.getByTestId("stopka")).toHaveClass("flex", "items-center", "p-6", "pt-0");
  });

  it("scala klasę wywołującego z klasą bazową, a sprzeczną wartość rozstrzyga na korzyść wywołującego", () => {
    render(
      <Card data-testid="karta" className="rounded-none shadow-none">
        <CardContent data-testid="tresc" className="p-2">
          x
        </CardContent>
      </Card>,
    );
    const card = screen.getByTestId("karta");
    expect(card).toHaveClass("rounded-none", "shadow-none", "bg-card");
    expect(card).not.toHaveClass("rounded-xl");
    const content = screen.getByTestId("tresc");
    expect(content).toHaveClass("p-2");
    expect(content).not.toHaveClass("p-6");
    expect(content).not.toHaveClass("pt-0");
  });

  it("przekazuje ref każdego elementu do jego węzła DOM", () => {
    const refs = {
      card: createRef<HTMLDivElement>(),
      header: createRef<HTMLDivElement>(),
      title: createRef<HTMLDivElement>(),
      description: createRef<HTMLDivElement>(),
      content: createRef<HTMLDivElement>(),
      footer: createRef<HTMLDivElement>(),
    };
    render(
      <Card ref={refs.card}>
        <CardHeader ref={refs.header}>
          <CardTitle ref={refs.title}>T</CardTitle>
          <CardDescription ref={refs.description}>D</CardDescription>
        </CardHeader>
        <CardContent ref={refs.content}>C</CardContent>
        <CardFooter ref={refs.footer}>F</CardFooter>
      </Card>,
    );
    for (const ref of Object.values(refs)) {
      expect(ref.current).toBeInstanceOf(HTMLDivElement);
    }
    expect(refs.title.current).toHaveTextContent("T");
    expect(refs.footer.current).toHaveTextContent("F");
  });

  it("przenosi atrybuty dostępności na kartę, żeby mogła pełnić rolę regionu", () => {
    render(
      <Card role="region" aria-labelledby="tytul-karty">
        <CardTitle id="tytul-karty">Podsumowanie</CardTitle>
      </Card>,
    );
    expect(screen.getByRole("region", { name: "Podsumowanie" })).toBeInTheDocument();
  });
});
