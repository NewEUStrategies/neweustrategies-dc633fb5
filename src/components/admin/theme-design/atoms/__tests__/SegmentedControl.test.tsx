// Render + interaction tests for the reusable SegmentedControl atom.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { SegmentedControl, type SegmentedOption } from "../SegmentedControl";

type Mode = "light" | "dark";
const OPTIONS: readonly SegmentedOption<Mode>[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

describe("SegmentedControl", () => {
  it("renders one button per option and marks the active one via aria-pressed", () => {
    const { getByText } = render(
      <SegmentedControl options={OPTIONS} value="light" onChange={() => {}} />,
    );
    expect(getByText("Light").getAttribute("aria-pressed")).toBe("true");
    expect(getByText("Dark").getAttribute("aria-pressed")).toBe("false");
  });

  it("fires onChange with the typed value when an inactive option is clicked", () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <SegmentedControl options={OPTIONS} value="light" onChange={onChange} />,
    );
    fireEvent.click(getByText("Dark"));
    expect(onChange).toHaveBeenCalledWith("dark");
  });

  it("disables every button when disabled", () => {
    const { getByText } = render(
      <SegmentedControl options={OPTIONS} value="light" onChange={() => {}} disabled />,
    );
    expect((getByText("Light") as HTMLButtonElement).disabled).toBe(true);
    expect((getByText("Dark") as HTMLButtonElement).disabled).toBe(true);
  });

  it("exposes the group aria-label and per-option aria-label", () => {
    const { getByRole, getByLabelText } = render(
      <SegmentedControl
        options={[{ value: "light", label: "☀", ariaLabel: "Light mode" }]}
        value="light"
        onChange={() => {}}
        ariaLabel="Preview mode"
      />,
    );
    expect(getByRole("group").getAttribute("aria-label")).toBe("Preview mode");
    expect(getByLabelText("Light mode")).toBeTruthy();
  });
});
