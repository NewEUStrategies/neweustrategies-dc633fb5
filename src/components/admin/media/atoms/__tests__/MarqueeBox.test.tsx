import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MarqueeBox } from "../MarqueeBox";

describe("MarqueeBox", () => {
  it("positions and sizes itself from the rect", () => {
    const { container } = render(<MarqueeBox rect={{ x: 10, y: 20, w: 30, h: 40 }} />);
    const box = container.firstElementChild as HTMLElement;
    expect(box.style.left).toBe("10px");
    expect(box.style.top).toBe("20px");
    expect(box.style.width).toBe("30px");
    expect(box.style.height).toBe("40px");
  });

  it("is non-interactive (pointer-events none)", () => {
    const { container } = render(<MarqueeBox rect={{ x: 0, y: 0, w: 1, h: 1 }} />);
    expect((container.firstElementChild as HTMLElement).className).toContain("pointer-events-none");
  });
});
