// Typografia treści klubowej.
//
// CO PILNUJE.
// (1) AKAPIT JEST JEDNOSTKĄ: pusta linia rozdziela, pojedyncze złamanie
//     zostaje w środku (`splitParagraphs`).
// (2) WOŁACZ PORZĄDKUJĄCY pisany wersalikami dostaje wyróżnienie śródtytułu
//     (`isLeadIn`) - to autorski nagłówek, którego edytor nie oferuje. Strażnik
//     musi być WĄSKI: normalne zdanie z dwukropkiem, długi akapit, sama
//     numeracja i wersaliki bez dwukropka NIE są śródtytułami, bo inaczej pół
//     wątku pogrubia się samo.
// (3) WYLICZENIE MA WŁASNY ELEMENT. `ClubProse` rysuje `<ol>`/`<ul>` z numerem
//     w kółku i punktorem jako węzłami OZDOBNYMI (`aria-hidden`), bo numer
//     czytany przez czytnik ekranu dubluje strukturę listy. Numeracja startuje
//     od liczby, którą napisał autor („3.” nie zamienia się w „1.”).
// (4) GĘSTOŚĆ (`size`) DOTYCZY CAŁEGO BLOKU, nie tylko akapitów: odpowiedź
//     (`sm`) ma ciaśniejszą listę i mniejszy stopień pisma niż post otwierający
//     (`base`). Rozjazd tych dwóch skal daje odpowiedź wyglądającą jak post.
// (5) KONTEKST KLUBU DOCHODZI DO KAŻDEGO BLOKU. `clubSlug` musi zostać
//     przekazany do treści inline akapitu, pozycji listy numerowanej I pozycji
//     listy punktowanej - zapomniany w jednym z trzech miejsc daje tag, który
//     w akapicie jest filtrem, a w wyliczeniu martwą etykietą.
//
// CZEGO ŚWIADOMIE NIE DUBLUJE.
// (a) REGUŁ PARSERA BLOKÓW. Granice list, mieszanie punktorów, puste linie
//     wewnątrz listy - to `parseProseBlocks` i jego własna suita
//     (`src/lib/clubs/__tests__/`). Tutaj wchodzą tylko wejścia prowadzące do
//     RÓŻNYCH elementów DOM.
// (b) SEGMENTÓW INLINE. Bezpieczeństwo linku UGC, leniwość dymków, wizytówka
//     wzmianki i degradacja tagu bez kontekstu klubu to
//     `clubInlineText.test.tsx`. Tag pojawia się tutaj wyłącznie jako SONDA
//     przekazania `clubSlug` przez trzy rodzaje bloków - dlatego treści
//     testowe nie zawierają adresów ani wzmianek (nie o nich jest ten plik).
// (c) `body: null | undefined` - sygnatura wymaga `string`, a reguły
//     repozytorium zabraniają rzutowania; pustą treść pokrywa przypadek `"   "`.
// (d) `size`/`clubSlug` spoza unii - ten sam powód.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Tag w kontekście klubu jest linkiem TanStack Router, a `<Link>` bez
// `RouterProvider` rzuca - stąd wspólna atrapa zwykłego `<a>`.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: (await import("@/test/routerLinkStub")).RouterLinkStub,
}));

import { ClubProse, isLeadIn, splitParagraphs } from "@/components/clubs/atoms/ClubProse";

/** Kontener treści - identyfikowany po `data-testid`, nie po strukturze. */
function prose(): HTMLElement {
  return screen.getByTestId("club-prose");
}

describe("splitParagraphs", () => {
  it("dzieli po pustej linii i przycina białe znaki", () => {
    expect(splitParagraphs("Pierwszy\n\n  Drugi  \n\n\nTrzeci")).toEqual([
      "Pierwszy",
      "Drugi",
      "Trzeci",
    ]);
  });

  it("pojedyncze złamanie zostaje wewnątrz akapitu", () => {
    expect(splitParagraphs("Punkt 1\nPunkt 2")).toEqual(["Punkt 1\nPunkt 2"]);
  });

  it("normalizuje złamania CRLF przed podziałem", () => {
    expect(splitParagraphs("Pierwszy\r\n\r\nDrugi")).toEqual(["Pierwszy", "Drugi"]);
  });

  it("pusta treść nie produkuje pustych akapitów", () => {
    expect(splitParagraphs("\n\n   \n")).toEqual([]);
  });
});

describe("isLeadIn", () => {
  it("rozpoznaje wołacz wersalikami", () => {
    expect(isLeadIn("PO PIERWSZE: korytarz nie ma finansowania.")).toBe(true);
  });

  it("zwykłe zdanie z dwukropkiem nie jest śródtytułem", () => {
    expect(isLeadIn("Komisja stwierdziła: brak danych o ruchu towarowym.")).toBe(false);
  });

  it("akapit bez dwukropka nigdy nie jest śródtytułem", () => {
    expect(isLeadIn("WNIOSEK KOŃCOWY")).toBe(false);
  });

  /**
   * Granice strażnika. Każdy wiersz to inna gałąź: długość akapitu, brak
   * dwukropka, puste wołanie, zbyt długie wołanie i wołanie bez ani jednej
   * litery. Wszystkie muszą kończyć się odmową, bo pogrubienie jest sygnałem
   * struktury i nie wolno go rozdawać przypadkiem.
   */
  it.each([
    [
      "akapit dłuższy niż 64 znaki",
      "WNIOSEK: ten akapit jest zdecydowanie zbyt długi, aby uchodzić za śródtytuł autorski.",
    ],
    ["dwukropek na samym początku", ": bez wołacza"],
    ["wołacz dłuższy niż 48 znaków", "TO JEST BARDZO DŁUGIE WOŁANIE PORZĄDKUJĄCE BEZ SENSU: tak"],
    ["wołacz bez litery", "1234567890: dane"],
    ["wołacz małymi literami", "wniosek: brak danych"],
  ])("%s nie jest śródtytułem", (_nazwa, paragraph) => {
    expect(isLeadIn(paragraph)).toBe(false);
  });

  it("wołacz z polskimi znakami diakrytycznymi liczy się jako wersaliki", () => {
    expect(isLeadIn("ŹRÓDŁA: raport Komisji.")).toBe(true);
  });
});

