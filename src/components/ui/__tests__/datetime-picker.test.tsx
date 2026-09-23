import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateTimePicker } from "@/components/ui/datetime-picker";

describe("DateTimePicker", () => {
  it("uses project-styled hour and minute selectors instead of a native time input", () => {
    render(<DateTimePicker value="2026-09-24T08:17:00.000Z" onChange={vi.fn()} lang="pl" />);

    fireEvent.click(screen.getByRole("button", { name: /24 wrz 2026/i }));

    expect(screen.queryByDisplayValue("10:17")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Godzina" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Minuta" })).toBeInTheDocument();
  });

  it("preserves a minute outside the five-minute steps", () => {
    render(<DateTimePicker value="2026-09-24T08:17:00.000Z" onChange={vi.fn()} lang="pl" />);

    fireEvent.click(screen.getByRole("button", { name: /24 wrz 2026/i }));
    expect(screen.getByRole("combobox", { name: "Minuta" })).toHaveTextContent("17");
  });
});
