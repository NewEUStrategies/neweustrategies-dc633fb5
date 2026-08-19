// Regresja: każdy rodzaj wątku ma WŁASNY kształt ikony (żeby dyskusji nie dało
// się pomylić z sondażem bez czytania etykiety), a ikona własna wątku ma
// pierwszeństwo nad ikoną rodzaju.
//
// CO DOWODZI (warstwa druga, dopisana razem z testami atomów ikon):
// (1) Mapowanie rodzaj -> KONKRETNY komponent lucide, a nie tylko „siedem
//     różnych obiektów”: `Record<string, LucideIcon>` przepuszcza podmianę
//     `Vote` na `MessagesSquare` bez mrugnięcia, a wtedy sondaż wygląda jak
//     zwykła dyskusja. Asercja idzie na TOŻSAMOŚĆ komponentu (`toBe(Vote)`),
//     więc nie zna nazw klas lucide na pamięć.
// (2) Komponent `ClubThreadKindIcon`: pierwszeństwo ikony własnej wątku,
//     degradacja ikony własnej złożonej z samych spacji do kształtu rodzaju
//     (bo `"   "` w kolumnie `icon` to brak wyboru, nie wybór), oraz to, że
//     ikona własna ma TEN SAM box 14 px co ikona rodzaju - inaczej wiersz listy
//     tematów podskakuje w zależności od tego, czy prowadzenie wybrało ikonę.
// (3) `aria-hidden` na obu ścieżkach - obok ikony zawsze stoi etykieta rodzaju.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE:
// - `DynamicIcon` (rozwiązywanie nazw kebab/Pascal, doładowanie pełnego
//   rejestru lucide dla nazw poza zestawem bazowym) - to osobny moduł; tutaj
//   ikona własna jest podana nazwą z zestawu bazowego, żeby test nie mierzył
//   asynchronicznego `lazy()` cudzego modułu.
// - Rozjazd między `className` a wymuszonym `size={14}` na ścieżce ikony
//   własnej: WSZYSCY trzej wywołujący (`ClubFeedItem`, `ClubThreadList`, trasa
//   wątku) używają domyślnego `className="h-3.5 w-3.5"`, czyli dokładnie 14 px,
//   więc test nie zaklina zachowania dla nadpisania, którego produkt nie robi.
// - Awatary i ikony wpisów przestrzeni roboczej - `clubAtomIcons.test.tsx`.
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { render } from "@testing-library/react";
import {
  Gavel,
  HelpCircle,
  Library,
  Megaphone,
  MessagesSquare,
  ScrollText,
  Star,
  Vote,
  type LucideIcon,
} from "lucide-react";
import {
  ClubThreadKindIcon,
  clubThreadKindIcon,
} from "@/components/clubs/atoms/ClubThreadKindIcon";

