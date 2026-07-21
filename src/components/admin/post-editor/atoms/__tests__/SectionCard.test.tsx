import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Mic } from "lucide-react";
import { SectionCard } from "../SectionCard";

describe("SectionCard", () => {
  it("renders the title and body content", () => {
    render(
      <SectionCard title="Audio">
        <p>body</p>
      </SectionCard>,
    );
    expect(screen.getByRole("heading", { name: "Audio" })).toBeInTheDocument();
    expect(screen.getByText("body")).toBeInTheDocument();
  });

  it("renders the optional description when provided", () => {
    render(
      <SectionCard title="Audio" description="PL/EN fallback">
        <span>x</span>
      </SectionCard>,
    );
    expect(screen.getByText("PL/EN fallback")).toBeInTheDocument();
  });

  it("renders an icon in the header when given", () => {
    const { container } = render(
      <SectionCard title="Audio" icon={Mic}>
        <span>x</span>
      </SectionCard>,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("applies a custom body class for multi-column layouts", () => {
    render(
      <SectionCard title="Audio" bodyClassName="p-4 grid md:grid-cols-2 gap-4">
        <span>grid child</span>
      </SectionCard>,
    );
    const child = screen.getByText("grid child");
    expect(child.parentElement?.className).toContain("grid");
  });
});
