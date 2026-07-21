import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { SelectionBadge } from "../SelectionBadge";

describe("SelectionBadge", () => {
  it("renders a brand-coloured badge with a check glyph", () => {
    const { container } = render(<SelectionBadge />);
    const badge = container.firstElementChild;
    expect(badge).not.toBeNull();
    expect(badge?.className).toContain("bg-brand");
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("merges an extra className", () => {
    const { container } = render(<SelectionBadge className="ring-2" />);
    expect(container.firstElementChild?.className).toContain("ring-2");
  });
});
