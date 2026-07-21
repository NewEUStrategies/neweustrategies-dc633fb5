import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TriStateSelect } from "../TriStateSelect";

const LABELS = { inherit: "Global", on: "On", off: "Off" };

// The core logic of the atom is mapping a nullable boolean to the correct
// visible label (undefined|null -> inherit, true -> on, false -> off). We assert
// that mapping via the rendered SelectValue text rather than driving the Radix
// portal, which is unreliable under happy-dom.
describe("TriStateSelect", () => {
  it("shows the inherit label for undefined", () => {
    render(<TriStateSelect value={undefined} onChange={() => {}} labels={LABELS} />);
    expect(screen.getByText("Global")).toBeInTheDocument();
  });

  it("shows the inherit label for null", () => {
    render(<TriStateSelect value={null} onChange={() => {}} labels={LABELS} />);
    expect(screen.getByText("Global")).toBeInTheDocument();
  });

  it("shows the on label for true", () => {
    render(<TriStateSelect value={true} onChange={() => {}} labels={LABELS} />);
    expect(screen.getByText("On")).toBeInTheDocument();
  });

  it("shows the off label for false", () => {
    render(<TriStateSelect value={false} onChange={() => {}} labels={LABELS} />);
    expect(screen.getByText("Off")).toBeInTheDocument();
  });
});
