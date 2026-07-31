import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuotaMeter } from "../QuotaMeter";

/** Tonacja jest wewnętrzną regułą atomu - asercje idą przez publiczny kontrakt (data-tone). */
function renderedTone(used: number, limit: number): string | null {
  const { container, unmount } = render(
    <QuotaMeter used={used} limit={limit} label="Limit" valueText={`${used} z ${limit}`} />,
  );
  const tone = container.querySelector("[data-testid='quota-meter']")?.getAttribute("data-tone");
  unmount();
  return tone ?? null;
}

describe("QuotaMeter - tonacja", () => {
  it("spokojna przy zapasie limitu", () => {
    expect(renderedTone(1, 5)).toBe("ok");
    expect(renderedTone(0, 5)).toBe("ok");
  });

  it("ostrzega przy ostatnim artykule lub >=80% zużycia", () => {
    expect(renderedTone(4, 5)).toBe("low");
    expect(renderedTone(8, 10)).toBe("low");
  });

  it("wyczerpany limit", () => {
    expect(renderedTone(5, 5)).toBe("exhausted");
    expect(renderedTone(7, 5)).toBe("exhausted");
  });
});

describe("QuotaMeter", () => {
  it("nie renderuje się bez realnego limitu", () => {
    const { container } = render(<QuotaMeter used={0} limit={0} label="Limit" valueText="0 z 0" />);
    expect(container.firstChild).toBeNull();
  });

  it("wystawia semantykę meter z pełnym ARIA", () => {
    render(<QuotaMeter used={2} limit={5} label="Miesięczny limit" valueText="2 z 5" />);
    const meter = screen.getByRole("meter", { name: "Miesięczny limit" });
    expect(meter).toHaveAttribute("aria-valuemin", "0");
    expect(meter).toHaveAttribute("aria-valuemax", "5");
    expect(meter).toHaveAttribute("aria-valuenow", "2");
    expect(meter).toHaveAttribute("aria-valuetext", "2 z 5");
    expect(meter).toHaveAttribute("data-tone", "ok");
  });

  it("mały limit rysuje segment na artykuł", () => {
    const { container } = render(<QuotaMeter used={2} limit={5} label="Limit" valueText="2 z 5" />);
    const segments = container.querySelectorAll("span");
    expect(segments).toHaveLength(5);
    const filled = Array.from(segments).filter((s) => s.className.includes("bg-brand"));
    expect(filled).toHaveLength(2);
  });

  it("duży limit przechodzi w ciągły pasek", () => {
    const { container } = render(
      <QuotaMeter used={10} limit={40} label="Limit" valueText="10 z 40" />,
    );
    expect(container.querySelectorAll("span")).toHaveLength(0);
    const bar = container.querySelector<HTMLElement>("[aria-hidden] > div");
    expect(bar?.style.width).toBe("25%");
  });

  it("zużycie ponad limit jest przycinane, tonacja exhausted", () => {
    render(<QuotaMeter used={9} limit={5} label="Limit" valueText="5 z 5" />);
    const meter = screen.getByRole("meter");
    expect(meter).toHaveAttribute("aria-valuenow", "5");
    expect(meter).toHaveAttribute("data-tone", "exhausted");
  });
});
