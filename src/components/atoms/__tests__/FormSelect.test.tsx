import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FormSelect } from "@/components/atoms/FormSelect";

describe("FormSelect", () => {
  const options = [
    { value: "geo", label: "Geopolityka" },
    { value: "eco", label: "Ekonomia" },
  ];

  it("renders placeholder when empty and exposes a hidden input", () => {
    const { container } = render(
      <FormSelect
        value=""
        onValueChange={() => {}}
        options={options}
        placeholder="Wybierz..."
        name="list"
      />,
    );
    expect(screen.getByText("Wybierz...")).toBeTruthy();
    const hidden = container.querySelector('input[type="hidden"][name="list"]');
    expect(hidden).toBeTruthy();
  });

  it("renders the selected label and marks the trigger as required", () => {
    const onValueChange = vi.fn();
    render(
      <FormSelect
        value="eco"
        onValueChange={onValueChange}
        options={options}
        required
        aria-label="Lista"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Lista" });
    expect(trigger.getAttribute("aria-required")).toBe("true");
    expect(screen.getByText("Ekonomia")).toBeTruthy();
    // Radix otwiera listę na pointerdown - w jsdom wystarczy sprawdzić, że
    // trigger jest interaktywny i nie jest natywnym <select>.
    fireEvent.keyDown(trigger, { key: "Enter" });
    expect(trigger.tagName.toLowerCase()).toBe("button");
  });
});
