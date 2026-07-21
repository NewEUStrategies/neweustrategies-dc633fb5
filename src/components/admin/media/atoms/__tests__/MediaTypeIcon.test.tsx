import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MediaTypeIcon } from "../MediaTypeIcon";

describe("MediaTypeIcon", () => {
  it("renders an SVG glyph for known categories", () => {
    for (const category of ["video", "audio", "pdf", "document", "ebook", "image"] as const) {
      const { container, unmount } = render(<MediaTypeIcon category={category} />);
      expect(container.querySelector("svg")).not.toBeNull();
      unmount();
    }
  });

  it("renders a document emoji for the other category", () => {
    const { container } = render(<MediaTypeIcon category="other" />);
    expect(container.querySelector("svg")).toBeNull();
    expect(screen.getByText("📄")).toBeInTheDocument();
  });
});
