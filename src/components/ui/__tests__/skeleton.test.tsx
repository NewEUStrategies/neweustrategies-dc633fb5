// Skeleton to najczęściej używany prymityw ładowania (kilkanaście konsumentów).
// Kontrakt: neutralny prostokąt z pulsem, którego kolor idzie z tokenu
// `bg-muted` (ten sam token zmienia wartość w jasnym i ciemnym motywie), a klasa
// wywołującego nadpisuje kształt bez gubienia pulsu.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Skeleton } from "../skeleton";

afterEach(cleanup);

describe("Skeleton", () => {
  it("rysuje pulsujący prostokąt w kolorze tokenu motywu", () => {
    render(<Skeleton data-testid="szkielet" />);
    const el = screen.getByTestId("szkielet");
    expect(el.tagName).toBe("DIV");
    expect(el).toHaveClass("animate-pulse", "rounded-md", "bg-muted");
    expect(el).toBeEmptyDOMElement();
  });

  it("pozwala nadpisać kształt klasą wywołującego, zachowując puls", () => {
    render(<Skeleton data-testid="szkielet" className="h-4 w-24 rounded-full" />);
    const el = screen.getByTestId("szkielet");
    expect(el).toHaveClass("animate-pulse", "bg-muted", "h-4", "w-24", "rounded-full");
    expect(el).not.toHaveClass("rounded-md");
  });

  it("przekazuje rolę i nazwę, żeby zaślepka mogła ogłosić ładowanie czytnikowi", () => {
    render(<Skeleton role="status" aria-label="Ładowanie listy" />);
    expect(screen.getByRole("status", { name: "Ładowanie listy" })).toHaveClass("animate-pulse");
  });

  it("daje się ukryć przed czytnikiem, gdy ładowanie ogłasza ktoś inny", () => {
    render(<Skeleton role="status" aria-hidden="true" />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("status", { hidden: true })).toHaveAttribute("aria-hidden", "true");
  });
});
