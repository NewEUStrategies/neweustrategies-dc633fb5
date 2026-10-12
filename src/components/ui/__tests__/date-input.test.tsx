import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DateInput } from "../date-input";

describe("DateInput local values", () => {
  it("clears a date using the existing empty-string contract", () => {
    const onChange = vi.fn();
    render(<DateInput type="date" value="2026-10-12" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Wyczyść" }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: "" } });
  });
  it("changes an hour without shifting the local day or minute", () => {
    const onChange = vi.fn();
    render(<DateInput type="datetime-local" value="2026-10-12T08:17" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: "12.10.2026, 08:17" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Godzina" }));
    fireEvent.click(screen.getByRole("option", { name: "09" }));
    expect(onChange).toHaveBeenCalledWith({ target: { value: "2026-10-12T09:17" } });
  });
  it("submits the original date string", () => {
    const { container } = render(<form><DateInput name="day" type="date" value="2026-10-12" /></form>);
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    expect(new FormData(form).get("day")).toBe("2026-10-12");
  });
});