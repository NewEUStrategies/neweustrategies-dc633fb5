// Szkielet ładowania uniwersalnego resolvera treści (`routes/$.tsx`).
//
// Plik komponentu nie miał ANI JEDNEGO testu, więc w mierze wiersza „CMS:
// silnik treści publicznej" liczył się jako plik na zerze funkcji i linii.
// Gałęzi tu nie ma (czysty JSX), ale są dwa kontrakty warte przypięcia:
//   1. DEKORACYJNOŚĆ. Szkielet jest `aria-hidden`, bo nawigację ogłasza
//      `RouteProgress`. Bez tego czytnik ekranu czytałby kilkanaście pustych
//      kontenerów przy każdym przejściu między wpisami.
//   2. KSZTAŁT ARTYKUŁU. Placeholder ma odwzorowywać układ wpisu (okruszki,
//      tytuł, meta z awatarem, okładka, akapity), inaczej treść „przeskakuje"
//      po doładowaniu i psuje CLS - czyli dokładnie to, przed czym chroni.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ContentSkeleton } from "./ContentSkeleton";

describe("ContentSkeleton", () => {
  it("jest dekoracyjny - cały kontener ma aria-hidden", () => {
    const { container } = render(<ContentSkeleton />);
    const root = container.firstElementChild as HTMLElement | null;

    expect(root).not.toBeNull();
    expect(root?.getAttribute("aria-hidden")).toBe("true");
    // Nic wewnątrz nie jest ogniskowalne - szkielet nie może łapać tabulatora.
    expect(root?.querySelectorAll("a, button, input, [tabindex]")).toHaveLength(0);
  });

  it("rysuje wyłącznie migoczące kafle, bez treści do odczytania", () => {
    const { container } = render(<ContentSkeleton />);

    expect(container.querySelectorAll(".skeleton-shimmer").length).toBeGreaterThan(10);
    expect(container.textContent).toBe("");
  });

  it("odwzorowuje układ wpisu: okruszki, tytuł, meta, okładka i akapity", () => {
    const { container } = render(<ContentSkeleton />);

    // Okładka trzyma proporcje 16:9 - to ona rezerwuje najwięcej miejsca.
    expect(container.querySelector(".skeleton-shimmer.aspect-\\[16\\/9\\]")).not.toBeNull();
    // Awatar w bloku meta jest kwadratowy (h-9 w-9).
    expect(container.querySelector(".skeleton-shimmer.h-9.w-9")).not.toBeNull();
    // Blok akapitów: pięć wierszy tekstu.
    expect(container.querySelectorAll(".skeleton-shimmer.h-4")).toHaveLength(5);
  });

  it("mieści się w tej samej kolumnie treści co artykuł (max-w-[860px])", () => {
    const { container } = render(<ContentSkeleton />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("max-w-[860px]");
    expect(root.className).toContain("mx-auto");
  });
});
