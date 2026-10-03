// ScrollArea podmienia systemowy pasek przewijania na własny, rysowany tokenem
// `bg-border` (ten sam kolor ramek w jasnym i ciemnym motywie). Kontrakt:
// treść leży w przewijanym oknie (viewport), opakowanie montuje WYŁĄCZNIE
// pionowy pasek, więc okno przewija się w pionie, a w poziomie jest przycięte.
//
// happy-dom nie liczy układu, więc pasek w trybie domyślnym („hover") nigdy
// nie uzna treści za przepełnioną. Pasek mierzę w trybie `always`, który
// montuje go bez pomiaru.
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ScrollArea } from "../scroll-area";

afterEach(cleanup);

function viewportOf(root: HTMLElement): HTMLElement {
  const viewport = root.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]");
  expect(viewport).not.toBeNull();
  return viewport as HTMLElement;
}

describe("ScrollArea", () => {
  it("umieszcza treść w przewijanym oknie wewnątrz przyciętego kontenera", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ScrollArea ref={ref} className="h-48">
        <ul aria-label="Lista wydarzeń">
          <li>Forum</li>
          <li>Gala</li>
        </ul>
      </ScrollArea>,
    );
    const root = ref.current as HTMLElement;
    expect(root).toHaveClass("relative", "overflow-hidden", "h-48");
    const viewport = viewportOf(root);
    expect(viewport).toHaveClass("h-full", "w-full", "rounded-[inherit]");
    expect(viewport).toContainElement(screen.getByRole("list", { name: "Lista wydarzeń" }));
  });

  it("w trybie domyślnym przewija w pionie, ale nie pokazuje paska, dopóki treść się nie przepełni", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ScrollArea ref={ref}>
        <p>Krótka treść</p>
      </ScrollArea>,
    );
    expect(ref.current?.querySelector("[data-orientation]")).toBeNull();
    const viewport = viewportOf(ref.current as HTMLElement);
    expect(viewport.style.overflowY).toBe("scroll");
    expect(viewport.style.overflowX).toBe("hidden");
  });

  it("montuje pionowy pasek w kolorze tokenu ramki i przewija okno tylko w pionie", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ScrollArea ref={ref} type="always">
        <p>Długa treść</p>
      </ScrollArea>,
    );
    const root = ref.current as HTMLElement;
    const scrollbar = root.querySelector('[data-orientation="vertical"]');
    expect(scrollbar).not.toBeNull();
    expect(scrollbar).toHaveClass(
      "flex",
      "touch-none",
      "select-none",
      "h-full",
      "w-2.5",
      "border-l",
    );
    expect(scrollbar).not.toHaveClass("flex-col");
    expect(root.querySelector('[data-orientation="horizontal"]')).toBeNull();
    const viewport = viewportOf(root);
    expect(viewport.style.overflowY).toBe("scroll");
    expect(viewport.style.overflowX).toBe("hidden");
  });

  it("przekazuje kierunek pisma do korzenia, żeby pasek stanął po właściwej stronie", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <ScrollArea ref={ref} type="always" dir="rtl">
        <p>Treść</p>
      </ScrollArea>,
    );
    expect(ref.current).toHaveAttribute("dir", "rtl");
    const scrollbar = ref.current?.querySelector<HTMLElement>('[data-orientation="vertical"]');
    expect(scrollbar?.style.left).toBe("0px");
  });
});
