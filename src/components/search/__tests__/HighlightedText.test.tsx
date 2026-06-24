import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { HighlightedText } from "../HighlightedText";

describe("HighlightedText", () => {
  it("renders plain text when query is empty", () => {
    const { container } = render(<HighlightedText text="Admin Pages" query="" />);
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(container.textContent).toBe("Admin Pages");
  });

  it("wraps matched characters in <mark>", () => {
    const { container } = render(<HighlightedText text="Admin Pages" query="apa" />);
    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBeGreaterThan(0);
    expect(container.textContent).toBe("Admin Pages");
  });

  it("renders plain when no fuzzy match", () => {
    const { container } = render(<HighlightedText text="Admin" query="xyz" />);
    expect(container.querySelectorAll("mark")).toHaveLength(0);
  });

  it("works for PL diacritics-free fallback", () => {
    const { container } = render(<HighlightedText text="Ustawienia" query="ust" />);
    expect(container.querySelectorAll("mark").length).toBeGreaterThan(0);
  });
});