/** Odcisk kształtu: klasy `lucide-*` z wyrenderowanego SVG. */
function shapeOf(container: HTMLElement): string {
  const svg = container.querySelector("svg");
  if (svg === null) throw new Error("render ikony nie zawiera SVG");
  const shape = (svg.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter((name) => name.startsWith("lucide-"));
  expect(shape.length, "SVG musi nieść klasę kształtu lucide").toBeGreaterThan(0);
  return shape.join(" ");
}

/** Kształt ikony wzorcowej wprost z lucide - wzorzec porównania. */
function shapeOfLucide(Icon: LucideIcon): string {
  const view = render(createElement(Icon));
  const shape = shapeOf(view.container);
  view.unmount();
  return shape;
}

/** Jedyny <svg> renderu - atom nie ma prawa dać zera ani dwóch ikon. */
function svgOf(container: HTMLElement): SVGSVGElement {
  expect(container.querySelectorAll("svg"), "dokładnie jedna ikona").toHaveLength(1);
  const svg = container.querySelector("svg");
  if (svg === null) throw new Error("render ikony nie zawiera SVG");
  return svg;
}

describe("clubThreadKindIcon", () => {
  it("daje różne ikony różnym rodzajom", () => {
    const kinds = ["discussion", "question", "position", "resource", "announcement", "poll"];
    const icons = kinds.map((k) => clubThreadKindIcon(k));
    expect(new Set(icons).size).toBe(kinds.length);
  });

  it("nieznany rodzaj degraduje się do dymka, nie wywraca listy", () => {
    expect(clubThreadKindIcon("legacy")).toBe(clubThreadKindIcon("discussion"));
    expect(clubThreadKindIcon(null)).toBe(clubThreadKindIcon(undefined));
  });

  it.each([
    { kind: "discussion", icon: MessagesSquare },
    { kind: "question", icon: HelpCircle },
    { kind: "position", icon: Gavel },
    { kind: "resource", icon: Library },
    { kind: "announcement", icon: Megaphone },
    { kind: "poll", icon: Vote },
    { kind: "post", icon: ScrollText },
  ])("rodzaj $kind dostaje przypisany mu komponent ikony", ({ kind, icon }) => {
    expect(clubThreadKindIcon(kind)).toBe(icon);
  });

  it("`post` ma własny kształt - wpis autorski to nie to samo co dyskusja", () => {
    // Rodzaj `post` doszedł później niż pierwsza szóstka i najłatwiej było go
    // zostawić na domyślnym dymku; wtedy strumień pokazywałby wpisy autorskie
    // jako wątki dyskusyjne.
    expect(clubThreadKindIcon("post")).not.toBe(clubThreadKindIcon("discussion"));
  });

  it.each([
    { label: "pusty napis", kind: "" },
    { label: "spacje", kind: "   " },
    { label: "inna wielkość liter", kind: "Poll" },
    { label: "rodzaj z nowszej migracji", kind: "hearing" },
  ])("$label to nie rodzaj ze słownika - wraca dymek dyskusji", ({ kind }) => {
    expect(clubThreadKindIcon(kind)).toBe(MessagesSquare);
  });

  it("brak rodzaju (null/undefined) wraca dymkiem, a nie wyjątkiem", () => {
    expect(clubThreadKindIcon(null)).toBe(MessagesSquare);
    expect(clubThreadKindIcon(undefined)).toBe(MessagesSquare);
  });
});

describe("ClubThreadKindIcon", () => {
  it.each([
    { kind: "discussion", icon: MessagesSquare },
    { kind: "poll", icon: Vote },
    { kind: "post", icon: ScrollText },
  ])("bez ikony własnej wątek rodzaju $kind rysuje kształt rodzaju", ({ kind, icon }) => {
    const { container } = render(createElement(ClubThreadKindIcon, { kind }));
    expect(shapeOf(container)).toBe(shapeOfLucide(icon));
  });

  it("nieznany rodzaj bez ikony własnej rysuje dymek, nie pustkę", () => {
    const { container } = render(createElement(ClubThreadKindIcon, { kind: "hearing" }));
    expect(shapeOf(container)).toBe(shapeOfLucide(MessagesSquare));
  });

  it("brak rodzaju (null) też rysuje dymek", () => {
    const { container } = render(createElement(ClubThreadKindIcon, { kind: null }));
    expect(shapeOf(container)).toBe(shapeOfLucide(MessagesSquare));
  });

  it("ikona własna wątku WYPIERA kształt rodzaju", () => {
    // To jest reguła z nagłówka atomu: wybór prowadzenia (kolumna `icon`) ma
    // pierwszeństwo, a rodzaj jest dopiero zapasem.
    const { container } = render(createElement(ClubThreadKindIcon, { kind: "poll", icon: "star" }));
    expect(shapeOf(container)).toBe(shapeOfLucide(Star));
    expect(shapeOf(container)).not.toBe(shapeOfLucide(Vote));
  });

  it("ikona własna ma ten sam box 14 px co ikona rodzaju - wiersz nie skacze", () => {
    const { container } = render(createElement(ClubThreadKindIcon, { kind: "poll", icon: "star" }));
    const svg = svgOf(container);
    expect(svg.getAttribute("width")).toBe("14");
    expect(svg.getAttribute("height")).toBe("14");
  });

  it.each([
    { label: "null (kolumna pusta w bazie)", icon: null },
    { label: "undefined (prop nieprzekazany wprost)", icon: undefined },
    { label: "pusty napis", icon: "" },
    { label: "same spacje - brak wyboru, nie wybór", icon: "   " },
  ])("ikona własna: $label degraduje się do kształtu rodzaju", ({ icon }) => {
    const { container } = render(createElement(ClubThreadKindIcon, { kind: "poll", icon }));
    expect(shapeOf(container)).toBe(shapeOfLucide(Vote));
  });

  it("bez propsa `icon` wchodzi ta sama ścieżka rodzaju", () => {
    const { container } = render(createElement(ClubThreadKindIcon, { kind: "resource" }));
    expect(shapeOf(container)).toBe(shapeOfLucide(Library));
  });

  it("bez propsa `className` ikona rodzaju ma 14 px w klasach Tailwinda", () => {
    const { container } = render(createElement(ClubThreadKindIcon, { kind: "question" }));
    expect(svgOf(container).getAttribute("class")).toContain("h-3.5 w-3.5");
  });

  it("`className` nadpisuje rozmiar ikony rodzaju", () => {
    const { container } = render(
      createElement(ClubThreadKindIcon, { kind: "question", className: "h-5 w-5" }),
    );
    const className = svgOf(container).getAttribute("class") ?? "";
    expect(className).toContain("h-5 w-5");
    expect(className).not.toContain("h-3.5 w-3.5");
  });

  it.each([
    { label: "kształt rodzaju", props: { kind: "poll" } },
    { label: "ikona własna", props: { kind: "poll", icon: "star" } },
  ])("ikona jest `aria-hidden` ($label) - etykieta rodzaju stoi obok", ({ props }) => {
    const { container } = render(createElement(ClubThreadKindIcon, props));
    expect(svgOf(container).getAttribute("aria-hidden")).toBe("true");
  });
});
