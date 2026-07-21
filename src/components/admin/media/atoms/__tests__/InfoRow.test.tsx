import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InfoRow } from "../InfoRow";

describe("InfoRow", () => {
  it("renders the label and value", () => {
    render(<InfoRow label="Type" value="image/png" />);
    expect(screen.getByText("Type")).toBeInTheDocument();
    const value = screen.getByText("image/png");
    expect(value).toBeInTheDocument();
    expect(value).toHaveAttribute("title", "image/png");
  });

  it("applies a monospace class when mono is set", () => {
    render(<InfoRow label="ID" value="abc-123" mono />);
    expect(screen.getByText("abc-123").className).toContain("font-mono");
  });

  it("does not apply the monospace class by default", () => {
    render(<InfoRow label="Folder" value="/press/" />);
    expect(screen.getByText("/press/").className).not.toContain("font-mono");
  });
});