describe("ClubProse - akapity", () => {
  it("renderuje jeden <p> na akapit", () => {
    const { container } = render(<ClubProse body={"Alfa\n\nBeta"} />);
    expect(container.querySelectorAll("p")).toHaveLength(2);
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("pusta treść nie renderuje kontenera", () => {
    const { container } = render(<ClubProse body="   " />);
    expect(container.firstChild).toBeNull();
  });

  it("wyróżnia śródtytuł autorski, a zwykłego akapitu nie rusza", () => {
    render(<ClubProse body={"PO PIERWSZE: brak finansowania.\n\nZwykły akapit bez wołacza."} />);
    const paragraphs = prose().querySelectorAll("p");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].getAttribute("class")).toContain("font-medium");
    expect(paragraphs[1].getAttribute("class")).not.toContain("font-medium");
  });

  it("dokłada klasę wywołującego do kontenera treści", () => {
    render(<ClubProse body="Alfa" className="mt-6" />);
    expect(prose().classList.contains("mt-6")).toBe(true);
  });
});

describe("ClubProse - wyliczenia", () => {
  it("listę numerowaną rysuje jako <ol> z numerem autora i numerami ozdobnymi", () => {
    render(<ClubProse body={"3. Trzeci argument\n4. Czwarty argument"} />);
    const list = screen.getByTestId("club-prose-ordered");
    expect(list.tagName).toBe("OL");
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(2);
    const markers = Array.from(list.querySelectorAll('span[aria-hidden="true"]')).map(
      (node) => node.textContent,
    );
    // Numeracja startuje od liczby, którą napisał autor.
    expect(markers).toEqual(["3", "4"]);
    expect(screen.getByText("Trzeci argument")).toBeInTheDocument();
  });

  it("listę punktowaną rysuje jako <ul> z punktorem ozdobnym bez treści", () => {
    render(<ClubProse body={"- Pierwszy\n- Drugi\n- Trzeci"} />);
    const list = screen.getByTestId("club-prose-bullet");
    expect(list.tagName).toBe("UL");
    expect(list.querySelectorAll("li")).toHaveLength(3);
    const markers = list.querySelectorAll('span[aria-hidden="true"]');
    expect(markers).toHaveLength(3);
    expect(Array.from(markers).every((node) => node.textContent === "")).toBe(true);
  });

  it("zachowuje kolejność bloków: akapit, wyliczenie, akapit", () => {
    render(<ClubProse body={"Wstęp\n\n1. Punkt\n\nZakończenie"} />);
    const children = Array.from(prose().children).map((node) => node.tagName);
    expect(children).toEqual(["P", "OL", "P"]);
  });
});

describe("ClubProse - gęstość zależna od `size`", () => {
  it("post otwierający (domyślne `base`) ma większy stopień pisma i luźniejszą listę", () => {
    render(<ClubProse body={"Wstęp\n\n- Punkt"} />);
    expect(prose().getAttribute("class")).toContain("text-[15px]");
    expect(screen.getByTestId("club-prose-bullet").getAttribute("class")).toContain("space-y-2");
  });

  it("odpowiedź (`sm`) zagęszcza kontener, listę i znacznik numeru", () => {
    render(<ClubProse body={"Wstęp\n\n1. Punkt"} size="sm" />);
    expect(prose().getAttribute("class")).toContain("text-sm");
    const list = screen.getByTestId("club-prose-ordered");
    expect(list.getAttribute("class")).toContain("space-y-1.5");
    const marker = list.querySelector('span[aria-hidden="true"]');
    expect(marker?.getAttribute("class")).toContain("text-[11px]");
  });

  it("gęstość odpowiedzi zmniejsza także punktor listy punktowanej", () => {
    render(<ClubProse body="- Punkt" size="sm" />);
    const marker = screen
      .getByTestId("club-prose-bullet")
      .querySelector('span[aria-hidden="true"]');
    expect(marker?.getAttribute("class")).toContain("mt-[9px]");
  });
});

describe("ClubProse - kontekst klubu w każdym rodzaju bloku", () => {
  const BODY = "Kontekst #Energia w akapicie.\n\n1. Pozycja #Energia\n\n- Punkt #Energia";

  it("z `clubSlug` każdy tag - także w wyliczeniach - jest linkiem filtra strumienia", () => {
    const { container } = render(<ClubProse body={BODY} clubSlug="rada-energetyczna" />);
    const tags = Array.from(container.querySelectorAll("a[data-club-tag]"));
    // Akapit, pozycja listy numerowanej, pozycja listy punktowanej.
    expect(tags).toHaveLength(3);
    expect(tags.map((tag) => tag.getAttribute("data-club-tag"))).toEqual([
      "energia",
      "energia",
      "energia",
    ]);
    expect(new Set(tags.map((tag) => tag.getAttribute("href")))).toEqual(
      new Set(["/club/rada-energetyczna"]),
    );
  });

  it("bez `clubSlug` (wartość domyślna) tag zostaje etykietą we wszystkich blokach", () => {
    const { container } = render(<ClubProse body={BODY} />);
    expect(container.querySelectorAll("a[data-club-tag]")).toHaveLength(0);
    expect(container.querySelectorAll("span[data-club-tag]")).toHaveLength(3);
  });
});
