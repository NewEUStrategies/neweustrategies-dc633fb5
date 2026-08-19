// Atom szkieletu karty materiału.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MaterialCardSkeleton } from "@/components/experts/atoms/MaterialCardSkeleton";

describe("MaterialCardSkeleton", () => {
  it("jest ukryty przed czytnikiem ekranu - to migotanie, nie treść", () => {
    // Bez `aria-hidden` czytnik ogłasza trzy puste karty przy każdej zmianie
    // strony wyników.
    const { container } = render(<MaterialCardSkeleton />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden");
  });

  it("nie niesie żadnego tekstu", () => {
    const { container } = render(<MaterialCardSkeleton />);
    expect(container.textContent).toBe("");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(1);
  });
});
