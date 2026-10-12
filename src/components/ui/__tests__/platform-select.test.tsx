import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PlatformSelect } from "../platform-select";

describe("PlatformSelect form values", () => {
  it("submits an empty string, not the internal sentinel", () => {
    const { container } = render(
      <form>
        <PlatformSelect name="category" value="" aria-label="Category">
          <option value="">All</option>
          <option value="events">Events</option>
        </PlatformSelect>
      </form>,
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    expect(new FormData(form).get("category")).toBe("");
  });
  it("keeps an uncontrolled choice in FormData", () => {
    const onChange = vi.fn();
    const { container } = render(
      <form>
        <PlatformSelect name="category" defaultValue="" aria-label="Category" onChange={onChange}>
          <option value="" disabled>
            Choose
          </option>
          <option value="events">Events</option>
        </PlatformSelect>
      </form>,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Category" }));
    fireEvent.click(screen.getByRole("option", { name: "Events" }));
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    expect(new FormData(form).getAll("category")).toEqual(["events"]);
    expect(onChange).toHaveBeenCalledWith({ target: { value: "events" } });
  });
  it("does not submit a disabled field", () => {
    const { container } = render(
      <form>
        <PlatformSelect name="category" value="events" disabled>
          <option value="events">Events</option>
        </PlatformSelect>
      </form>,
    );
    const form = container.querySelector("form");
    if (!form) throw new Error("Missing form");
    expect(new FormData(form).has("category")).toBe(false);
  });
});
