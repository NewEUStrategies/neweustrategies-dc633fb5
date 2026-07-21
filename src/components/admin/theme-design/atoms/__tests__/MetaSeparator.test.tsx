// Render tests for the MetaSeparator atom.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { MetaSeparator } from "../MetaSeparator";

describe("MetaSeparator", () => {
  it("renders the matching glyph for each separator kind", () => {
    expect(render(<MetaSeparator kind="dot" />).container.textContent).toBe("•");
    expect(render(<MetaSeparator kind="slash" />).container.textContent).toBe("/");
    expect(render(<MetaSeparator kind="pipe" />).container.textContent).toBe("|");
  });

  it("renders nothing for 'none'", () => {
    const { container } = render(<MetaSeparator kind="none" />);
    expect(container.textContent).toBe("");
  });

  it("marks the glyph decorative (aria-hidden)", () => {
    const { container } = render(<MetaSeparator kind="dot" />);
    expect(container.querySelector("[aria-hidden]")).not.toBeNull();
  });
});
