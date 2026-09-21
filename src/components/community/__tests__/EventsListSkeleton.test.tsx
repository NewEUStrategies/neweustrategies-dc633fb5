// Szkielet listy wydarzeń - `pendingComponent` trasy `/events`.
//
// PO CO TEN PLIK ISTNIEJE. Szkielet nie ma treści, więc „czy się wyrenderował"
// nie jest tu żadnym dowodem - wyrenderuje się także wtedy, gdy przestanie
// robić to, po co powstał. Przedmiotem dowodu są trzy rzeczy, których zepsucie
// jest CICHE:
//
//   1. DEKORACYJNOŚĆ. Szkielet stoi na ekranie w trakcie nawigacji i nie niesie
//      żadnej informacji. Bez `aria-hidden` czytnik ekranu przechodzi przez
//      kilkanaście pustych kafli, a nawigację i tak ogłasza `RouteProgress` -
//      użytkownik dostaje więc szum zamiast komunikatu. Sprawdzamy też, że
//      w środku NIE MA ani jednego znaku tekstu i ani jednej kontrolki:
//      dopisany później napis „Ładowanie…" byłby napisem UKRYTYM przed
//      czytnikiem, czyli gorszym niż jego brak.
//   2. LICZBA KAFLI JEST STEROWANA PROPSEM. Domyślne cztery to kształt pierwszego
//      ekranu listy; `count` jest po to, żeby ten sam szkielet obsłużył krótszą
//      sekcję. Pętla `Array.from({ length: count })` przy złym propsie nie rzuca
//      wyjątku - po prostu rysuje inny ekran.
//   3. PARYTET KSZTAŁTU Z PRAWDZIWĄ LISTĄ. Szkielet ma sens tylko wtedy, gdy
//      treść wskakuje w TO SAMO miejsce; siatka rozjechana z siatką strony daje
//      przeskok układu w chwili, w której użytkownik już patrzy. Klasy siatki
//      i kontenera są więc porównywane ZE ŹRÓDŁEM TRASY, a nie przepisane tutaj
//      z pamięci - inaczej test przechodziłby dokładnie po tej zmianie, która
//      psuje rzecz pilnowaną.
//
// GRANICA DOWODU. Nie sprawdzamy animacji (`skeleton-shimmer` to klasa CSS,
// happy-dom nie liczy klatek) ani tego, że trasa faktycznie podpina ten
// komponent jako `pendingComponent` - to jest w teście trasy. Kontrastu barw
// axe tu nie mierzy (patrz `@/test/axe`).
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { axeViolations, summarize } from "@/test/axe";
import { EventsListSkeleton } from "../EventsListSkeleton";

const ROUTE_SOURCE = readFileSync("src/routes/events.index.tsx", "utf8");

afterEach(() => {
  cleanup();
});

describe("dekoracyjność", () => {
  it("cały blok jest ukryty przed technologią asystującą", () => {
    const { container } = render(<EventsListSkeleton />);
    const root = container.firstElementChild;
    expect(root).not.toBeNull();
    expect(root).toHaveAttribute("aria-hidden", "true");
  });

  it("nie ma w środku ANI JEDNEGO znaku tekstu i żadnej kontrolki", () => {
    const { container } = render(<EventsListSkeleton />);
    // Napis w bloku `aria-hidden` jest napisem, którego nikt nie usłyszy,
    // a mimo to zajmuje miejsce w układzie i trafia do zrzutu ekranu.
    expect((container.textContent ?? "").trim()).toBe("");
    expect(container.querySelectorAll("button, a, input, [tabindex]").length).toBe(0);
    expect(container.querySelectorAll("img").length).toBe(0);
  });

  it("nie wnosi naruszeń dostępności", async () => {
    const { container } = render(<EventsListSkeleton />);
    const violations = await axeViolations(container);
    expect(violations, summarize(violations)).toEqual([]);
  });
});

describe("liczba kafli", () => {
  it("bez propsa rysuje cztery karty - kształt pierwszego ekranu listy", () => {
    const { container } = render(<EventsListSkeleton />);
    expect(container.querySelectorAll("ul > li").length).toBe(4);
  });

  it("respektuje `count` i dla zera nie zostawia sierocej siatki z kaflem", () => {
    const { container: three } = render(<EventsListSkeleton count={3} />);
    expect(three.querySelectorAll("ul > li").length).toBe(3);
    cleanup();

    const { container: none } = render(<EventsListSkeleton count={0} />);
    expect(none.querySelectorAll("ul > li").length).toBe(0);
    // Sama siatka zostaje - to nadal jest szkielet nagłówka strony.
    expect(none.querySelector("ul")).not.toBeNull();
  });

  it("każdy kafel ma okładkę w proporcji wideo i trzy paski tekstu", () => {
    const { container } = render(<EventsListSkeleton count={2} />);
    const cards = Array.from(container.querySelectorAll("ul > li"));
    expect(cards.length).toBe(2);
    for (const card of cards) {
      expect(card.querySelector(".aspect-video")).not.toBeNull();
      // Trzy paski = data, tytuł, lead - dokładnie tyle linii ma kafel treści.
      expect(card.querySelectorAll(".skeleton-shimmer.rounded").length).toBe(3);
    }
  });
});

describe("parytet kształtu z listą wydarzeń", () => {
  it("siatka kart jest TĄ SAMĄ siatką, co siatka listy na trasie /events", () => {
    // Klasa wyjęta ze źródła trasy, nie przepisana: zmiana `md:grid-cols-2` na
    // trzy kolumny w jednym z dwóch miejsc daje przeskok układu po dociągnięciu
    // danych i jest tu czerwona, zamiast wyjść dopiero na produkcji.
    const routeGrid = /<ul className="(grid[^"]*)"/.exec(ROUTE_SOURCE)?.[1];
    expect(routeGrid, "trasa /events musi mieć listę w siatce").toBeDefined();
    const { container } = render(<EventsListSkeleton />);
    expect(container.querySelector("ul")?.getAttribute("class")).toBe(routeGrid);
  });

  it("kontener ma tę samą szerokość i te same marginesy, co strona listy", () => {
    const routeContainer = /<div className="(container mx-auto[^"]*)"/.exec(ROUTE_SOURCE)?.[1];
    expect(routeContainer, "trasa /events musi mieć kontener treści").toBeDefined();
    const { container } = render(<EventsListSkeleton />);
    expect(container.firstElementChild?.getAttribute("class")).toBe(routeContainer);
  });
});
