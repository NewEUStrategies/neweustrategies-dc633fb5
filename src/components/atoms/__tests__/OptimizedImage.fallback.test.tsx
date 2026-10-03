// Zaślepka `OptimizedImage` po błędzie ładowania - semantyka dostępności.
//
// CO TEN PLIK DOWODZI. Obraz z treścią (`alt` niepusty) po błędzie zostaje
// nazwanym obrazem (`role="img"` + etykieta), więc czytnik ekranu dalej wie,
// co miało tu być. Obraz DEKORACYJNY (`alt=""` albo jawne `aria-hidden`)
// zostaje dekoracją: wcześniej zaślepka zawsze była `role="img"` z pustą
// etykietą, więc ukryty pas okładki klubu stawał się po 404 nienazwanym
// obrazem w drzewie dostępności (axe: role-img-alt).
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";

import { OptimizedImage } from "@/components/atoms/OptimizedImage";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function failLoad(container: HTMLElement): void {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  fireEvent.error(container.querySelector("img") as HTMLImageElement);
}

describe("OptimizedImage - zaślepka po błędzie", () => {
  it("obraz z treścią zostaje nazwanym obrazem", () => {
    const { container } = render(<OptimizedImage src="https://x.example/a.jpg" alt="Panel" />);
    failLoad(container);

    const fallback = container.querySelector("span");
    expect(container.querySelector("img")).toBeNull();
    expect(fallback?.getAttribute("role")).toBe("img");
    expect(fallback?.getAttribute("aria-label")).toBe("Panel");
    expect(fallback?.hasAttribute("aria-hidden")).toBe(false);
  });

  it('obraz dekoracyjny (`alt=""`) zostaje ukryty przed czytnikiem', () => {
    const { container } = render(<OptimizedImage src="https://x.example/a.jpg" alt="" />);
    failLoad(container);

    const fallback = container.querySelector("span");
    expect(fallback?.getAttribute("aria-hidden")).toBe("true");
    expect(fallback?.hasAttribute("role")).toBe(false);
    expect(fallback?.hasAttribute("aria-label")).toBe(false);
  });

  it("jawne `aria-hidden` wygrywa także przy niepustym `alt`", () => {
    const { container } = render(
      <OptimizedImage src="https://x.example/a.jpg" alt="Okładka" aria-hidden="true" />,
    );
    failLoad(container);

    const fallback = container.querySelector("span");
    expect(fallback?.getAttribute("aria-hidden")).toBe("true");
    expect(fallback?.hasAttribute("role")).toBe(false);
  });

  it("brak adresu od razu rysuje zaślepkę z tą samą semantyką", () => {
    const { container } = render(<OptimizedImage src="" alt="" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("span")?.getAttribute("aria-hidden")).toBe("true");
  });
});
